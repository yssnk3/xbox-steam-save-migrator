import React, { useState } from 'react';
import { GameItem } from '../types';
import { GameCard } from './GameCard';
import { useToast } from './Toast';
import { Search, FolderSearch, Trash2 } from 'lucide-react';
import { pickFolder, scanFolder, fetchScannedGames, deleteScannedGame } from '../services/api';

interface GameGridProps {
  games: GameItem[];
  onSelectGame: (game: GameItem) => void;
  onQuickMigrate: (game: GameItem, direction: 'xbox_to_steam' | 'steam_to_xbox') => void;
  onTestGame?: (game: GameItem) => void;
  isMigrating: boolean;
  /** 搜索跳转后要高亮的游戏 id */
  highlightKey?: string | null;
}

export const GameGrid: React.FC<GameGridProps> = ({ games, onSelectGame, onQuickMigrate, onTestGame, isMigrating, highlightKey }) => {
  const toast = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'detected' | 'both'>('detected');
  const [scanning, setScanning] = useState(false);
  const [scannedGames, setScannedGames] = useState<any[]>([]);

  // 加载扫描结果
  React.useEffect(() => {
    void loadScanned();
  }, []);

  // 加载扫描结果
  const loadScanned = async () => {
    try {
      const { games: scanned } = await fetchScannedGames();
      setScannedGames(scanned);
    } catch {}
  };

  const handleScanFolder = async () => {
    const folder = await pickFolder({ title: '选择要扫描的游戏文件夹' });
    if (!folder) return;
    setScanning(true);
    try {
      const result = await scanFolder(folder);
      await loadScanned();
      if (result.total === 0) {
        toast('该文件夹下未找到存档文件', 'warning');
      } else {
        toast(`扫描完成：发现 ${result.total} 个存档目录`, 'success');
      }
    } catch (e: any) {
      toast(`扫描失败：${e.message}`, 'error');
    } finally {
      setScanning(false);
    }
  };

  const handleDeleteScanned = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteScannedGame(id);
      await loadScanned();
      toast('已删除', 'success');
    } catch (err: any) {
      toast(`删除失败：${err.message}`, 'error');
    }
  };

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
      data-active={filterMode === mode}
      className="px-2 py-1 text-[13px] rounded-[4px] transition-colors text-ink-muted hover:text-ink-text hover:bg-ink-hover data-[active=true]:bg-ink-base data-[active=true]:text-ink-text data-[active=true]:font-medium data-[active=true]:shadow-[0_1px_2px_rgba(15,15,15,0.1)]"
    >
      {label} <span className="text-ink-faint tabular-nums">{count}</span>
    </button>
  );

  return (
    <div className="space-y-3">

      {/* 紧凑工具条：标题 + 计数 + 扫描 + 搜索 + 筛选 */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="t-title">本机游戏存档</h2>
        <span className="t-meta">{filteredGames.length} / {games.length}</span>

        <div className="flex-1" />

        <button
          onClick={handleScanFolder}
          disabled={scanning}
          className="btn-ghost px-3 py-1.5 text-[13px] flex items-center gap-1.5 disabled:opacity-50"
          title="选择文件夹，自动扫描并识别其中的游戏存档"
        >
          <FolderSearch className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
          {scanning ? '扫描中…' : '扫描文件夹'}
        </button>

        <div className="relative w-56">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-ink-faint" />
          <input
            type="text"
            placeholder="搜索游戏名…"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full bg-ink-base border border-ink-border rounded-btn pl-7 pr-2 py-1 text-[13px] text-ink-text placeholder:text-ink-faint hover:border-ink-faint focus:outline-none focus:border-ink-accent focus:shadow-[0_0_0_2px_var(--ink-accent-soft)]"
          />
        </div>

        <div className="flex items-center gap-0.5 p-0.5 rounded-[5px] bg-ink-elevated border border-ink-borderSoft">
          {filterBtn('detected', '本机已有', detectedCount)}
          {filterBtn('both', '双端', bothCount)}
          {filterBtn('all', '全部', games.length)}
        </div>
      </div>

      {/* 列表：单一容器 + 分隔线，不再每行一张卡 */}
      {filteredGames.length === 0 ? (
        <div className="panel px-4 py-10 text-center">
          <p className="text-[14px] text-ink-muted">未匹配到游戏</p>
          <p className="t-meta mt-1">换个关键词，或用上方「识别存档」直接选择存档文件夹</p>
        </div>
      ) : (
        <div className="panel divide-y divide-ink-borderSoft overflow-hidden">
          {filteredGames.map(game => (
            <GameCard
              key={game.id}
              game={game}
              onInspectGame={onSelectGame}
              onQuickMigrate={onQuickMigrate}
              onTestGame={onTestGame}
              isMigrating={isMigrating}
              highlighted={highlightKey === game.id}
              onError={(msg) => toast(msg, 'error')}
            />
          ))}
        </div>
      )}

      {/* 扫描文件夹结果 */}
      {scannedGames.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-[14px] font-medium text-ink-text">扫描结果</h3>
            <span className="text-[11px] text-ink-faint">{scannedGames.length} 个目录</span>
          </div>
          <div className="panel divide-y divide-ink-borderSoft overflow-hidden">
            {scannedGames.map(sg => (
              <div key={sg.id} className="px-4 py-3 flex items-start gap-3 hover:bg-ink-elevated transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-ink-text truncate">
                      {sg.matchedGameName || sg.folderPath.split(/[/\\]/).pop()}
                    </span>
                    {sg.matchedGameId ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-ink-success/10 text-ink-success shrink-0">已识别</span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-ink-elevated text-ink-faint shrink-0">未识别</span>
                    )}
                  </div>
                  <div className="text-[11px] text-ink-faint font-mono truncate mt-0.5">
                    {sg.folderPath}
                  </div>
                  <div className="text-[11px] text-ink-muted mt-0.5">
                    {sg.files.length} 个文件 · {sg.files.reduce((s: number, f: any) => s + f.size, 0) > 0
                      ? (sg.files.reduce((s: number, f: any) => s + f.size, 0) / 1024).toFixed(1) + ' KB'
                      : '0 KB'}
                  </div>
                  {sg.matchedGameId && (sg.steamSavePath || sg.xboxWgsPath) && (
                    <div className="text-[10px] text-ink-faint mt-0.5">
                      {sg.steamSavePath && <span>Steam: {sg.steamSavePath}</span>}
                      {sg.steamSavePath && sg.xboxWgsPath && ' · '}
                      {sg.xboxWgsPath && <span>Xbox: {sg.xboxWgsPath}</span>}
                    </div>
                  )}
                </div>
                <button
                  onClick={e => handleDeleteScanned(sg.id, e)}
                  className="p-1.5 rounded text-ink-faint hover:text-ink-danger hover:bg-ink-elevated transition-colors shrink-0"
                  title="删除"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
};
