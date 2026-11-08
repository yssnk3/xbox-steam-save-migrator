import React, { useState } from 'react';
import { GameItem } from '../types';
import { GameCard } from './GameCard';
import { useToast } from './Toast';
import { Search } from 'lucide-react';

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
  const [filterMode, setFilterMode] = useState<'all' | 'detected' | 'both'>('detected');

  // Sort: ready-to-migrate (both sides detected) first, then single-side, then none.
  const sortedGames = [...games].sort((a, b) => {
    const tierA = (a.isSteamDetected && a.isXboxDetected ? 2 : 0) + (a.isSteamDetected || a.isXboxDetected ? 1 : 0);
    const tierB = (b.isSteamDetected && b.isXboxDetected ? 2 : 0) + (b.isSteamDetected || b.isXboxDetected ? 1 : 0);
    if (tierA !== tierB) return tierB - tierA;

    const hasFilesA = a.steamFileCount > 0 || a.xboxSaveSize > 0 ? 1 : 0;
    const hasFilesB = b.steamFileCount > 0 || b.xboxSaveSize > 0 ? 1 : 0;
    if (hasFilesA !== hasFilesB) return hasFilesB - hasFilesA;

    const confA = a.steamPathConfidence === 'exact' ? 1 : 0;
    const confB = b.steamPathConfidence === 'exact' ? 1 : 0;
    return confB - confA;
  });

  const filteredGames = sortedGames.filter(game => {
    const matchesSearch = game.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          game.id.toLowerCase().includes(searchTerm.toLowerCase());
    if (!matchesSearch) return false;
    if (filterMode === 'both') return game.isSteamDetected && game.isXboxDetected;
    // 已安装但还没存档的 Xbox 游戏也算「本机有」——否则用户会以为没扫到
    if (filterMode === 'detected') return game.isSteamDetected || game.isXboxDetected || Boolean(game.isXboxInstalled);
    return true;
  });

  const bothCount = games.filter(g => g.isSteamDetected && g.isXboxDetected).length;
  const detectedCount = games.filter(g => g.isSteamDetected || g.isXboxDetected || g.isXboxInstalled).length;

  const filterBtn = (mode: 'detected' | 'both' | 'all', label: string, count: number) => (
    <button
      key={mode}
      onClick={() => setFilterMode(mode)}
      className={`px-2 py-1 text-[12px] rounded-btn transition-colors ${
        filterMode === mode
          ? 'bg-ink-raised text-ink-text'
          : 'text-ink-muted hover:text-ink-text'
      }`}
    >
      {label} <span className="text-ink-faint">{count}</span>
    </button>
  );

  return (
    <div className="space-y-3">

      {/* 紧凑工具条：标题 + 计数 + 搜索 + 筛选 */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="t-title">本机游戏存档</h2>
        <span className="t-meta">{filteredGames.length} / {games.length}</span>

        <div className="flex-1" />

        <div className="relative w-56">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-ink-faint" />
          <input
            type="text"
            placeholder="搜索游戏名…"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full bg-ink-elevated border border-ink-border rounded-btn pl-7 pr-2 py-1 text-[12px] text-ink-text placeholder:text-ink-faint focus:outline-none focus:border-ink-faint"
          />
        </div>

        <div className="flex items-center gap-0.5">
          {filterBtn('detected', '本机已有', detectedCount)}
          {filterBtn('both', '双端', bothCount)}
          {filterBtn('all', '全部', games.length)}
        </div>
      </div>

      {/* 列表：单一容器 + 分隔线，不再每行一张卡 */}
      {filteredGames.length === 0 ? (
        <div className="panel px-4 py-10 text-center">
          <p className="text-[13px] text-ink-muted">未匹配到游戏</p>
          <p className="t-meta mt-1">换个关键词，或用上方「识别存档」直接选择存档文件夹</p>
        </div>
      ) : (
        <div className="panel divide-y divide-[#1F2033] overflow-hidden">
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
