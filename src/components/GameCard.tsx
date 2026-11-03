import React, { useState, useEffect } from 'react';
import { GameItem } from '../types';
import { openFolder } from '../services/api';
import { ArrowRight, ArrowLeft, Folder, Search, Gamepad2, Info, FlaskConical } from 'lucide-react';

interface GameCardProps {
  game: GameItem;
  onInspectGame: (game: GameItem) => void;
  onQuickMigrate: (game: GameItem, direction: 'xbox_to_steam' | 'steam_to_xbox') => void;
  onTestGame?: (game: GameItem) => void;
  isMigrating: boolean;
  onError: (msg: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '未找到存档';
  const d = new Date(dateStr);
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const GameCard: React.FC<GameCardProps> = ({ game, onInspectGame, onQuickMigrate, onTestGame, isMigrating, onError }) => {
  const [iconFailed, setIconFailed] = useState(false);
  useEffect(() => setIconFailed(false), [game.iconUrl]);
  const catInfo = { label: game.category };
  const hasSaves = game.isSteamDetected || game.isXboxDetected;

  const handleOpenFolder = async (e: React.MouseEvent, folderPath: string, side: 'steam' | 'xbox') => {
    e.stopPropagation();
    try {
      await openFolder(folderPath);
    } catch (err: any) {
      onError(`无法打开${side === 'steam' ? 'Steam' : 'Xbox'}存档目录: ${err.message}`);
    }
  };

  const sTime = game.steamLastModified ? new Date(game.steamLastModified).getTime() : 0;
  const xTime = game.xboxLastModified ? new Date(game.xboxLastModified).getTime() : 0;

  let recommendedDirection: 'xbox_to_steam' | 'steam_to_xbox' | null = null;
  if (xTime > 0 && xTime > sTime + 5000) {
    recommendedDirection = 'xbox_to_steam';
  } else if (sTime > 0 && sTime > xTime + 5000) {
    recommendedDirection = 'steam_to_xbox';
  }

  return (
    <div className={`bg-ink-surface border border-ink-borderSoft rounded-card px-4 py-3 transition-all duration-200 ${
      hasSaves ? 'hover:shadow-card-hover hover:border-ink-faint' : 'opacity-60 hover:opacity-100'
    }`}>

      {/* Main row */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4">

        {/* Game identity */}
        <div className="flex items-center gap-3 min-w-0 lg:w-72 lg:shrink-0">
          <div className={`w-10 h-10 rounded-btn shrink-0 overflow-hidden border flex items-center justify-center ${
            hasSaves ? 'border-ink-border bg-ink-base' : 'border-ink-border bg-ink-base/50'
          }`}>
            {game.iconUrl && !iconFailed ? (
              <img
                src={game.iconUrl}
                alt={game.name}
                className="w-full h-full object-cover"
                onError={() => setIconFailed(true)}
              />
            ) : (
              <Gamepad2 className={`w-5 h-5 ${hasSaves ? 'text-ink-text' : 'text-ink-muted'}`} />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-sm text-ink-text truncate max-w-[200px]">{game.name}</h3>
              {hasSaves && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-ink-elevated text-ink-muted border border-ink-border shrink-0" title={catInfo.label + ' 类：匹配方式详见规则'}>
                  {catInfo.label}
                </span>
              )}
              {recommendedDirection && (
                <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded shrink-0 ${
                  recommendedDirection === 'xbox_to_steam'
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                }`}>
                  推荐{recommendedDirection === 'xbox_to_steam' ? ' Xbox→Steam' : ' Steam→Xbox'}
                </span>
              )}
            </div>
            <div className="text-[10px] text-ink-muted font-mono truncate max-w-[260px]">
              {game.steamAppId ? `Steam AppID ${game.steamAppId}` : game.id}
            </div>
          </div>
        </div>

        {/* Steam status */}
        <div className={`flex items-center gap-2.5 px-3 py-2 rounded-btn border flex-1 min-w-0 ${
          game.isSteamDetected ? 'border-ink-border bg-ink-base/30' : 'border-ink-border/50 bg-transparent'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${game.isSteamDetected ? 'bg-ink-success' : 'bg-ink-border'}`}></span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={`text-[11px] font-semibold ${game.isSteamDetected ? 'text-ink-text' : 'text-ink-muted'}`}>Steam</span>
              {game.isSteamDetected && game.steamSaveSize > 0 && (
                <span className="font-mono text-[10px] text-ink-muted">{formatBytes(game.steamSaveSize)}</span>
              )}
              <span className="font-mono text-[10px] text-ink-muted/70">{formatDate(game.steamLastModified)}</span>
            </div>
            <div className="font-mono text-[10px] text-ink-muted/70 truncate max-w-[280px]" title={game.steamSavePath}>
              {game.isSteamDetected ? game.steamSavePath : '未检索到 Steam 存档'}
            </div>
          </div>
          {game.isSteamDetected && (
            <button
              onClick={e => handleOpenFolder(e, game.steamSavePath, 'steam')}
              className="px-1.5 py-1 text-[10px] rounded bg-ink-surface hover:bg-ink-raised text-ink-muted hover:text-ink-text border border-ink-border transition-colors flex items-center gap-1 shrink-0"
              title="打开 Steam 存档目录"
            >
              <Folder className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Xbox status */}
        <div className={`flex items-center gap-2.5 px-3 py-2 rounded-btn border flex-1 min-w-0 ${
          game.isXboxDetected ? 'border-ink-border bg-ink-base/30' : 'border-ink-border/50 bg-transparent'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${game.isXboxDetected ? 'bg-ink-success' : 'bg-ink-border'}`}></span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={`text-[11px] font-semibold ${game.isXboxDetected ? 'text-ink-text' : 'text-ink-muted'}`}>Xbox</span>
              {game.isXboxDetected && game.xboxSaveSize > 0 && (
                <span className="font-mono text-[10px] text-ink-muted">{formatBytes(game.xboxSaveSize)}</span>
              )}
              <span className="font-mono text-[10px] text-ink-muted/70">{formatDate(game.xboxLastModified)}</span>
            </div>
            <div className="font-mono text-[10px] text-ink-muted/70 truncate max-w-[280px]" title={game.xboxWgsPath}>
              {game.isXboxDetected ? game.xboxWgsPath : '未检索到 Xbox WGS'}
            </div>
          </div>
          {game.isXboxDetected && (
            <button
              onClick={e => handleOpenFolder(e, game.xboxWgsPath, 'xbox')}
              className="px-1.5 py-1 text-[10px] rounded bg-ink-surface hover:bg-ink-raised text-ink-muted hover:text-ink-text border border-ink-border transition-colors flex items-center gap-1 shrink-0"
              title="打开 Xbox WGS 目录"
            >
              <Folder className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 lg:w-auto shrink-0">
          {recommendedDirection === 'xbox_to_steam' ? (
            <>
              <button
                onClick={() => onQuickMigrate(game, 'xbox_to_steam')}
                disabled={!game.isXboxDetected || isMigrating}
                title={!game.isXboxDetected ? '未检测到 Xbox 存档，无法移植' : isMigrating ? '正在执行其他移植...' : '将 Xbox 存档移植到 Steam（推荐方向）'}
                className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium rounded-btn bg-ink-xbox-to-steam hover:bg-emerald-400 text-ink-base transition-colors disabled:opacity-30 disabled:pointer-events-none"
              >
                <ArrowLeft className="w-3 h-3" />
                Xbox→Steam
              </button>
              <button
                onClick={() => onQuickMigrate(game, 'steam_to_xbox')}
                disabled={!game.isSteamDetected || isMigrating}
                title={!game.isSteamDetected ? '未检测到 Steam 存档' : isMigrating ? '正在执行其他移植...' : '将 Steam 存档移植到 Xbox（非推荐方向）'}
                className="flex items-center gap-1 px-2 py-1.5 text-[10px] font-medium text-ink-muted hover:text-ink-text border border-transparent hover:border-ink-border rounded-btn transition-colors disabled:opacity-30 disabled:pointer-events-none"
              >
                <ArrowRight className="w-3 h-3" />
                Steam→Xbox
              </button>
            </>
          ) : recommendedDirection === 'steam_to_xbox' ? (
            <>
              <button
                onClick={() => onQuickMigrate(game, 'steam_to_xbox')}
                disabled={!game.isSteamDetected || isMigrating}
                title={!game.isSteamDetected ? '未检测到 Steam 存档，无法移植' : isMigrating ? '正在执行其他移植...' : '将 Steam 存档移植到 Xbox（推荐方向）'}
                className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium rounded-btn bg-ink-steam-to-xbox hover:bg-sky-400 text-ink-base transition-colors disabled:opacity-30 disabled:pointer-events-none"
              >
                <ArrowRight className="w-3 h-3" />
                Steam→Xbox
              </button>
              <button
                onClick={() => onQuickMigrate(game, 'xbox_to_steam')}
                disabled={!game.isXboxDetected || isMigrating}
                title={!game.isXboxDetected ? '未检测到 Xbox 存档' : isMigrating ? '正在执行其他移植...' : '将 Xbox 存档移植到 Steam（非推荐方向）'}
                className="flex items-center gap-1 px-2 py-1.5 text-[10px] font-medium text-ink-muted hover:text-ink-text border border-transparent hover:border-ink-border rounded-btn transition-colors disabled:opacity-30 disabled:pointer-events-none"
              >
                <ArrowLeft className="w-3 h-3" />
                Xbox→Steam
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => onQuickMigrate(game, 'xbox_to_steam')}
                disabled={!game.isXboxDetected || isMigrating}
                title={!game.isXboxDetected ? '未检测到 Xbox 存档，无法移植' : isMigrating ? '正在执行其他移植...' : '将 Xbox 存档移植到 Steam'}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-btn bg-ink-xbox-to-steam/90 hover:bg-ink-xbox-to-steam text-ink-base transition-colors disabled:opacity-30 disabled:pointer-events-none"
              >
                <ArrowLeft className="w-3 h-3" />
                Xbox→Steam
              </button>
              <button
                onClick={() => onQuickMigrate(game, 'steam_to_xbox')}
                disabled={!game.isSteamDetected || isMigrating}
                title={!game.isSteamDetected ? '未检测到 Steam 存档，无法移植' : isMigrating ? '正在执行其他移植...' : '将 Steam 存档移植到 Xbox'}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-btn bg-ink-steam-to-xbox/90 hover:bg-ink-steam-to-xbox text-ink-base transition-colors disabled:opacity-30 disabled:pointer-events-none"
              >
                Steam→Xbox
                <ArrowRight className="w-3 h-3" />
              </button>
            </>
          )}
          <button
            onClick={() => onInspectGame(game)}
            disabled={isMigrating}
            title={isMigrating ? '正在执行其他移植...' : '文件预览与 MD5 校验对比'}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-ink-muted hover:text-ink-text bg-ink-surface hover:bg-ink-raised rounded-btn border border-ink-border transition-colors disabled:opacity-50"
          >
            <Search className="w-3 h-3" />
            对比
          </button>
          {onTestGame && (
            <button
              onClick={() => onTestGame(game)}
              disabled={isMigrating}
              title={isMigrating ? '正在执行其他移植...' : '移植测试（预演）：不写任何文件，预测两端移植时字节会落到哪些槽位'}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-ink-muted hover:text-ink-text bg-ink-surface hover:bg-ink-raised rounded-btn border border-ink-border transition-colors disabled:opacity-50"
            >
              <FlaskConical className="w-3 h-3" />
              测试
            </button>
          )}
        </div>
      </div>

      {/* Notes */}
      {game.notes && (
        <div className="mt-2 flex items-start gap-1.5 text-[10px] text-ink-muted leading-relaxed border-l-2 border-ink-border pl-2">
          <Info className="w-3 h-3 mt-0.5 shrink-0 text-ink-muted" />
          <span className="truncate" title={game.notes}>{game.notes}</span>
        </div>
      )}
    </div>
  );
};

export default GameCard;
