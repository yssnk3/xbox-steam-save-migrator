import fs from 'fs';
import path from 'path';
import { getDataFilePath } from './dataDir.js';

/**
 * 扫描文件夹得到的游戏列表 — 落盘到数据目录的 scanned-games.json。
 *
 * 与 customGamesStore.js 分开：扫描结果是"自动识别出来的"，
 * 自定义游戏是"用户手动添加的"，两者来源和生命周期不同。
 *
 * 每条记录：
 *   { id, name, folderPath, files: [{name, size, modified}],
 *     matchedGameId (匹配到的已知游戏 ID，未识别为 null),
 *     steamSavePath, xboxWgsPath (如果识别到了双端路径),
 *     scannedAt }
 */

const STORE_PATH = getDataFilePath('scanned-games.json');

function readAll() {
  try {
    if (!fs.existsSync(STORE_PATH)) return [];
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function writeAll(entries) {
  const tmp = `${STORE_PATH}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), 'utf8');
  fs.renameSync(tmp, STORE_PATH);
}

export function getScannedGames() {
  return readAll();
}

export function addScannedGame(entry) {
  const all = readAll();
  // 同路径去重：已存在则覆盖
  const idx = all.findIndex(e => e.folderPath === entry.folderPath);
  if (idx >= 0) {
    all[idx] = { ...all[idx], ...entry, scannedAt: new Date().toISOString() };
  } else {
    all.unshift({ ...entry, id: entry.id || `scan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, scannedAt: new Date().toISOString() });
  }
  writeAll(all);
  return all;
}

export function deleteScannedGame(id) {
  const all = readAll();
  const next = all.filter(e => e.id !== id);
  if (next.length === all.length) return false;
  writeAll(next);
  return true;
}

export function clearScannedGames() {
  writeAll([]);
  return true;
}