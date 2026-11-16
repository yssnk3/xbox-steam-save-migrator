import React from 'react';

/**
 * 用户可拖的布局几何。
 *
 * 存储两层：拖动过程中写 localStorage（零延迟），松手后 PUT 到 settings.json
 * （跨设备一致）。启动时先读缓存渲染，再用服务器值校正。
 *
 * ponytail: 单例 + 订阅通知。多组件同时读同一份配置，做 Context 只为省
 * 一层 props，不值得；将来出现第二个消费者再抽。
 */

export interface LayoutSettings {
  sidebarWidth: number;
  topbarHeight: number;
  contentPadding: number;
  logWidth: number;
  logHeight: number;
  /** 日志浮窗距视口右/下的偏移；拖动标题栏时改这两个值 */
  logX: number;
  logY: number;
  aiListWidth: number;
  aiPanelHeight: number;
}

/** 可安全传给 API 的形态（saveSettings 要 Record<string, number>） */
export function toLayoutPatch(l: LayoutSettings): Record<string, number> {
  return { ...l };
}

export type LayoutKey = keyof LayoutSettings;

/** 与 server/settingsStore.js 的 LAYOUT_LIMITS 必须保持一致。 */
export const LAYOUT_LIMITS: Record<LayoutKey, [number, number]> = {
  sidebarWidth: [180, 420],
  topbarHeight: [36, 72],
  contentPadding: [16, 96],
  logWidth: [280, 720],
  logHeight: [160, 600],
  // 位置偏移：0 = 贴右/贴底，正值 = 往左/往上移
  logX: [0, 1200],
  logY: [0, 800],
  aiListWidth: [200, 420],
  aiPanelHeight: [420, 1200],
};

export const DEFAULT_LAYOUT: LayoutSettings = {
  sidebarWidth: 240,
  topbarHeight: 45,
  contentPadding: 48,
  logWidth: 384,
  logHeight: 288,
  logX: 0,
  logY: 0,
  aiListWidth: 260,
  aiPanelHeight: 640,
};

const CACHE_KEY = 'sxsm-layout';

export function clampLayout(key: LayoutKey, value: number): number {
  const [min, max] = LAYOUT_LIMITS[key];
  if (!Number.isFinite(value)) return DEFAULT_LAYOUT[key];
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** 把任意来源的对象规整成合法 LayoutSettings（丢弃未知键、钳制越界值）。 */
export function sanitizeLayout(raw: unknown): LayoutSettings {
  const out = { ...DEFAULT_LAYOUT };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(DEFAULT_LAYOUT) as LayoutKey[]) {
    const v = (raw as Record<string, unknown>)[key];
    if (v === undefined || v === null) continue;
    out[key] = clampLayout(key, Number(v));
  }
  return out;
}

// ---------- 单例状态 + 订阅 ----------

let current: LayoutSettings = { ...DEFAULT_LAYOUT };
const listeners = new Set<(next: LayoutSettings) => void>();

function emit() {
  for (const fn of listeners) fn(current);
}

export function getLayout(): LayoutSettings {
  return current;
}

export function subscribeLayout(fn: (next: LayoutSettings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 拖动过程中调用：只更新内存 + localStorage，不碰服务器。 */
export function setLayoutLive(patch: Partial<LayoutSettings>): void {
  const next = { ...current };
  for (const key of Object.keys(patch) as LayoutKey[]) {
    const v = patch[key];
    if (v === undefined) continue;
    next[key] = clampLayout(key, v); // 实时钳制：拖过头也不会让元素跑出屏幕
  }
  current = next;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(current));
  } catch {}
  emit();
}

/** 松手时调用：与服务器同步。失败不回滚（本地缓存仍是最新值）。 */
export async function persistLayout(patch: Partial<LayoutSettings>): Promise<boolean> {
  const { saveSettings } = await import('./services/api');
  try {
    await saveSettings({ layout: toLayoutPatch(patch as LayoutSettings) });
    return true;
  } catch {
    return false;
  }
}

/** 启动时：localStorage 先渲染，返回值供 App 用服务器值校正。 */
export function loadCachedLayout(): LayoutSettings {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) current = sanitizeLayout(JSON.parse(raw));
  } catch {}
  return current;
}

/** 用服务器值覆盖本地（服务器优先，与 theme 的既定行为一致）。 */
export function applyServerLayout(raw: unknown): void {
  current = sanitizeLayout(raw);
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(current));
  } catch {}
  emit();
}

/** 恢复默认：清缓存 + 内存复位，服务器由调用方写回。 */
export function resetLayout(): LayoutSettings {
  current = { ...DEFAULT_LAYOUT };
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {}
  emit();
  return current;
}

/**
 * 组件侧订阅：返回响应式的 layout 对象。
 *
 * 用 useSyncExternalStore 而不是 useState+useEffect：store 在组件挂载前就可能
 * 变（App 启动时用服务器值校正），useSyncExternalStore 首帧就能拿到正确快照，
 * 不会闪一帧默认值。
 */
export function useLayout(): LayoutSettings {
  return React.useSyncExternalStore(subscribeLayout, getLayout, getLayout);
}