import { readSettings } from './settingsStore.js';

/**
 * AI 失败诊断 — 走 OpenAI 兼容 /chat/completions。
 *
 * 设计取舍：
 * - 只用 Node 18 原生 fetch，不引第三方 SDK（项目零 AI 依赖）。
 * - 密钥只在这里从磁盘读，绝不出现在响应里。
 * - 路径先脱敏再进 prompt：本机绝对路径对排障没有价值，却会把用户目录名
 *   发给第三方服务。
 * - 错误按可行动类型分类返回，而不是把底层异常直接抛给 UI。
 */

const SYSTEM_PROMPT = `你是一个 Steam ↔ Xbox PC 游戏存档移植工具的故障诊断助手。

工具背景（务必基于这些事实回答，不要臆造）：
- Xbox PC Game Pass 的存档位于 %LOCALAPPDATA%\\Packages\\<包名>\\SystemAppData\\wgs\\<XUID>\\，
  由 containers.index（清单）+ container.N（容器内容）组成。
- 工具已逆向真实 Xbox v14 容器格式，写入时采用"就地替换字节"策略：
  保留原有容器名、GUID、序号，只替换存档字节，从而不破坏游戏需要的结构。
- Steam → Xbox 方向要求 Xbox 端**已经存在**该游戏自己生成的 WGS 结构。如果不存在，
  工具会拒绝写入并提示 needs-launch，正确做法是先在 Xbox 端启动一次游戏并存档。
- 槽位匹配规则：Steam 文件名能派生出 Xbox 容器名（同名，或去掉版本后缀如
  user1_1.0.30000.dat → user1）才会写入；无法对应的文件会被跳过并列在 unusedSteamFiles。
- 部分游戏两端字节格式不兼容（如幻兽帕鲁），工具会以 BYTE_INCOMPATIBLE 或
  CONVERSION_REQUIRED 硬性阻止，这是保护行为，不是故障。
- 常见失败码：GAME_RUNNING（游戏未退出）、PLATFORM_RUNNING（平台客户端占用）、
  CONVERSION_REQUIRED（需外部转换工具）、BYTE_INCOMPATIBLE（字节不兼容已拦截）、
  verify.ok=false（写入了但落盘校验不通过：文件缺失/0 字节/MD5 不符）。

输出要求：
- 用中文，严格分三段，每段以「原因」「可能方案」「下一步操作」开头。
- 「原因」：基于给定事实判断，区分"确定"与"可能"；信息不足就说明缺什么，不要编造。
- 「可能方案」：按成功率排序，最多 4 条，每条一行，具体可执行。
- 「下一步操作」：给出 1-2 个用户此刻就能做的动作。
- 不要输出 markdown 标题、代码块或表格；纯文本，段落之间空行。
- 绝不虚构不存在的文件路径、容器名或工具名。`;

/**
 * 通用问答模式的系统提示词。
 *
 * 与 SYSTEM_PROMPT 共享领域知识，但去掉「诊断这次失败」的框架——
 * 用户在 AI 面板新建会话时可能问的是「怎么把 Steam 存档移植到 Xbox」
 * 这类操作问题，而不是一次具体失败的诊断。
 */
const GENERAL_SYSTEM_PROMPT = `你是一个 Steam ↔ Xbox PC 游戏存档移植工具的助手。

工具背景（务必基于这些事实回答，不要臆造）：
- Xbox PC Game Pass 的存档位于 %LOCALAPPDATA%\\Packages\\<包名>\\SystemAppData\\wgs\\<XUID>\\，
  由 containers.index（清单）+ container.N（容器内容）组成。
- 工具已逆向真实 Xbox v14 容器格式，写入时采用"就地替换字节"策略：
  保留原有容器名、GUID、序号，只替换存档字节，从而不破坏游戏需要的结构。
- Steam → Xbox 方向要求 Xbox 端**已经存在**该游戏自己生成的 WGS 结构。如果不存在，
  工具会拒绝写入并提示 needs-launch，正确做法是先在 Xbox 端启动一次游戏并存档。
- 槽位匹配规则：Steam 文件名能派生出 Xbox 容器名（同名，或去掉版本后缀如
  user1_1.0.30000.dat → user1）才会写入；无法对应的文件会被跳过并列在 unusedSteamFiles。
- 部分游戏两端字节格式不兼容（如幻兽帕鲁），工具会以 BYTE_INCOMPATIBLE 或
  CONVERSION_REQUIRED 硬性阻止，这是保护行为，不是故障。
- 常见失败码：GAME_RUNNING（游戏未退出）、PLATFORM_RUNNING（平台客户端占用）、
  CONVERSION_REQUIRED（需外部转换工具）、BYTE_INCOMPATIBLE（字节不兼容已拦截）、
  verify.ok=false（写入了但落盘校验不通过：文件缺失/0 字节/MD5 不符）。

输出要求：
- 用中文，先给结论，再给具体步骤。
- 步骤要可执行（点哪个按钮、选哪个方向），不要泛泛而谈。
- 不要输出 markdown 标题、代码块或表格；纯文本，段落之间空行。
- 绝不虚构不存在的文件路径、容器名或工具名。`;

