import React from 'react';
import {
  Search,
  Settings,
  Sun,
  Moon,
  Monitor,
  RefreshCw,
  Gamepad2,
  Library,
  Shield,
  Layers,
  Sparkles,
} from 'lucide-react';
import { ThemeMode } from '../theme';
import { useLayout } from '../layout';
import { DragHandle } from './DragHandle';

export type TabKey = 'games' | 'xbox' | 'backups' | 'ai' | 'settings';

interface SidebarProps {
  activeTab: TabKey;
  setActiveTab: (tab: TabKey) => void;
  /** 全局扫描：一次同时扫存档与 Xbox 游戏库 */
  onScan: () => void;
  isScanning: boolean;
  detectedBothCount: number;
  gameCount?: number;
  backupCount?: number;
  libraryCount?: number;
  /** AI 诊断会话数 */
  aiCount?: number;
  onOpenSearch: () => void;
  themeMode: ThemeMode;
  onCycleTheme: () => void;
}

interface NavEntry {
  key: TabKey;
  icon: React.ReactNode;
  label: string;
  count?: number;
}

/**
 * Notion 式侧边栏（简化版）。
 *
 * 结构：固定区（工作区头 + 搜索）→ 滚动区（4 项平铺导航）
 *       → 固定区（扫描按钮 + 主题 + 设置）。
 * 去掉了分组与缩进，条目同级平铺。
 */
export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  onScan,
  isScanning,
  detectedBothCount,
  gameCount = 0,
  backupCount = 0,
  libraryCount = 0,
  aiCount = 0,
  onOpenSearch,
  themeMode,
  onCycleTheme,
}) => {
  const ThemeIcon = themeMode === 'light' ? Sun : themeMode === 'dark' ? Moon : Monitor;
  const themeLabel = themeMode === 'light' ? '浅色' : themeMode === 'dark' ? '深色' : '跟随系统';
  const { sidebarWidth } = useLayout();

  const navItems: NavEntry[] = [
    { key: 'games', icon: <Layers className="w-4 h-4" />, label: '游戏移植', count: gameCount },
    { key: 'xbox', icon: <Library className="w-4 h-4" />, label: 'Xbox 游戏库', count: libraryCount },
    { key: 'backups', icon: <Shield className="w-4 h-4" />, label: '备份中心', count: backupCount },
    { key: 'ai', icon: <Sparkles className="w-4 h-4" />, label: 'AI 诊断', count: aiCount },
  ];

  return (
    <aside
      className="relative shrink-0 h-screen sticky top-0 flex flex-col bg-ink-sidebar border-r border-ink-borderSoft select-none"
      style={{ width: sidebarWidth }}
    >
      {/* 右边缘拖拽调宽 */}
      <DragHandle layoutKey="sidebarWidth" edge="right" label="拖动调整侧边栏宽度" />
      {/* ---------- 固定区：工作区头 ---------- */}
      <div className="shrink-0 px-2 pt-3 pb-1">
        <button className="nav-item" style={{ paddingLeft: 6 }} title="Steam ↔ Xbox 存档移植">
          <div className="w-6 h-6 rounded-[4px] bg-ink-text flex items-center justify-center shrink-0">
            <Gamepad2 className="w-3.5 h-3.5 text-ink-base stroke-[2]" />
          </div>
          <div className="min-w-0 flex-1 text-left">
            <div className="text-[14px] font-semibold text-ink-text leading-tight truncate">
              Steam ↔ Xbox
            </div>
          </div>
        </button>
      </div>

      {/* ---------- 固定区：搜索（真实可用） ---------- */}
      <div className="shrink-0 px-2 pb-1">
        <button
          onClick={onOpenSearch}
          className="nav-item"
          style={{ paddingLeft: 8 }}
          title="搜索游戏（Ctrl+K）"
        >
          <Search className="w-4 h-4 opacity-70 shrink-0" />
          <span className="flex-1 text-left truncate">搜索</span>
          <kbd className="text-[11px] text-ink-faint font-sans shrink-0">Ctrl K</kbd>
        </button>
      </div>

      {/* ---------- 滚动区：平铺导航 ---------- */}
      <nav className="flex-1 overflow-y-auto px-2 py-1 min-h-0 space-y-px">
        {navItems.map(item => (
          <button
            key={item.key}
            onClick={() => setActiveTab(item.key)}
            data-active={activeTab === item.key}
            className="nav-item"
            style={{ paddingLeft: 8 }}
            title={item.label}
          >
            <span className="shrink-0 opacity-70">{item.icon}</span>
            <span className="truncate flex-1">{item.label}</span>
            {typeof item.count === 'number' && item.count > 0 && (
              <span className="text-[12px] text-ink-faint tabular-nums shrink-0">{item.count}</span>
            )}
          </button>
        ))}
      </nav>

      {/* ---------- 固定区：扫描（左下）+ 全局入口 ---------- */}
      <div className="shrink-0 px-2 pb-2 pt-1 border-t border-ink-borderSoft space-y-px">
        {/* 扫描：独立且醒目，一次同时刷存档与游戏库 */}
        <button
          onClick={onScan}
          disabled={isScanning}
          className="nav-item font-medium"
          style={{ paddingLeft: 8 }}
          title={`扫描本机存档与 Xbox 游戏库${detectedBothCount ? `（当前 ${detectedBothCount} 款双端就绪）` : ''}`}
        >
          <RefreshCw className={`w-4 h-4 shrink-0 ${isScanning ? 'animate-spin' : ''}`} />
          <span className="truncate flex-1">{isScanning ? '扫描中…' : '扫描'}</span>
          {!isScanning && detectedBothCount > 0 && (
            <span className="text-[12px] text-ink-faint tabular-nums shrink-0">
              {detectedBothCount}
            </span>
          )}
        </button>

        <button
          onClick={onCycleTheme}
          className="nav-item"
          style={{ paddingLeft: 8 }}
          title="切换主题（跟随系统 → 浅色 → 深色）"
        >
          <ThemeIcon className="w-4 h-4 opacity-70 shrink-0" />
          <span className="truncate flex-1 text-left">{themeLabel}</span>
        </button>

        <button
          onClick={() => setActiveTab('settings')}
          data-active={activeTab === 'settings'}
          className="nav-item"
          style={{ paddingLeft: 8 }}
          title="设置"
        >
          <Settings className="w-4 h-4 opacity-70 shrink-0" />
          <span className="truncate flex-1 text-left">设置</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;