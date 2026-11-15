/**
 * AI 会话链路端到端自检（自包含，不依赖外部运行的服务）。
 *
 * 覆盖：首轮新建会话 → 追问追加轮次 → 列表 → 详情 → 重命名 → 置顶 → 导出 → 删除。
 *
 * 自包含做法：
 *  - 自己起一个假 OpenAI 服务（临时端口）
 *  - 用 SXSM_DATA_DIR 指向临时目录，自己起一份后端（临时端口），并把 AI 配置指向假服务
 *  - 用 Node 原生 fetch 发请求（不经过 shell，避免 Windows 控制台编码破坏中文）
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sxsm-ai-e2e-'));
process.env.SXSM_DATA_DIR = tmpDir;

const FAKE_PORT = 8799;
const API_PORT = 3911;
const API = `http://127.0.0.1:${API_PORT}`;

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  PASS  ${name}`);
  else { failed++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// ---------- 假 OpenAI ----------
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    let parsed = null;
    try { parsed = JSON.parse(body); } catch {}
    const userTurns = (parsed?.messages || []).filter(m => m.role === 'user');
    const isFollowUp = userTurns.length > 1;
    // 通用问答模式的 system prompt 与失败诊断不同，用它区分
    const isGeneral = (parsed?.messages || []).some(
      m => m.role === 'system' && String(m.content).includes('存档移植工具的助手'),
    );
    const answer = isGeneral
      ? (isFollowUp ? '通用追问轮回答。\n下一步：按上一轮建议操作' : '通用首轮回答。\n下一步：先在 Xbox 端启动一次游戏')
      : (isFollowUp
        ? '原因：追问轮，历史已送达。\n可能方案：按上一轮建议操作\n下一步操作：检查备份后重试'
        : '原因：首轮分析回答。\n可能方案：检查目标目录权限\n下一步操作：重新扫描后再次移植');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      model: 'fake-model',
      choices: [{ message: { role: 'assistant', content: answer } }],
    }));
  });
});
await new Promise(r => fake.listen(FAKE_PORT, r));

// ---------- 起后端（子进程，测真实启动路径） ----------
process.env.SXSM_PORT = String(API_PORT);
const { spawn } = await import('child_process');
const serverProc = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, SXSM_DATA_DIR: tmpDir, SXSM_PORT: String(API_PORT) },
  stdio: 'ignore',
});

// 等后端就绪
let ready = false;
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`${API}/api/settings`);
    if (r.ok) { ready = true; break; }
  } catch {}
  await new Promise(r => setTimeout(r, 200));
}
if (!ready) {
  serverProc.kill();
  console.error('  FAIL  后端未能启动');
  process.exit(1);
}

// 把 AI 配置指向假服务
await fetch(`${API}/api/settings`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    ai: {
      enabled: true,
      baseUrl: `http://127.0.0.1:${FAKE_PORT}/v1`,
      apiKey: 'sk-fake-test-key',
      model: 'fake-model',
      timeoutMs: 8000,
      autoAnalyze: false,
    },
  }),
});

const CTX = {
  gameName: '空洞骑士',
  code: 'VERIFY_FAILED',
  error: '落盘校验未通过',
  direction: 'steam_to_xbox',
};

console.log('AI 会话链路端到端自检');

// ---------- 1) 首轮：新建会话 ----------
const r1 = await (await fetch(`${API}/api/ai/explain-failure`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ context: CTX, messages: [] }),
})).json();
check('首轮返回 sessionId', !!r1.sessionId, JSON.stringify(r1).slice(0, 120));
check('首轮返回三段式文本', r1.text.includes('原因') && r1.text.includes('可能方案') && r1.text.includes('下一步操作'));

const sid = r1.sessionId;

// ---------- 2) 追问：追加轮次 ----------
const r2 = await (await fetch(`${API}/api/ai/explain-failure`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    context: CTX,
    sessionId: sid,
    messages: [
      { role: 'user', content: '诊断这次失败' },
      { role: 'assistant', content: '首轮回答' },
      { role: 'user', content: '那怎么恢复备份？' },
    ],
  }),
})).json();
check('追问沿用同一 sessionId', r2.sessionId === sid, `${r2.sessionId} vs ${sid}`);
check('追问命中追问分支', r2.text.includes('追问轮'));

// ---------- 3) 列表 ----------
const list = (await (await fetch(`${API}/api/ai/history`)).json()).history;
check('列表只有一个会话', list.length === 1, `实际 ${list.length}`);
check('列表轮数为 2', list[0]?.turnCount === 2, String(list[0]?.turnCount));
check('列表标题取游戏名', list[0]?.title === '空洞骑士', list[0]?.title);
check('列表保留错误码', list[0]?.code === 'VERIFY_FAILED', String(list[0]?.code));

// ---------- 4) 详情（UTF-8 完整性） ----------
const entry = (await (await fetch(`${API}/api/ai/history/${sid}`)).json()).entry;
check('详情轮数为 2', entry.turns.length === 2, String(entry.turns.length));
check('详情保留中文游戏名', entry.context.gameName === '空洞骑士', entry.context.gameName);
check('详情保留中文错误信息', entry.context.error === '落盘校验未通过', entry.context.error);
check('详情保留中文追问', entry.turns[1].question === '那怎么恢复备份？', entry.turns[1].question);
check('中文未被替换字符污染', !entry.title.includes('\uFFFD'), entry.title);

// ---------- 5) 重命名 / 置顶 ----------
const renamed = (await (await fetch(`${API}/api/ai/history/${sid}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: '空洞骑士·校验失败' }),
})).json()).session;
check('重命名生效', renamed.title === '空洞骑士·校验失败', renamed.title);
check('重命名中文无污染', !renamed.title.includes('\uFFFD'));

const pinned = (await (await fetch(`${API}/api/ai/history/${sid}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ pinned: true }),
})).json()).session;
check('置顶生效', pinned.pinned === true);
check('置顶后列表排最前', (await (await fetch(`${API}/api/ai/history`)).json()).history[0].id === sid);

// ---------- 6) 导出 Markdown ----------
const md = await (await fetch(`${API}/api/ai/history/${sid}/export`)).text();
check('导出含标题', md.includes('# 空洞骑士·校验失败'), md.slice(0, 40));
check('导出含现场表格', md.includes('| 错误码 | VERIFY_FAILED |'), md.slice(0, 200));
check('导出含追问', md.includes('那怎么恢复备份？'));
check('导出中文无污染', !md.includes('\uFFFD'));

// ---------- 7) 删除 ----------
check('删除返回 true', (await (await fetch(`${API}/api/ai/history/${sid}`, { method: 'DELETE' })).json()).success === true);
check('删除后列表为空', (await (await fetch(`${API}/api/ai/history`)).json()).history.length === 0);

// ---------- 8) 通用问答（无失败现场的新会话） ----------
const g1 = await (await fetch(`${API}/api/ai/explain-failure`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ context: {}, question: '怎么把 Steam 存档移植到 Xbox？' }),
})).json();
check('通用问答返回 sessionId', !!g1.sessionId, JSON.stringify(g1).slice(0, 120));
check('通用问答有回答', typeof g1.text === 'string' && g1.text.length > 0);
check('通用问答走的是通用提示词分支', g1.text.includes('通用首轮回答'), g1.text.slice(0, 60));

const gEntry = (await (await fetch(`${API}/api/ai/history/${g1.sessionId}`)).json()).entry;
check('通用问答标题取问题首句', gEntry.title === '怎么把 Steam 存档移植到 Xbox？', gEntry.title);
check('通用问答首轮问题已记录', gEntry.turns[0].question === '怎么把 Steam 存档移植到 Xbox？', String(gEntry.turns[0].question));
check('通用问答无失败现场', !gEntry.context.error && !gEntry.context.code);

// 通用问答的追问：首轮问题不应被重复插入
const g2 = await (await fetch(`${API}/api/ai/explain-failure`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    context: {},
    question: '怎么把 Steam 存档移植到 Xbox？',
    sessionId: g1.sessionId,
    messages: [
      { role: 'user', content: '怎么把 Steam 存档移植到 Xbox？' },
      { role: 'assistant', content: g1.text },
      { role: 'user', content: '那要先做什么准备？' },
    ],
  }),
})).json();
check('通用问答追问沿用同一会话', g2.sessionId === g1.sessionId, `${g2.sessionId} vs ${g1.sessionId}`);
check('通用问答追问走通用分支', g2.text.includes('通用追问轮回答'), g2.text.slice(0, 60));
const gEntry2 = (await (await fetch(`${API}/api/ai/history/${g1.sessionId}`)).json()).entry;
check('通用问答追问后轮数为 2', gEntry2.turns.length === 2, String(gEntry2.turns.length));
check('通用问答追问内容已记录', gEntry2.turns[1].question === '那要先做什么准备？', String(gEntry2.turns[1].question));

// ---------- 9) 失败但无游戏名 → 标题取错误信息 ----------
const n1 = await (await fetch(`${API}/api/ai/explain-failure`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    context: { error: '未找到 Steam 存档目录：D:/nx/s', direction: 'steam_to_xbox' },
    messages: [],
  }),
})).json();
const nEntry = (await (await fetch(`${API}/api/ai/history/${n1.sessionId}`)).json()).entry;
check('无游戏名的失败会话标题取错误信息', nEntry.title.startsWith('未找到 Steam 存档目录'), nEntry.title);
check('无游戏名的失败会话不是「未识别游戏」', nEntry.title !== '未识别游戏', nEntry.title);

// ---------- 10) 清理 ----------
await fetch(`${API}/api/ai/history`, { method: 'DELETE' });
check('全部清空', (await (await fetch(`${API}/api/ai/history`)).json()).history.length === 0);

// ---------- 收尾 ----------
serverProc.kill();
fake.close();
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

console.log(`\n${failed === 0 ? '全部通过' : failed + ' 项失败'}`);
process.exit(failed === 0 ? 0 : 1);
