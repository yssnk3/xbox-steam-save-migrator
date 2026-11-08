import React from 'react';
import { RefreshCw, Shield, Layers, Gamepad2, Library, Settings, Sun, Moon } from 'lucide-react';
import { ThemeMode } from '../theme';

export type TabKey = 'games' | 'backups' | 'xbox' | 'settings';

interface SidebarProps {
  activeTab: TabKey;
  setActiveTab: (tab: TabKey) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  detectedBothCount: number;
  themeMode: ThemeMode;
  onCycleTheme: () => void;
}

const TABS: { key: TabKey; icon: React.ReactNode; label: string }[] = [
  { key: 'games', icon: <Layers className="w-4 h-4" />, label: '游戏移植' },
  { key: 'xbox', icon: <Library className="w-4 h-4" />, label: 'Xbox 游戏库' },
  { key: 'backups', icon: <Shield className="w-4 h-4" />, label: '备份中心' },
  { key: 'settings', icon: <Settings className="w-4 h-4" />, label: '设置' },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  onRefresh,
  isRefreshing,
  detectedBothCount,
  themeMode,
  onCycleTheme,
}) => {
  const ThemeIcon = themeMode === 'light' ? Sun : themeMode === 'dark' ? Moon : Sun;
  const themeLabel = themeMode === 'light' ? '浅色' : themeMode === 'dark' ? '深色' : '跟随系统';

  return (
    <aside className="w-52 shrink-0 h-screen sticky top-0 flex flex-col border-r border-ink-borderSoft bg-ink-base">
      {/* 品牌 */}
      <div className="px-4 h-14 flex items-center gap-2.5 shrink-0">
        <div className="w-8 h-8 rounded-btn bg-ink-elevated flex items-center justify-center shadow-raise">
          <Gamepad2 className="w-4 h-4 text-ink-text stroke-[1.75]" />
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-ink-text leading-tight truncate">Steam ↔ Xbox</div>
          <div className="text-[11px] text-ink-faint leading-tight">存档移植</div>
        </div>
      </div>

      {/* 导航 */}
      <nav className="px-2 py-2 space-y-0.5 flex-1 overflow-y-auto">
        {TABS.map(tab => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-btn text-[13px] transition-all ${
                isActive
                  ? 'panel-inset text-ink-text font-medium'
                  : 'text-ink-muted hover:text-ink-text hover:bg-ink-elevated/60'
              }`}
            >
              {tab.icon}
              <span className="truncate">{tab.label}</span>
              {tab.key === 'games' && detectedBothCount > 0 && (
                <span className="ml-auto text-[11px] text-ink-faint tabular-nums">{detectedBothCount}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* 底部操作 */}
      <div className="px-2 pb-3 space-y-1 shrink-0">
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-btn text-[12px] text-ink-muted hover:text-ink-text hover:bg-ink-elevated/60 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>{isRefreshing ? '扫描中…' : '重新扫描'}</span>
        </button>

        <button
          onClick={onCycleTheme}
          title="切换主题（跟随系统 → 浅色 → 深色）"
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-btn text-[12px] text-ink-muted hover:text-ink-text hover:bg-ink-elevated/60 transition-colors"
        >
          <ThemeIcon className="w-3.5 h-3.5" />
          <span>{themeLabel}</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