/** Keep only the last two path segments — enough to identify, not enough to fingerprint. */
function maskPath(p) {
  if (!p || typeof p !== 'string') return null;
  const parts = p.split(/[\\/]+/).filter(Boolean);
  if (parts.length <= 2) return parts.join('\\');
  return `…\\${parts.slice(-2).join('\\')}`;
}

/** Mask Windows drive / UNC paths embedded in free text (errors, logs, notes). */
function maskText(value) {
  if (typeof value !== 'string' || !value) return value;
  return value
    .replace(/[A-Za-z]:\\[^\s"',;)\]}]+/g, (p) => maskPath(p) || '')
    .replace(/\\\\[^\s"',;)\]}]+/g, (p) => maskPath(p) || '');
}

/** Trim a verify report down to what matters for diagnosis. */
function slimVerify(verify) {
  if (!verify || typeof verify !== 'object') return null;
  const out = { ok: verify.ok, note: maskText(verify.note), targetPath: maskPath(verify.targetPath) };
  if (Array.isArray(verify.files)) {
    out.files = verify.files.slice(0, 20).map(f => ({
      name: f.name,
      size: f.size,
      md5Match: f.md5Match,
    }));
    if (verify.files.length > 20) out.filesTruncated = verify.files.length - 20;
  }
  if (Array.isArray(verify.blobs)) {
    out.blobs = verify.blobs.slice(0, 20).map(b => ({ name: b.name, exists: b.exists, sizeOk: b.sizeOk }));
  }
  if (verify.containersCount !== undefined) out.containersCount = verify.containersCount;
  if (verify.indexExists !== undefined) out.indexExists = verify.indexExists;
  if (Array.isArray(verify.unusedSteamFiles)) out.unusedSteamFiles = verify.unusedSteamFiles.slice(0, 20);
  if (Array.isArray(verify.skippedContainers)) {
    out.skippedContainers = verify.skippedContainers.slice(0, 10);
  }
  return out;
}

/** Build the user message from a failure context assembled by the route. */
function buildUserMessage(context = {}, logs = []) {
  const facts = {
    stage: context.stage || null,
    code: context.code || null,
    // Backend error strings interpolate absolute paths; mask them too or the
    // "only last two path segments" privacy promise is silently broken.
    error: maskText(context.error) || null,
    gameName: context.gameName || null,
    direction: context.direction || null,
    steamPath: maskPath(context.steamPath),
    xboxPath: maskPath(context.xboxPath),
    verify: slimVerify(context.verify),
    warnings: Array.isArray(context.warnings) ? context.warnings.slice(0, 10).map(maskText) : [],
  };
  const logLines = logs.length
    ? `\n\n最近的运行日志（最新在后）：\n${logs.map(l => `[${l.type || 'info'}] ${maskText(l.message)}`).join('\n')}`
    : '';
  return `以下是一次存档移植失败的现场信息（JSON）：\n\n${JSON.stringify(facts, null, 2)}${logLines}\n\n请诊断这次失败。`;
}

class AiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Ask the configured model to explain a migration failure — or answer a general question.
 *
 * Two modes, decided by whether the caller supplies a failure context:
 *  - 失败诊断：context 非空 → SYSTEM_PROMPT + 现场 JSON
 *  - 通用问答：context 为空且给了 question → GENERAL_SYSTEM_PROMPT + 原始问题
 *
 * @param {object} context failure context from the route; empty for general Q&A
 * @param {object} [options]
 * @param {{role:'user'|'assistant', content:string}[]} [options.messages] 多轮对话历史
 * @param {{type?:string, message:string}[]} [options.logs] 最近的运行日志
 * @param {string} [options.question] 通用问答模式下的用户问题
 * @returns {Promise<{ text: string, model: string }>}
 */
export async function explainFailure(context, options = {}) {
  const settings = readSettings().ai;

  if (!settings.enabled) {
    // Distinguish "turned off" from "never configured" — telling a user who
    // already saved a key that it is missing reads like the key was lost.
    throw new AiError(
      'AI_DISABLED',
      settings.apiKey
        ? 'AI 助手已配置密钥但处于「未启用」状态，请到「设置」中勾选启用'
        : 'AI 助手未启用，请先到「设置」中开启并填写 API 配置',
    );
  }
  if (!settings.apiKey) {
    throw new AiError('AI_NOT_CONFIGURED', '尚未填写 API Key，请先到「设置」中配置');
  }
  if (!settings.baseUrl) {
    throw new AiError('AI_NOT_CONFIGURED', '尚未填写 API 地址（Base URL），请先到「设置」中配置');
  }

  const url = `${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.timeoutMs);

  // 多轮对话：system + 首轮现场信息 + 历史追问
  const history = Array.isArray(options.messages) ? options.messages : [];
  // Keep the prompt within a sane context budget. Older turns are dropped
  // silently from the model input (they stay in the saved session) and the
  // caller is told via contextTruncated so the UI can warn the user.
  const MAX_HISTORY_TURNS = 16;
  const contextTruncated = history.length > MAX_HISTORY_TURNS;
  const effectiveHistory = contextTruncated ? history.slice(-MAX_HISTORY_TURNS) : history;
  const logs = Array.isArray(options.logs) ? options.logs.slice(-30) : [];
  const question = typeof options.question === 'string' ? options.question.trim() : '';

  // 没有失败现场 → 通用问答模式：问题本身就是首轮 user 消息
  const hasContext = !!(context && (context.error || context.code || context.gameName || context.stage));
  const general = !hasContext && !!question;

  const messages = [
    { role: 'system', content: general ? GENERAL_SYSTEM_PROMPT : SYSTEM_PROMPT },
  ];
  if (general) {
    // 通用问答：历史为空时用 question 作首轮；历史非空时历史里已含首轮问题，
    // 再插一次会重复。
    if (effectiveHistory.length === 0) messages.push({ role: 'user', content: question });
  } else {
    messages.push({ role: 'user', content: buildUserMessage(context, logs) });
  }
  for (const m of effectiveHistory) {
    if (!m || typeof m.content !== 'string') continue;
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    messages.push({ role: m.role, content: m.content.slice(0, 4000) });
  }

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages,
        temperature: 0.3,
        max_tokens: 1200,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new AiError('AI_TIMEOUT', `AI 请求超时（${settings.timeoutMs}ms），请检查网络或调大超时时间`);
    }
    const detail = err?.cause?.code || err?.message || String(err);
    throw new AiError('AI_NETWORK', `无法连接 AI 服务：${detail}。请检查 Base URL 与网络（含代理/防火墙）`);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    throw new AiError('AI_AUTH', `API Key 被拒绝（HTTP ${res.status}），请到「设置」中重新填写`);
  }
  if (res.status === 404) {
    throw new AiError('AI_ENDPOINT', `接口地址不存在（HTTP 404）：${url}。请确认 Base URL 是否包含正确的版本路径（如 /v1）`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new AiError('AI_HTTP', `AI 服务返回 HTTP ${res.status}：${body.slice(0, 200)}`);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new AiError('AI_BAD_RESPONSE', 'AI 服务返回的不是合法 JSON，请确认该地址是 OpenAI 兼容接口');
  }

  const text = data?.choices?.[0]?.message?.content;
  if (!text || typeof text !== 'string') {
    throw new AiError('AI_BAD_RESPONSE', 'AI 响应中没有可用的回答内容（choices[0].message.content 为空）');
  }

  return {
    text: text.trim(),
    model: data.model || settings.model,
    usage: data.usage || null,
    contextTruncated,
  };
}

/**
 * Lightweight connectivity probe used by the settings page "测试连接" button.
 *
 * Accepts the form's current values so the user can verify a key BEFORE saving
 * it — previously this read only the persisted config, so testing a freshly
 * typed key silently probed the old (often empty) one and looked like the key
 * had not been stored.
 *
 * @param {{baseUrl?: string, model?: string, apiKey?: string, timeoutMs?: number}} [overrides]
 */
export async function testAiConnection(overrides = {}) {
  const saved = readSettings().ai;
  const settings = {
    baseUrl: (overrides.baseUrl || saved.baseUrl || '').replace(/\/+$/, ''),
    model: overrides.model || saved.model,
    // Empty string means "user typed nothing" → fall back to the stored key.
    apiKey: overrides.apiKey || saved.apiKey,
    timeoutMs: Number(overrides.timeoutMs) || saved.timeoutMs,
  };

  if (!settings.baseUrl) throw new AiError('AI_NOT_CONFIGURED', '尚未填写 API 地址（Base URL）');
  if (!settings.apiKey) throw new AiError('AI_NOT_CONFIGURED', '尚未填写 API Key');

  const url = `${settings.baseUrl}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(settings.timeoutMs, 15000));

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
      body: JSON.stringify({
        model: settings.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 5,
      }),
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      throw new AiError('AI_AUTH', `API Key 被拒绝（HTTP ${res.status}）`);
    }
    if (res.status === 404) {
      throw new AiError('AI_ENDPOINT', `接口地址不存在（HTTP 404）：${url}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new AiError('AI_HTTP', `HTTP ${res.status}：${body.slice(0, 160)}`);
    }
    const data = await res.json().catch(() => null);
    if (!data?.choices) {
      throw new AiError('AI_BAD_RESPONSE', '响应中没有 choices 字段，可能不是 OpenAI 兼容接口');
    }
    return { ok: true, model: data.model || settings.model };
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (err && err.name === 'AbortError') throw new AiError('AI_TIMEOUT', '连接超时');
    const detail = err?.cause?.code || err?.message || String(err);
    throw new AiError('AI_NETWORK', `连接失败：${detail}`);
  } finally {
    clearTimeout(timer);
  }
}

export { AiError, maskPath, maskText, slimVerify, buildUserMessage };
