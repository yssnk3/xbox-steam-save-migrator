import React from 'react';
import { RefreshCw, Shield, Layers, Gamepad2, Library } from 'lucide-react';

interface HeaderProps {
  activeTab: 'games' | 'backups' | 'xbox';
  setActiveTab: (tab: 'games' | 'backups' | 'xbox') => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  detectedBothCount: number;
}

const TABS: { key: 'games' | 'backups' | 'xbox'; icon: React.ReactNode; label: string }[] = [
  { key: 'games', icon: <Layers className="w-3.5 h-3.5" />, label: '游戏移植' },
  { key: 'xbox', icon: <Library className="w-3.5 h-3.5" />, label: 'Xbox 游戏库' },
  { key: 'backups', icon: <Shield className="w-3.5 h-3.5" />, label: '备份中心' },
];

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  onRefresh,
  isRefreshing,
  detectedBothCount
}) => {
  return (
    <header className="sticky top-0 z-30 border-b border-ink-borderSoft bg-ink-base/70 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-6 py-3 flex flex-col md:flex-row items-center justify-between gap-3">

        {/* Brand & Title */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-btn bg-brand-gradient shadow-glow-soft flex items-center justify-center">
            <Gamepad2 className="w-4.5 h-4.5 text-white stroke-[2]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display font-semibold text-base tracking-tight text-ink-text">
                Steam <span className="text-ink-accent-hover">↔</span> Xbox
              </h1>
              <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-ink-accent-soft text-violet-300 border border-violet-500/25">
                存档移植
              </span>
            </div>
            <p className="text-xs text-ink-muted mt-0.5">
              PC 游戏存档双端移植工具 · 已匹配 {detectedBothCount} 款双端存档
            </p>
          </div>
        </div>

        {/* Tab Navigation — 胶囊分段控件 */}
        <nav className="flex items-center bg-ink-surface/80 p-1 rounded-full border border-ink-border overflow-x-auto max-w-full">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-1.5 text-xs font-medium rounded-full transition-all flex items-center gap-1.5 shrink-0 ${
                activeTab === tab.key
                  ? 'bg-ink-accent text-white shadow-glow-soft'
                  : 'text-ink-muted hover:text-ink-text hover:bg-ink-raised'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>

        {/* Refresh Action Button */}
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="px-3 py-1.5 text-xs font-medium rounded-btn bg-transparent hover:bg-ink-elevated text-ink-muted hover:text-ink-text border border-ink-border transition-all flex items-center gap-1.5 active:scale-[0.98] disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-ink-accent-hover' : ''}`} />
          <span>{isRefreshing ? '扫描中...' : '重新扫描存档'}</span>
        </button>

      </div>
    </header>
  );
};

export default Header;
