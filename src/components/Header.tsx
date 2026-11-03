import React from 'react';
import { RefreshCw, Shield, Layers, Gamepad2, Library, Settings } from 'lucide-react';

interface HeaderProps {
  activeTab: 'games' | 'backups' | 'xbox' | 'settings';
  setActiveTab: (tab: 'games' | 'backups' | 'xbox' | 'settings') => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  detectedBothCount: number;
}

const TABS: { key: 'games' | 'backups' | 'xbox' | 'settings'; icon: React.ReactNode; label: string }[] = [
  { key: 'games', icon: <Layers className="w-3.5 h-3.5" />, label: '游戏移植' },
  { key: 'xbox', icon: <Library className="w-3.5 h-3.5" />, label: 'Xbox 游戏库' },
  { key: 'backups', icon: <Shield className="w-3.5 h-3.5" />, label: '备份中心' },
  { key: 'settings', icon: <Settings className="w-3.5 h-3.5" />, label: '设置' },
];

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  onRefresh,
  isRefreshing,
  detectedBothCount
}) => {
  return (
    <header className="sticky top-0 z-30 border-b border-ink-border bg-ink-base">
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center gap-6">

        {/* Brand */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-7 h-7 rounded-btn bg-ink-elevated border border-ink-border flex items-center justify-center">
            <Gamepad2 className="w-4 h-4 text-ink-text stroke-[1.75]" />
          </div>
          <div className="flex items-baseline gap-2">
            <h1 className="font-display font-semibold text-[14px] tracking-tight text-ink-text">
              Steam ↔ Xbox
            </h1>
            <span className="text-[11px] text-ink-faint hidden sm:inline">
              已匹配 {detectedBothCount} 款
            </span>
          </div>
        </div>

        {/* Tabs — flat underline nav, no pill filling */}
        <nav className="flex items-center gap-1 overflow-x-auto flex-1 min-w-0 -mb-px">
          {TABS.map(tab => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`relative px-3 py-2 text-[12.5px] transition-colors flex items-center gap-1.5 shrink-0 border-b-2 ${
                  isActive
                    ? 'text-ink-text border-ink-accent font-medium'
                    : 'text-ink-muted hover:text-ink-text border-transparent'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Refresh */}
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="btn-ghost px-2.5 py-1.5 text-[12px] flex items-center gap-1.5 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span className="hidden md:inline">{isRefreshing ? '扫描中…' : '重新扫描'}</span>
        </button>

      </div>
    </header>
  );
};

export default Header;
