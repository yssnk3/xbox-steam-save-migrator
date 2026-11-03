import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * 统一数据目录解析。
 *
 * 开发/免安装目录运行时用项目根（方便调试、也符合"绿色版"直觉）；
 * 但 portable 单文件 exe 每次运行都会解压到新的临时目录，process.cwd()
 * 指向那里，程序一关 Backups/ 和 settings.json 就随临时目录消失——
 * 用户会丢备份、丢 AI 配置。所以打包环境下必须落到用户数据目录。
 *
 * 判定依据：Electron 打包后 process.defaultApp 为 undefined 且
 * process.resourcesPath 指向安装目录下的 resources。
 */

const APP_DIR_NAME = 'Steam-Xbox-Save-Migrator';

function isPackaged() {
  // Electron 打包运行时 defaultApp 不存在；纯 node 运行（开发）时为 undefined 也算 false
  if (typeof process !== 'undefined' && process.versions && process.versions.electron) {
    return !process.defaultApp;
  }
  return false;
}

/** Root directory for all persisted user data (backups, settings). */
export function getDataRoot() {
  const override = process.env.SXSM_DATA_DIR;
  if (override) return ensureDir(override);

  if (isPackaged()) {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return ensureDir(path.join(base, APP_DIR_NAME));
  }

  // Dev / 绿色解压运行：项目根
  return ensureDir(process.cwd());
}

function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {
    // 目录不可写时退回临时目录，至少不让整个进程崩掉
    const fallback = path.join(os.tmpdir(), APP_DIR_NAME);
    try {
      if (!fs.existsSync(fallback)) fs.mkdirSync(fallback, { recursive: true });
    } catch {}
    return fallback;
  }
  return dir;
}

/** Where ZIP backups live. */
export function getBackupRoot() {
  return ensureDir(path.join(getDataRoot(), 'Backups'));
}

/** Where settings.json lives. */
export function getSettingsPath() {
  return path.join(getDataRoot(), 'settings.json');
}

/** Where custom_paths.txt / custom_games.json live (same root, keeps them together). */
export function getDataFilePath(name) {
  return path.join(getDataRoot(), name);
}

export { isPackaged };
