import fs from 'fs';
import path from 'path';
import { getSettingsPath } from './dataDir.js';

/**
 * 设置持久化 — 落盘到项目根 settings.json。
 *
 * 与 customGamesStore.js 的差别：写入走 tmp + rename 原子替换，避免写一半崩溃
 * 把配置写成空文件；读取时与默认值深合并，旧版本缺字段也能正常用。
 * API Key 只存在服务端，对外一律走 getPublicSettings()（只回 hint，不回明文）。
 */

const STORE_PATH = getSettingsPath();

const DEFAULTS = {
  ai: {
    enabled: false,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    timeoutMs: 20000,
    autoAnalyze: false,
  },
  backup: {
    keepCount: 50,
  },
  // 用户手动覆盖的根目录；空串表示自动探测
  paths: {
    steamRoot: '',
    xboxPackagesRoot: '',
  },
  appearance: {
    theme: 'system',   // 'system' | 'light' | 'dark'
    accent: 'neutral', // 'neutral' | 'blue' | 'green' | 'orange' | 'violet'
  },
};

const THEMES = ['system', 'light', 'dark'];
const ACCENTS = ['neutral', 'blue', 'green', 'orange', 'violet'];

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/** Deep-merge stored settings over defaults so missing keys never crash callers. */
function withDefaults(stored) {
  const out = clone(DEFAULTS);
  if (!stored || typeof stored !== 'object') return out;
  for (const group of Object.keys(DEFAULTS)) {
    if (!stored[group] || typeof stored[group] !== 'object') continue;
    for (const key of Object.keys(DEFAULTS[group])) {
      if (stored[group][key] !== undefined) out[group][key] = stored[group][key];
    }
  }
  return out;
}

/** Full settings including the plaintext apiKey — server-internal use only. */
export function readSettings() {
  try {
    if (!fs.existsSync(STORE_PATH)) return clone(DEFAULTS);
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    return withDefaults(JSON.parse(raw));
  } catch {
    // Corrupt or unreadable file: fall back to defaults rather than breaking the app.
    return clone(DEFAULTS);
  }
}

/** Atomic write: tmp file in the same dir, then rename over the target. */
function writeAtomic(settings) {
  const tmp = `${STORE_PATH}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
  fs.renameSync(tmp, STORE_PATH);
}

/**
 * Shallow-merge a patch into stored settings.
 * `apiKey` semantics: undefined / null = keep the existing key;
 * empty string = explicitly clear it. This lets the UI never hold the secret.
 */
export function writeSettings(patch = {}) {
  const current = readSettings();
  const next = withDefaults(current);

  if (patch.ai && typeof patch.ai === 'object') {
    for (const key of Object.keys(DEFAULTS.ai)) {
      const value = patch.ai[key];
      if (value === undefined) continue;
      if (key === 'apiKey') {
        if (value === null) continue;      // keep existing
        next.ai.apiKey = String(value).trim();
        continue;
      }
      next.ai[key] = value;
    }
  }

  if (patch.backup && typeof patch.backup === 'object') {
    for (const key of Object.keys(DEFAULTS.backup)) {
      if (patch.backup[key] === undefined) continue;
      next.backup[key] = patch.backup[key];
    }
  }

  if (patch.paths && typeof patch.paths === 'object') {
    for (const key of Object.keys(DEFAULTS.paths)) {
      const value = patch.paths[key];
      if (value === undefined) continue;
      // 空串 = 清除覆盖，回到自动探测
      next.paths[key] = value === null ? '' : String(value).trim();
    }
  }

  if (patch.appearance && typeof patch.appearance === 'object') {
    const theme = patch.appearance.theme;
    if (theme !== undefined && THEMES.includes(theme)) next.appearance.theme = theme;
    const accent = patch.appearance.accent;
    if (accent !== undefined && ACCENTS.includes(accent)) next.appearance.accent = accent;
  }

  // Clamp numeric fields to sane ranges so a typo can't hang the UI.
  const timeout = Number(next.ai.timeoutMs);
  next.ai.timeoutMs = Number.isFinite(timeout) ? Math.min(120000, Math.max(3000, timeout)) : DEFAULTS.ai.timeoutMs;
  const keep = Number(next.backup.keepCount);
  next.backup.keepCount = Number.isFinite(keep) ? Math.min(500, Math.max(1, Math.floor(keep))) : DEFAULTS.backup.keepCount;

  next.ai.baseUrl = String(next.ai.baseUrl || DEFAULTS.ai.baseUrl).replace(/\/+$/, '');
  next.ai.model = String(next.ai.model || DEFAULTS.ai.model);
  next.ai.enabled = Boolean(next.ai.enabled);
  next.ai.autoAnalyze = Boolean(next.ai.autoAnalyze);

  writeAtomic(next);
  return next;
}

/** Redact the key: never hand the plaintext to the renderer. */
export function getPublicSettings() {
  const s = readSettings();
  const key = s.ai.apiKey || '';
  return {
    ai: {
      enabled: s.ai.enabled,
      baseUrl: s.ai.baseUrl,
      model: s.ai.model,
      timeoutMs: s.ai.timeoutMs,
      autoAnalyze: s.ai.autoAnalyze,
      apiKeySet: key.length > 0,
      apiKeyHint: key.length > 0 ? `••••${key.slice(-4)}` : '',
    },
    backup: s.backup,
    paths: s.paths,
    appearance: s.appearance,
    storePath: STORE_PATH,
  };
}

export { STORE_PATH, DEFAULTS, THEMES, ACCENTS };
