import React, { useState } from 'react';
import { GameItem } from '../types';
import { GameCard } from './GameCard';
import { useToast } from './Toast';
import { Search, Sparkles } from 'lucide-react';

interface GameGridProps {
  games: GameItem[];
  onSelectGame: (game: GameItem) => void;
  onQuickMigrate: (game: GameItem, direction: 'xbox_to_steam' | 'steam_to_xbox') => void;
  onTestGame?: (game: GameItem) => void;
  isMigrating: boolean;
}

export const GameGrid: React.FC<GameGridProps> = ({ games, onSelectGame, onQuickMigrate, onTestGame, isMigrating }) => {
  const toast = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  // Default to games that actually have saves on this PC — an empty preset
  // list is noise for the user's "show me what exists" expectation.
  const [filterMode, setFilterMode] = useState<'all' | 'detected' | 'both'>('detected');

  // Sort: ready-to-migrate (both sides detected) first, then single-side, then none.
  // Within each tier, games with actual save files and exact-path confidence float higher.
  const sortedGames = [...games].sort((a, b) => {
    const tierA = (a.isSteamDetected && a.isXboxDetected ? 2 : 0) + (a.isSteamDetected || a.isXboxDetected ? 1 : 0);
    const tierB = (b.isSteamDetected && b.isXboxDetected ? 2 : 0) + (b.isSteamDetected || b.isXboxDetected ? 1 : 0);
    if (tierA !== tierB) return tierB - tierA;

    // Within the same tier: prefer games that have actual save files.
    const hasFilesA = a.steamFileCount > 0 || a.xboxSaveSize > 0 ? 1 : 0;
    const hasFilesB = b.steamFileCount > 0 || b.xboxSaveSize > 0 ? 1 : 0;
    if (hasFilesA !== hasFilesB) return hasFilesB - hasFilesA;

    // Prefer exact-path confidence over wildcard.
    const confA = a.steamPathConfidence === 'exact' ? 1 : 0;
    const confB = b.steamPathConfidence === 'exact' ? 1 : 0;
    return confB - confA;
  });

  const filteredGames = sortedGames.filter(game => {
    const matchesSearch = game.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          game.id.toLowerCase().includes(searchTerm.toLowerCase());
    
    if (!matchesSearch) return false;

    if (filterMode === 'both') return game.isSteamDetected && game.isXboxDetected;
    if (filterMode === 'detected') return game.isSteamDetected || game.isXboxDetected;
    return true;
  });

  const bothCount = games.filter(g => g.isSteamDetected && g.isXboxDetected).length;
  const detectedCount = games.filter(g => g.isSteamDetected || g.isXboxDetected).length;

  return (
    <div className="space-y-6">
      
      {/* Search Banner */}
      <div className="bg-ink-surface border border-ink-border rounded-card p-5 shadow-card">
        <div className="space-y-4">

          <div className="flex items-center gap-3">
            <div className="p-2 rounded-btn bg-ink-elevated text-ink-muted border border-ink-borderSoft">
              <Search className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-semibold text-base text-ink-text">
                本机扫描到的游戏存档
              </h2>
              <p className="text-xs text-ink-muted mt-0.5">
                本机实际扫描到的游戏存档，双端均检测到且地址正确的排在最前，可直接一键移植。若列表里找不到，用上方「识别存档」选择存档文件夹直接移植，或添加自定义游戏。
              </p>
            </div>
          </div>

          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-faint" />
            <input
              type="text"
              placeholder="搜索游戏名称（例如：帕鲁、星空、Lies of P...）"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full bg-ink-elevated border border-ink-border rounded-btn pl-9 pr-4 py-2.5 text-sm text-ink-text placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-ink-muted hover:text-ink-text bg-ink-elevated hover:bg-ink-raised px-2 py-0.5 rounded transition-colors"
              >
                清空
              </button>
            )}
          </div>

          {/* Quick Preset Badges */}
          <div className="flex items-center gap-2 flex-wrap pt-1 text-xs">
            <span className="text-ink-faint">快速筛选：</span>
            {['帕鲁', '星空', '匹诺曹', '深岩银河', '地平线', '怪猎'].map((quickName) => (
              <button
                key={quickName}
                onClick={() => setSearchTerm(quickName)}
                className="px-2.5 py-1 rounded-btn bg-ink-elevated hover:bg-ink-elevated border border-ink-border text-ink-muted hover:text-ink-text transition-colors"
              >
                {quickName}
              </button>
            ))}
          </div>

        </div>
      </div>

      {/* Filter Tabs & Count */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-ink-borderSoft">
        
        <h3 className="font-semibold text-sm text-ink-text">
          匹配到的游戏 <span className="text-ink-faint font-normal">({filteredGames.length})</span>
        </h3>

        {/* Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto bg-ink-elevated p-1 rounded-btn border border-ink-borderSoft">
          <button
            onClick={() => setFilterMode('detected')}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors shrink-0 ${
              filterMode === 'detected'
                ? 'bg-ink-surface text-ink-text shadow-card border border-ink-border'
                : 'text-ink-muted hover:text-ink-text hover:bg-ink-elevated border border-transparent'
            }`}
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500/100 mr-1.5 align-middle" />
            本机有存档 ({detectedCount})
          </button>

          <button
            onClick={() => setFilterMode('both')}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors shrink-0 ${
              filterMode === 'both'
                ? 'bg-ink-surface text-ink-text shadow-card border border-ink-border'
                : 'text-ink-muted hover:text-ink-text hover:bg-ink-elevated border border-transparent'
            }`}
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 mr-1.5 align-middle" />
            双端均就绪 ({bothCount})
          </button>

          <button
            onClick={() => setFilterMode('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors shrink-0 ${
              filterMode === 'all'
                ? 'bg-ink-surface text-ink-text shadow-card border border-ink-border'
                : 'text-ink-muted hover:text-ink-text hover:bg-ink-elevated border border-transparent'
            }`}
          >
            全部 ({games.length})
          </button>
        </div>

      </div>

      {/* Game Cards Grid */}
      {filteredGames.length === 0 ? (
        <div className="bg-ink-surface border border-ink-border rounded-card p-12 text-center space-y-3">
          <Sparkles className="w-8 h-8 text-ink-faint mx-auto" />
          <h3 className="text-sm font-semibold text-ink-text">未检索到匹配的游戏</h3>
          <p className="text-xs text-ink-muted max-w-md mx-auto">
            请尝试更换搜索关键词，或点击"添加自定义游戏"手动注册游戏。也可用上方「识别存档」直接选择存档文件夹移植。
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredGames.map(game => (
            <GameCard
              key={game.id}
              game={game}
              onInspectGame={onSelectGame}
              onQuickMigrate={onQuickMigrate}
              onTestGame={onTestGame}
              isMigrating={isMigrating}
              onError={(msg) => toast(msg, 'error')}
            />
          ))}
        </div>
      )}

    </div>
  );
};
