/**
 * 主题应用 — 把 theme/accent 写到 <html> 的 data 属性上，CSS 变量随之切换。
 *
 * 启动顺序很关键：先读 localStorage 缓存立即上色（避免浅色用户看到一帧深色），
 * 再从服务端 settings 同步权威值。两者不一致时以服务端为准。
 */

export type ThemeMode = 'system' | 'light' | 'dark';
export type AccentColor = 'neutral' | 'blue' | 'green' | 'orange' | 'violet';

export interface AppearanceSettings {
  theme: ThemeMode;
  accent: AccentColor;
}

export const DEFAULT_APPEARANCE: AppearanceSettings = { theme: 'system', accent: 'neutral' };

export const ACCENT_OPTIONS: { value: AccentColor; label: string; swatch: string }[] = [
  { value: 'neutral', label: '中性', swatch: '#8B8FA3' },
  { value: 'blue', label: '蓝', swatch: '#3B82F6' },
  { value: 'green', label: '绿', swatch: '#10B981' },
  { value: 'orange', label: '橙', swatch: '#F59E0B' },
  { value: 'violet', label: '紫', swatch: '#8B5CF6' },
];

const CACHE_KEY = 'sxsm-appearance';

function prefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** 把 mode 解析成实际生效的明/暗。 */
export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode;
  return prefersDark() ? 'dark' : 'light';
}

/** 写入 DOM。这是唯一的副作用入口。 */
export function applyTheme(appearance: AppearanceSettings) {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme(appearance.theme);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.accent = appearance.accent;
  document.documentElement.dataset.themeMode = appearance.theme;
}

/** 启动时先用缓存上色，返回缓存值供后续比对。 */
export function applyCachedTheme(): AppearanceSettings {
  let cached: AppearanceSettings = DEFAULT_APPEARANCE;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        cached = {
          theme: ['system', 'light', 'dark'].includes(parsed.theme) ? parsed.theme : 'system',
          accent: ['neutral', 'blue', 'green', 'orange', 'violet'].includes(parsed.accent)
            ? parsed.accent
            : 'neutral',
        };
      }
    }
  } catch {
    // 缓存损坏就用默认值
  }
  applyTheme(cached);
  return cached;
}

/** 保存到 localStorage（服务端那份由调用方负责）。 */
export function cacheTheme(appearance: AppearanceSettings) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(appearance));
  } catch {
    // 隐私模式下可能失败，忽略
  }
}

/**
 * 监听系统主题变化。仅当 mode === 'system' 时才重绘。
 * @returns 取消监听函数
 */
export function watchSystemTheme(getMode: () => ThemeMode, onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => {
    if (getMode() === 'system') onChange();
  };
  // Safari < 14 用 addListener
  if (mq.addEventListener) mq.addEventListener('change', handler);
  else if (mq.addListener) mq.addListener(handler);
  return () => {
    if (mq.removeEventListener) mq.removeEventListener('change', handler);
    else if (mq.removeListener) mq.removeListener(handler);
  };
}
