import React, { useState, useEffect } from 'react';
import { GameItem } from '../types';
import { openFolder, launchXboxGame } from '../services/api';
import { ArrowRight, ArrowLeft, Folder, Search, Gamepad2, FlaskConical, Play, Loader2 } from 'lucide-react';

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
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

function fullDate(dateStr: string | null): string {
  if (!dateStr) return '未找到存档';
  return new Date(dateStr).toLocaleString('zh-CN');
}

/** 一端的状态列：圆点 + 名称 + 尺寸/时间 + 路径。无描边、无底色。 */
const SideColumn: React.FC<{
  label: string;
  detected: boolean;
  size?: number;
  lastModified?: string | null;
  path?: string | null;
  emptyText: string;
  onOpen?: () => void;
  className?: string;
}> = ({ label, detected, size, lastModified, path, emptyText, onOpen, className = '' }) => (
  <div className={`min-w-0 flex-1 ${className}`}>
    <div className="flex items-center gap-1.5 whitespace-nowrap overflow-hidden">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${detected ? 'bg-ink-success' : 'bg-ink-border'}`} />
      <span className="text-[12px] text-ink-muted shrink-0">{label}</span>
      {detected && size !== undefined && size > 0 && (
        <span className="t-mono shrink-0">{formatBytes(size)}</span>
      )}
      <span className="t-mono shrink-0" title={fullDate(lastModified || null)}>{formatDate(lastModified || null)}</span>
    </div>
    <div className="flex items-center gap-1 min-w-0">
      <span className="t-mono truncate leading-5" title={path || ''}>
        {detected ? path : emptyText}
      </span>
      {detected && onOpen && (
        <button
          onClick={onOpen}
          title={`打开 ${label} 存档目录`}
          className="shrink-0 text-ink-faint hover:text-ink-text transition-colors"
        >
          <Folder className="w-3 h-3" />
        </button>
      )}
    </div>
  </div>
);

export const GameCard: React.FC<GameCardProps> = ({ game, onInspectGame, onQuickMigrate, onTestGame, isMigrating, onError }) => {
  const [iconFailed, setIconFailed] = useState(false);
  const [launching, setLaunching] = useState(false);
  useEffect(() => setIconFailed(false), [game.iconUrl]);
  const hasSaves = game.isSteamDetected || game.isXboxDetected;

  const handleOpenFolder = async (folderPath: string, side: 'steam' | 'xbox') => {
    try {
      await openFolder(folderPath);
    } catch (err: any) {
      onError(`无法打开${side === 'steam' ? 'Steam' : 'Xbox'}存档目录: ${err.message}`);
    }
  };

  const handleLaunch = async () => {
    if (!game.aumid) return;
    setLaunching(true);
    try {
      await launchXboxGame(game.aumid);
    } catch (err: any) {
      onError(`启动失败：${err.message}`);
    } finally {
      // 启动是异步的，这里只负责把按钮状态复位
      setTimeout(() => setLaunching(false), 1500);
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

  const directionBtn = (dir: 'xbox_to_steam' | 'steam_to_xbox') => {
    const isRecommended = recommendedDirection === dir;
    const enabled = dir === 'xbox_to_steam' ? game.isXboxDetected : game.isSteamDetected;
    const label = dir === 'xbox_to_steam' ? 'Xbox→Steam' : 'Steam→Xbox';
    const Icon = dir === 'xbox_to_steam' ? ArrowLeft : ArrowRight;
    const title = !enabled
      ? `未检测到 ${dir === 'xbox_to_steam' ? 'Xbox' : 'Steam'} 存档，无法移植`
      : isMigrating
        ? '正在执行其他移植...'
        : `将 ${dir === 'xbox_to_steam' ? 'Xbox' : 'Steam'} 存档移植到 ${dir === 'xbox_to_steam' ? 'Steam' : 'Xbox'}${isRecommended ? '（推荐方向）' : ''}`;

    if (isRecommended) {
      return (
        <button
          key={dir}
          onClick={() => onQuickMigrate(game, dir)}
          disabled={!enabled || isMigrating}
          title={title}
          className={`flex items-center gap-1 px-2.5 py-1 text-[12px] font-medium rounded-[4px] text-white transition-colors disabled:opacity-30 disabled:pointer-events-none ${
            dir === 'xbox_to_steam' ? 'bg-ink-xbox-to-steam hover:opacity-90' : 'bg-ink-steam-to-xbox hover:opacity-90'
          }`}
        >
          <Icon className="w-3 h-3" />
          {label}
        </button>
      );
    }
    return (
      <button
        key={dir}
        onClick={() => onQuickMigrate(game, dir)}
        disabled={!enabled || isMigrating}
        title={title}
        className="flex items-center gap-1 px-2 py-1 text-[12px] text-ink-muted hover:bg-ink-hover hover:text-ink-text rounded-[4px] transition-colors disabled:opacity-30 disabled:pointer-events-none"
      >
        <Icon className="w-3 h-3" />
        {label}
      </button>
    );
  };

  return (
    <div className={`px-4 py-3 transition-colors hover:bg-ink-hover ${hasSaves ? '' : 'opacity-60'}`}>
      <div className="flex flex-col xl:flex-row xl:items-center gap-2 xl:gap-4">

        {/* 身份列 */}
        <div className="flex items-center gap-2.5 min-w-0 xl:w-56 xl:shrink-0">
          <div className="w-8 h-8 rounded-[5px] shrink-0 overflow-hidden border border-ink-border bg-ink-base flex items-center justify-center">
            {game.iconUrl && !iconFailed ? (
              <img
                src={game.iconUrl}
                alt={game.name}
                className="w-full h-full object-cover"
                onError={() => setIconFailed(true)}
              />
            ) : (
              <Gamepad2 className="w-3.5 h-3.5 text-ink-faint" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[14px] font-medium text-ink-text truncate" title={game.name}>
                {game.name}
              </span>
              {game.isXboxInstalled && (
                <span className="badge bg-ink-accent-soft text-ink-accent shrink-0" title="来自 Xbox 游戏库：已安装，尚未检测到存档">
                  已安装
                </span>
              )}
            </div>
            <div className="t-mono truncate">
              {game.steamAppId ? `AppID ${game.steamAppId}` : game.id}
              {hasSaves ? ` · ${game.category} 类` : ''}
            </div>
          </div>
        </div>

        {/* Steam 列 */}
        <SideColumn
          label="Steam"
          detected={game.isSteamDetected}
          size={game.steamSaveSize}
          lastModified={game.steamLastModified}
          path={game.steamSavePath}
          emptyText="未检索到存档"
          onOpen={game.isSteamDetected ? () => handleOpenFolder(game.steamSavePath, 'steam') : undefined}
        />

        {/* Xbox 列（左侧分隔线） */}
        <SideColumn
          label="Xbox"
          detected={game.isXboxDetected}
          size={game.xboxSaveSize}
          lastModified={game.xboxLastModified}
          path={game.xboxWgsPath}
          emptyText="未检索到 WGS"
          onOpen={game.isXboxDetected ? () => handleOpenFolder(game.xboxWgsPath, 'xbox') : undefined}
          className="xl:border-l xl:border-ink-border xl:pl-4"
        />

        {/* 操作 */}
        <div className="flex items-center gap-1 xl:shrink-0">
          {recommendedDirection === 'xbox_to_steam' ? (
            <>
              {directionBtn('xbox_to_steam')}
              {directionBtn('steam_to_xbox')}
            </>
          ) : recommendedDirection === 'steam_to_xbox' ? (
            <>
              {directionBtn('steam_to_xbox')}
              {directionBtn('xbox_to_steam')}
            </>
          ) : (
            <>
              {directionBtn('xbox_to_steam')}
              {directionBtn('steam_to_xbox')}
            </>
          )}
          <button
            onClick={() => onInspectGame(game)}
            disabled={isMigrating}
            title={isMigrating ? '正在执行其他移植...' : '文件预览与 MD5 校验对比'}
            className="flex items-center gap-1 px-2 py-1 text-[12px] text-ink-muted hover:text-ink-text rounded-btn transition-colors disabled:opacity-50"
          >
            <Search className="w-3 h-3" />
            对比
          </button>
          {onTestGame && (
            <button
              onClick={() => onTestGame(game)}
              disabled={isMigrating}
              title={isMigrating ? '正在执行其他移植...' : '移植预演：不写文件，预测字节会落到哪些槽位'}
              className="flex items-center gap-1 px-2 py-1 text-[12px] text-ink-muted hover:text-ink-text rounded-btn transition-colors disabled:opacity-50"
            >
              <FlaskConical className="w-3 h-3" />
              预演
            </button>
          )}
          {game.isXboxInstalled && game.aumid && (
            <button
              onClick={handleLaunch}
              disabled={launching}
              title="绕过 Xbox 客户端直接启动，用于先生成存档结构"
              className="flex items-center gap-1 px-2 py-1 text-[12px] text-ink-muted hover:text-ink-text rounded-btn transition-colors disabled:opacity-50"
            >
              {launching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              启动
            </button>
          )}
        </div>
      </div>

      {game.notes && (
        <div className="mt-1.5 t-meta truncate pl-[38px]" title={game.notes}>
          {game.notes}
        </div>
      )}
    </div>
  );
};

export default GameCard;
