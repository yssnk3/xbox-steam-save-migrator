import fs from 'fs';
import path from 'path';
import { getDataFilePath } from './dataDir.js';

/**
 * AI 诊断会话 — 落盘到数据目录的 ai-history.json。
 *
 * 结构升级说明（v2 · sessions）：
 * 旧结构是「一条 = 一次问答」的扁平数组；新结构是「一个会话 = 一次失败 + 多轮问答」。
 * 读取时做一次兼容迁移：旧数组里的每条记录被视作"单轮会话"，
 * 迁移后的文件写回磁盘时永久变成 sessions 结构。
 *
 * 会话结构：
 *   { id, title, createdAt, updatedAt, pinned,
 *     context: FailureContext, turns: [{ question, answer, model, at }] }
 *
 * 上限按会话数（MAX_SESSIONS）而不是条数控制；单条回答截断 MAX_ANSWER_CHARS。
 * 写入走 tmp + rename 原子替换。
 */

const HISTORY_PATH = getDataFilePath('ai-history.json');
const MAX_SESSIONS = 50;
const MAX_ANSWER_CHARS = 8000;
const PREVIEW_CHARS = 160;

function newId() {
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 从问题首句派生会话标题（截断到 24 字，带省略号）；空输入返回空串。 */
function deriveTitle(text) {
  const q = (text || '').trim().replace(/\s+/g, ' ');
  if (!q) return '';
  return q.length > 24 ? q.slice(0, 24) + '…' : q;
}

/** 旧记录 → 单轮会话。 */
function migrateLegacyRecord(rec) {
  return {
    id: rec.id || newId(),
    title: rec.gameName || '未识别游戏',
    createdAt: rec.createdAt || new Date().toISOString(),
    updatedAt: rec.createdAt || new Date().toISOString(),
    pinned: false,
    context: {
      gameName: rec.gameName || null,
      direction: rec.direction || null,
      code: rec.code || null,
      error: rec.question || null,
    },
    turns: [
      {
        question: null,
        answer: rec.answer || '',
        model: rec.model || null,
        at: rec.createdAt || new Date().toISOString(),
      },
    ],
  };
}

function readAll() {
  try {
    if (!fs.existsSync(HISTORY_PATH)) return [];
    const raw = fs.readFileSync(HISTORY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // 旧结构：迁移成单轮会话
      return parsed.map(migrateLegacyRecord);
    }
    if (parsed && Array.isArray(parsed.sessions)) return parsed.sessions;
    return [];
  } catch {
    return [];
  }
}

function writeAll(sessions) {
  const tmp = `${HISTORY_PATH}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify({ sessions }, null, 2), 'utf8');
  fs.renameSync(tmp, HISTORY_PATH);
}

/** 会话列表（最新在前），不带完整回答以控制体积。 */
export function listAiHistory() {
  return readAll()
    .slice()
    .sort((a, b) => {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      return String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt));
    })
    .map(s => {
      const last = s.turns?.[s.turns.length - 1];
      return {
        id: s.id,
        title: s.title || '未识别游戏',
        createdAt: s.createdAt,
        updatedAt: s.updatedAt || s.createdAt,
        pinned: !!s.pinned,
        gameName: s.context?.gameName || null,
        direction: s.context?.direction || null,
        code: s.context?.code || null,
        turnCount: s.turns?.length || 0,
        answerPreview: (last?.answer || '').slice(0, PREVIEW_CHARS),
        model: last?.model || null,
      };
    });
}

/** 单个完整会话（含 context 与全部轮次）。 */
export function getAiHistoryEntry(id) {
  return readAll().find(s => s.id === id) || null;
}

/**
 * 新建会话或向已有会话追加一轮。
 *
 * @param {object} entry
 * @param {string} [entry.sessionId] 给了就追加到该会话；没给就新建
 * @param {object} [entry.context] 失败现场上下文
 * @param {string|null} [entry.question] 本轮用户提问；首轮为 null
 * @param {string} [entry.answer] 本轮模型回答
 * @param {string} [entry.model] 模型名
 * @param {string} [entry.title] 会话标题（新建时用，缺省取游戏名）
 */
export function appendAiHistory(entry) {
  const all = readAll();
  const now = new Date().toISOString();
  const answer = String(entry.answer || '').slice(0, MAX_ANSWER_CHARS);

  let session = entry.sessionId ? all.find(s => s.id === entry.sessionId) : null;

  if (session) {
    session.turns = session.turns || [];
    session.turns.push({
      question: entry.question ?? null,
      answer,
      model: entry.model || null,
      at: now,
    });
    session.updatedAt = now;
  } else {
    session = {
      id: newId(),
      // 标题优先级：显式标题 → 游戏名 → 首轮问题 → 错误信息 → 兜底
      // （自定义移植的失败没有游戏名，用错误信息当标题比「未识别游戏」有用）
      title: entry.title
        || entry.context?.gameName
        || deriveTitle(entry.question)
        || deriveTitle(entry.context?.error)
        || '未识别游戏',
      createdAt: now,
      updatedAt: now,
      pinned: false,
      context: entry.context || {},
      turns: [{ question: entry.question ?? null, answer, model: entry.model || null, at: now }],
    };
    all.unshift(session);
  }

  // 会话数上限：置顶的永远保留，其余按更新时间淘汰
  const pinned = all.filter(s => s.pinned);
  const rest = all.filter(s => !s.pinned);
  const kept = [...pinned, ...rest].slice(0, MAX_SESSIONS);
  writeAll(kept);
  return session;
}

/** 重命名 / 置顶。返回更新后的会话或 null。 */
export function updateAiHistory(id, patch) {
  const all = readAll();
  const session = all.find(s => s.id === id);
  if (!session) return null;
  if (typeof patch.title === 'string' && patch.title.trim()) session.title = patch.title.trim();
  if (typeof patch.pinned === 'boolean') session.pinned = patch.pinned;
  session.updatedAt = new Date().toISOString();
  writeAll(all);
  return session;
}

/** 删除单条；返回是否真的删掉了。 */
export function deleteAiHistory(id) {
  const all = readAll();
  const next = all.filter(e => e.id !== id);
  if (next.length === all.length) return false;
  writeAll(next);
  return true;
}

/** 清空全部。 */
export function clearAiHistory() {
  writeAll([]);
  return true;
}

/** 把会话导出成 Markdown。 */
export function exportAiSessionMarkdown(session) {
  const lines = [];
  lines.push(`# ${session.title || '未命名会话'}`);
  lines.push('');
  const ctx = session.context || {};
  const facts = [
    ['游戏', ctx.gameName],
    ['错误码', ctx.code],
    ['方向', ctx.direction],
    ['发生位置', ctx.stage],
    ['错误信息', ctx.error],
  ].filter(([, v]) => v);
  if (facts.length) {
    lines.push('| 项 | 值 |');
    lines.push('| --- | --- |');
    for (const [k, v] of facts) lines.push(`| ${k} | ${String(v).replace(/\|/g, '\\|')} |`);
    lines.push('');
  }
  lines.push(`创建时间：${session.createdAt}`);
  lines.push('');
  for (const [i, turn] of (session.turns || []).entries()) {
    if (turn.question) {
      lines.push(`## 追问 ${i + 1}`);
      lines.push('');
      lines.push(turn.question);
      lines.push('');
    }
    lines.push(`## 诊断结果 ${i + 1}`);
    lines.push('');
    lines.push(turn.answer || '');
    lines.push('');
  }
  return lines.join('\n');
}

export { HISTORY_PATH, MAX_SESSIONS, MAX_ANSWER_CHARS };
