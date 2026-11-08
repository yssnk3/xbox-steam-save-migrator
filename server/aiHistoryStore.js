import fs from 'fs';
import path from 'path';
import { getDataFilePath } from './dataDir.js';

/**
 * AI 诊断历史 — 落盘到数据目录的 ai-history.json。
 *
 * 只保留最近 N 条，避免无限增长；写入走 tmp + rename 原子替换。
 * 每条记录包含：时间、游戏、方向、错误码、用户问题、模型回答。
 */

const HISTORY_PATH = getDataFilePath('ai-history.json');
const MAX_ENTRIES = 20;

function readAll() {
  try {
    if (!fs.existsSync(HISTORY_PATH)) return [];
    const raw = fs.readFileSync(HISTORY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(entries) {
  const tmp = `${HISTORY_PATH}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), 'utf8');
  fs.renameSync(tmp, HISTORY_PATH);
}

/** 列表（最新在前），不带完整对话内容以控制体积。 */
export function listAiHistory() {
  return readAll().map(e => ({
    id: e.id,
    createdAt: e.createdAt,
    gameName: e.gameName || null,
    direction: e.direction || null,
    code: e.code || null,
    question: e.question || null,
    answerPreview: (e.answer || '').slice(0, 160),
    model: e.model || null,
  }));
}

/** 单条完整记录（含完整回答）。 */
export function getAiHistoryEntry(id) {
  return readAll().find(e => e.id === id) || null;
}

/** 追加一条，自动裁剪到 MAX_ENTRIES。 */
export function appendAiHistory(entry) {
  const record = {
    id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    gameName: entry.gameName || null,
    direction: entry.direction || null,
    code: entry.code || null,
    question: entry.question || null,
    answer: entry.answer || '',
    model: entry.model || null,
  };
  const all = [record, ...readAll()].slice(0, MAX_ENTRIES);
  writeAll(all);
  return record;
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

export { HISTORY_PATH, MAX_ENTRIES };
