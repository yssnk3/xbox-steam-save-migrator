import React, { useEffect, useState } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Plus,
  Search,
  Settings,
  Sun,
  Moon,
  Monitor,
  RefreshCw,
  HardDrive,
  Gamepad2,
  Library,
  Shield,
  Layers,
} from 'lucide-react';
import { ThemeMode } from '../theme';

export type TabKey = 'games' | 'xbox' | 'backups' | 'settings';

interface SidebarProps {
  activeTab: TabKey;
  setActiveTab: (tab: TabKey) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  detectedBothCount: number;
  gameCount?: number;
  backupCount?: number;
  libraryCount?: number;
  onAddCustomGame?: () => void;
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
 * Notion 式侧边栏。
 *
 * 结构对应官方文档的三段式：
 *   1. 固定区（workspace header / 搜索）：不随滚动移动
 *   2. 滚动区（nav）：分组 + 层级缩进，可折叠
 *   3. 固定区（footer）：主题/设置等全局入口
 *
 * 交互对齐 Notion：
 *   - 分组标题 hover 才显示展开箭头，平时只留一个小三角
 *   - 条目未选中无底色；hover 浅灰；选中浅灰 + 500 字重
 *   - 折叠状态持久化到 localStorage
 */

const COLLAPSE_KEY = 'sxsm-sidebar-collapsed';

function readCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  onRefresh,
  isRefreshing,
  detectedBothCount,
  gameCount = 0,
  backupCount = 0,
  libraryCount = 0,
  onAddCustomGame,
  themeMode,
  onCycleTheme,
}) => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed);
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsed));
    } catch {
      // 忽略
    }
  }, [collapsed]);

  const toggle = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

  const ThemeIcon = themeMode === 'light' ? Sun : themeMode === 'dark' ? Moon : Monitor;
  const themeLabel = themeMode === 'light' ? '浅色' : themeMode === 'dark' ? '深色' : '跟随系统';

  const favourites: NavEntry[] = [
    { key: 'games', icon: <Layers className="w-4 h-4" />, label: '游戏移植', count: gameCount },
    { key: 'xbox', icon: <Library className="w-4 h-4" />, label: 'Xbox 游戏库', count: libraryCount },
  ];

  const workspace: NavEntry[] = [
    { key: 'backups', icon: <Shield className="w-4 h-4" />, label: '备份中心', count: backupCount },
  ];

  /** 一个分组：标题行（可折叠）+ 缩进的子项 */
  const Group: React.FC<{
    id: string;
    label: string;
    entries: NavEntry[];
    action?: React.ReactNode;
  }> = ({ id, label, entries, action }) => {
    const isCollapsed = collapsed[id] === true;
    return (
      <div className="mb-1">
        <div
          className="nav-group-label"
          onMouseEnter={() => setHoveredGroup(id)}
          onMouseLeave={() => setHoveredGroup(null)}
        >
          <button
            onClick={() => toggle(id)}
            className="flex items-center gap-1 py-1.5 flex-1 min-w-0 text-left"
            aria-expanded={!isCollapsed}
          >
            <span className="w-4 h-4 flex items-center justify-center shrink-0">
              <ChevronRight
                className={`w-3 h-3 transition-transform duration-100 ${isCollapsed ? '' : 'rotate-90'}`}
                style={{ opacity: hoveredGroup === id ? 1 : 0.55 }}
              />
            </span>
            <span className="truncate">{label}</span>
          </button>
          {action && <span className="shrink-0">{action}</span>}
        </div>

        {!isCollapsed && (
          <div className="mt-0.5 space-y-px">
            {entries.map(entry => (
              <button
                key={entry.key}
                onClick={() => setActiveTab(entry.key)}
                data-active={activeTab === entry.key}
                className="nav-item"
                style={{ paddingLeft: 28 }}
                title={entry.label}
              >
                <span className="shrink-0 opacity-70">{entry.icon}</span>
                <span className="truncate flex-1">{entry.label}</span>
                {typeof entry.count === 'number' && entry.count > 0 && (
                  <span className="text-[12px] text-ink-faint tabular-nums shrink-0">
                    {entry.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="w-[240px] shrink-0 h-screen sticky top-0 flex flex-col bg-ink-sidebar border-r border-ink-borderSoft select-none">
      {/* ---------- 固定区：workspace header ---------- */}
      <div className="shrink-0 px-3 pt-3 pb-1">
        <button className="nav-item" style={{ paddingLeft: 6 }} title="工作区">
          <div className="w-6 h-6 rounded-[4px] bg-ink-text flex items-center justify-center shrink-0">
            <Gamepad2 className="w-3.5 h-3.5 text-ink-base stroke-[2]" />
          </div>
          <div className="min-w-0 flex-1 text-left">
            <div className="text-[14px] font-semibold text-ink-text leading-tight truncate">
              Steam ↔ Xbox
            </div>
          </div>
          <ChevronDown className="w-3.5 h-3.5 text-ink-faint shrink-0" />
        </button>
      </div>

      {/* ---------- 固定区：搜索 ---------- */}
      <div className="shrink-0 px-2 pb-1">
        <button className="nav-item" style={{ paddingLeft: 8 }} title="搜索">
          <Search className="w-4 h-4 opacity-70 shrink-0" />
          <span className="flex-1 text-left truncate">搜索</span>
          <kbd className="text-[11px] text-ink-faint font-sans shrink-0">Ctrl K</kbd>
        </button>
      </div>

      {/* ---------- 滚动区：导航 ---------- */}
      <nav className="flex-1 overflow-y-auto px-2 pb-2 min-h-0">
        <Group
          id="favourites"
          label="收藏"
          entries={favourites}
          action={
            onAddCustomGame ? (
              <button
                onClick={onAddCustomGame}
                className="w-5 h-5 flex items-center justify-center rounded-[4px] text-ink-faint hover:bg-ink-hover hover:text-ink-text transition-colors"
                title="添加自定义游戏"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            ) : undefined
          }
        />

        <Group id="workspace" label="工作区" entries={workspace} />

        {/* 「本机」：环境状态与重扫入口，模仿 Notion 的近期页分组 */}
        <div className="mb-1">
          <div className="nav-group-label">
            <span className="flex items-center gap-1 py-1.5">
              <span className="w-4 h-4 flex items-center justify-center shrink-0">
                <ChevronRight className="w-3 h-3 rotate-90" style={{ opacity: 0.55 }} />
              </span>
              <span className="truncate">本机</span>
            </span>
          </div>
          <div className="mt-0.5 space-y-px">
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="nav-item"
              style={{ paddingLeft: 28 }}
              title="重新扫描本机存档"
            >
              <RefreshCw
                className={`w-4 h-4 opacity-70 shrink-0 ${isRefreshing ? 'animate-spin' : ''}`}
              />
              <span className="truncate flex-1 text-left">
                {isRefreshing ? '扫描中…' : '重新扫描'}
              </span>
            </button>
            <div
              className="nav-item"
              style={{ paddingLeft: 28, color: 'var(--ink-faint)', pointerEvents: 'none' }}
            >
              <HardDrive className="w-4 h-4 opacity-70 shrink-0" />
              <span className="truncate flex-1">双端存档</span>
              <span className="text-[12px] tabular-nums shrink-0">{detectedBothCount}</span>
            </div>
          </div>
        </div>
      </nav>

      {/* ---------- 固定区：footer ---------- */}
      <div className="shrink-0 px-2 py-2 border-t border-ink-borderSoft space-y-px">
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