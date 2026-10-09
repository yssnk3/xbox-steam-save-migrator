import React from 'react';
import { RefreshCw, Shield, Layers, Gamepad2 } from 'lucide-react';

interface HeaderProps {
  activeTab: 'games' | 'backups';
  setActiveTab: (tab: 'games' | 'backups') => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  detectedBothCount: number;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  onRefresh,
  isRefreshing,
  detectedBothCount
}) => {
  return (
    <header className="sticky top-0 z-30 border-b border-notion-border bg-white/95 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-6 py-3 flex flex-col md:flex-row items-center justify-between gap-3">

        {/* Brand & Title */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-notion-text flex items-center justify-center">
            <Gamepad2 className="w-4.5 h-4.5 text-white stroke-[2]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-semibold text-base tracking-tight text-notion-text">
                Steam <span className="text-notion-muted">↔</span> Xbox
              </h1>
              <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-notion-tag text-notion-muted border border-notion-border">
                存档移植
              </span>
            </div>
            <p className="text-xs text-notion-muted mt-0.5">
              PC 游戏存档双端移植工具 · 已匹配 {detectedBothCount} 款双端存档
            </p>
          </div>
        </div>

        {/* Tab Navigation */}
        <nav className="flex items-center bg-notion-sidebar p-0.5 rounded-md border border-notion-border overflow-x-auto max-w-full">
          <button
            onClick={() => setActiveTab('games')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded transition-colors flex items-center gap-1.5 shrink-0 ${
              activeTab === 'games'
                ? 'bg-white text-notion-text shadow-sm'
                : 'text-notion-muted hover:text-notion-text hover:bg-notion-hover'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>游戏移植</span>
          </button>

          <button
            onClick={() => setActiveTab('backups')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded transition-colors flex items-center gap-1.5 shrink-0 ${
              activeTab === 'backups'
                ? 'bg-white text-notion-text shadow-sm'
                : 'text-notion-muted hover:text-notion-text hover:bg-notion-hover'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>备份中心</span>
          </button>
        </nav>

        {/* Refresh Action Button */}
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-white hover:bg-notion-hover text-notion-text border border-notion-border transition-all flex items-center gap-1.5 active:scale-[0.98] disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-notion-muted' : ''}`} />
          <span>{isRefreshing ? '扫描中...' : '重新扫描存档'}</span>
        </button>

      </div>
    </header>
  );
};

export default Header;
