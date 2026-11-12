import React from 'react';
import { ChevronRight, MoreHorizontal, RefreshCw, Terminal, Star } from 'lucide-react';
import { TabKey } from './Sidebar';

interface TopBarProps {
  activeTab: TabKey;
  onRefresh: () => void;
  isRefreshing: boolean;
  onOpenLog: () => void;
  logCount: number;
  subtitle?: string;
}

const TAB_META: Record<TabKey, { group: string; title: string }> = {
  games: { group: '收藏', title: '游戏移植' },
  xbox: { group: '收藏', title: 'Xbox 游戏库' },
  backups: { group: '工作区', title: '备份中心' },
  settings: { group: '工作区', title: '设置' },
};

/**
 * Notion 页面顶部栏。
 *
 * 结构：左侧面包屑（分组 › 页面名 › 星标），右侧图标操作区。
 * 高度 45px 是 Notion 顶栏的标准高度；不使用阴影，靠底部 1px 边框分隔。
 * 页面标题本身不放在这里 —— Notion 把大标题放在正文顶部，这里只做面包屑。
 */
export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  onRefresh,
  isRefreshing,
  onOpenLog,
  logCount,
}) => {
  const meta = TAB_META[activeTab];

  return (
    <header className="h-[45px] shrink-0 sticky top-0 z-20 flex items-center justify-between px-3 bg-ink-base/95 backdrop-blur-sm border-b border-ink-borderSoft">
      {/* 面包屑 */}
      <nav className="flex items-center gap-1 min-w-0 text-[14px]">
        <span className="text-ink-muted truncate">{meta.group}</span>
        <ChevronRight className="w-3.5 h-3.5 text-ink-faint shrink-0" />
        <span className="text-ink-text font-medium truncate">{meta.title}</span>
        <button
          className="ml-1 w-6 h-6 flex items-center justify-center rounded-btn text-ink-faint hover:bg-ink-hover hover:text-ink-text transition-colors shrink-0"
          title="加入收藏"
        >
          <Star className="w-3.5 h-3.5" />
        </button>
      </nav>

      {/* 操作区 */}
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="w-7 h-7 flex items-center justify-center rounded-btn text-ink-muted hover:bg-ink-hover hover:text-ink-text transition-colors disabled:opacity-40"
          title={isRefreshing ? '扫描中…' : '重新扫描'}
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
        <button
          onClick={onOpenLog}
          className="h-7 flex items-center gap-1.5 px-2 rounded-btn text-ink-muted hover:bg-ink-hover hover:text-ink-text transition-colors text-[13px]"
          title="打开运行日志"
        >
          <Terminal className="w-4 h-4" />
          {logCount > 0 && <span className="tabular-nums">{logCount}</span>}
        </button>
        <button
          className="w-7 h-7 flex items-center justify-center rounded-btn text-ink-muted hover:bg-ink-hover hover:text-ink-text transition-colors"
          title="更多"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};

export default TopBar;