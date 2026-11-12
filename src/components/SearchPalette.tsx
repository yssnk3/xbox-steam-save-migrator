import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, CornerDownLeft, Layers, Library, X } from 'lucide-react';
import { GameItem } from '../types';
import { XboxInstalledGame } from '../types';
import { TabKey } from './Sidebar';

export interface SearchResult {
  id: string;
  name: string;
  subtitle: string;
  tab: TabKey;
  /** 用于跳转后定位的目标 key（游戏 id 或 pfn） */
  targetKey: string;
}

interface SearchPaletteProps {
  open: boolean;
  onClose: () => void;
  games: GameItem[];
  libraryGames: XboxInstalledGame[];
  onJump: (result: SearchResult) => void;
}

/**
 * 跨页搜索面板（Ctrl+K）。
 *
 * 数据源是 App 已经加载好的两份列表，不额外请求后端——
 * 打开即瞬时出结果。
 */
export const SearchPalette: React.FC<SearchPaletteProps> = ({
  open,
  onClose,
  games,
  libraryGames,
  onJump,
}) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      // 等弹层挂载后再聚焦
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const allResults = useMemo<SearchResult[]>(() => {
    const fromGames: SearchResult[] = games.map(g => ({
      id: `game:${g.id}`,
      name: g.name,
      subtitle: [
        '游戏移植',
        g.steamAppId ? `AppID ${g.steamAppId}` : null,
        g.isSteamDetected ? 'Steam ✓' : null,
        g.isXboxDetected ? 'Xbox ✓' : null,
      ]
        .filter(Boolean)
        .join(' · '),
      tab: 'games',
      targetKey: g.id,
    }));

    const fromLibrary: SearchResult[] = libraryGames
      .filter(g => g.isGame)
      .map(g => ({
        id: `lib:${g.pfn}`,
        name: g.displayName,
        subtitle: ['Xbox 游戏库', g.hasWgs ? '有存档' : '未启动过', g.pfn].filter(Boolean).join(' · '),
        tab: 'xbox',
        targetKey: g.pfn,
      }));

    return [...fromGames, ...fromLibrary];
  }, [games, libraryGames]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // 空查询时给出「本机已有存档」的游戏，作为快速入口
      return allResults.filter(r => r.subtitle.includes('✓')).slice(0, 8);
    }
    return allResults
      .filter(r => r.name.toLowerCase().includes(q) || r.subtitle.toLowerCase().includes(q))
      .slice(0, 30);
  }, [allResults, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // 键盘导航
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex(i => Math.min(i + 1, results.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const hit = results[activeIndex];
        if (hit) onJump(hit);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, results, activeIndex, onJump, onClose]);

  // 让选中项滚进可视区
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center pt-[12vh] px-4 bg-[rgba(15,15,15,0.5)]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="搜索游戏"
    >
      <div
        className="w-full max-w-xl bg-ink-base border border-ink-border rounded-modal shadow-glass overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* 输入区 */}
        <div className="flex items-center gap-2 px-3 h-11 border-b border-ink-borderSoft">
          <Search className="w-4 h-4 text-ink-faint shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索游戏名、AppID 或包名…"
            className="flex-1 h-full bg-transparent border-0 outline-none text-[14px] text-ink-text placeholder:text-ink-faint"
          />
          <button
            onClick={onClose}
            className="p-1 rounded-btn text-ink-faint hover:text-ink-text hover:bg-ink-hover transition-colors"
            aria-label="关闭搜索"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 结果列表 */}
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-[14px] text-ink-muted">
                {query.trim() ? '没有匹配的游戏' : '暂无已扫描的游戏'}
              </p>
              <p className="t-meta mt-1">
                {query.trim() ? '换个关键词试试' : '先点左下角「扫描」加载本机游戏'}
              </p>
            </div>
          ) : (
            results.map((r, idx) => {
              const Icon = r.tab === 'games' ? Layers : Library;
              const isActive = idx === activeIndex;
              return (
                <button
                  key={r.id}
                  data-idx={idx}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => onJump(r)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                    isActive ? 'bg-ink-hover' : ''
                  }`}
                >
                  <Icon className="w-4 h-4 text-ink-faint shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] text-ink-text truncate">{r.name}</div>
                    <div className="text-[12px] text-ink-faint truncate">{r.subtitle}</div>
                  </div>
                  {isActive && (
                    <CornerDownLeft className="w-3.5 h-3.5 text-ink-faint shrink-0" />
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* 底部提示 */}
        <div className="px-3 py-1.5 border-t border-ink-borderSoft flex items-center gap-3 text-[11px] text-ink-faint">
          <span>↑↓ 选择</span>
          <span>Enter 跳转</span>
          <span>Esc 关闭</span>
          <span className="ml-auto tabular-nums">{results.length} 条</span>
        </div>
      </div>
    </div>
  );
};

export default SearchPalette;