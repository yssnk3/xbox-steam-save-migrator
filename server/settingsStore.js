import fs from 'fs';
import path from 'path';

/**
 * 设置持久化 — 落盘到项目根 settings.json。
 *
 * 与 customGamesStore.js 的差别：写入走 tmp + rename 原子替换，避免写一半崩溃
 * 把配置写成空文件；读取时与默认值深合并，旧版本缺字段也能正常用。
 * API Key 只存在服务端，对外一律走 getPublicSettings()（只回 hint，不回明文）。
 */

const STORE_PATH = path.join(process.cwd(), 'settings.json');

const DEFAULTS = {
  ai: {
    enabled: false,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    timeoutMs: 20000,
  },
  backup: {
    keepCount: 50,
  },
};

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

  // Clamp numeric fields to sane ranges so a typo can't hang the UI.
  const timeout = Number(next.ai.timeoutMs);
  next.ai.timeoutMs = Number.isFinite(timeout) ? Math.min(120000, Math.max(3000, timeout)) : DEFAULTS.ai.timeoutMs;
  const keep = Number(next.backup.keepCount);
  next.backup.keepCount = Number.isFinite(keep) ? Math.min(500, Math.max(1, Math.floor(keep))) : DEFAULTS.backup.keepCount;

  next.ai.baseUrl = String(next.ai.baseUrl || DEFAULTS.ai.baseUrl).replace(/\/+$/, '');
  next.ai.model = String(next.ai.model || DEFAULTS.ai.model);
  next.ai.enabled = Boolean(next.ai.enabled);

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
      apiKeySet: key.length > 0,
      apiKeyHint: key.length > 0 ? `••••${key.slice(-4)}` : '',
    },
    backup: s.backup,
    storePath: STORE_PATH,
  };
}

export { STORE_PATH, DEFAULTS };
