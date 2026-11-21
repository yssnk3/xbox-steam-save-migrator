import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Library, Play, RefreshCw, Search, CloudOff, CloudUpload, Loader2 } from 'lucide-react';
import { XboxInstalledGame, XboxCloudSyncStopResult } from '../types';
import { fetchXboxLibrary, launchXboxGame, checkXboxGameRunning, stopXboxCloudSync, getXboxCloudSyncStatus } from '../services/api';
import { useToast } from './Toast';
import { ConfirmDialog, ConfirmDialogConfig } from './ConfirmDialog';

interface XboxLibraryPanelProps {
  onAddLog: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  /** 扫描结果提到 App 层保存：切页不丢、进入程序自动加载 */
  games: XboxInstalledGame[];
  scanning: boolean;
  hasScanned: boolean;
  /** 强制刷新（忽略缓存） */
  onForceRefresh: () => void;
  /** 搜索跳转后要定位高亮的包名 */
  highlightKey?: string | null;
}

const API_BASE = typeof window !== 'undefined' && window.location.protocol === 'file:'
 ? 'http://localhost:3001'
 : '';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** 上传云存档的行内状态机。 */
type UploadState = 'idle' | 'starting' | 'monitoring' | 'waiting-manual';

const XboxLibraryPanel: React.FC<XboxLibraryPanelProps> = ({
  onAddLog,
  games,
  scanning,
  hasScanned,
  onForceRefresh,
  highlightKey,
}) => {
  const toast = useToast();

  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

 const [running, setRunning] = useState<Record<string, boolean>>({});
 const [launching, setLaunching] = useState<string | null>(null);
 const [uploadStates, setUploadStates] = useState<Record<string, UploadState>>({});

 const [stopping, setStopping] = useState(false);
 const [stopResult, setStopResult] = useState<XboxCloudSyncStopResult | null>(null);
 const [cloudStage, setCloudStage] = useState('');

 const [confirmConfig, setConfirmConfig] = useState<ConfirmDialogConfig | null>(null);
 const confirmResolve = useRef<((v: boolean) => void) | null>(null);
 const mountedRef = useRef(true);
 useEffect(() => () => { mountedRef.current = false; }, []);

  const pollUntilRunning = useCallback(async (game: XboxInstalledGame, attempts = 15): Promise<
 'running' | 'stalled' | 'timeout'> => {
 let helperOnlyStreak = 0;
 for (let i = 0; i < attempts; i++) {
 await sleep(2000);
 if (!mountedRef.current) return 'timeout';
 try {
 const r = await checkXboxGameRunning(game.installLocation);
 if (r.running) {
 const realGameUp = r.matchedNames.some(n => !/gamelaunchhelper/i.test(n));
        if (realGameUp) return 'running';
        helperOnlyStreak++; // 只有启动助手在跑 —— 可能停滞
        if (helperOnlyStreak >= 8) return 'stalled'; // let the caller retry once
        continue;
 }
 } catch { /* 网络抖动，继续重试 */ }
 }
 return 'timeout';
 }, []);

 const pollUntilExited = useCallback(async (game: XboxInstalledGame, maxMs = 30 * 60 * 1000): Promise<boolean> => {
 const deadline = Date.now() + maxMs;
 while (Date.now() < deadline) {
 await sleep(3000);
 if (!mountedRef.current) return false;
 try {
 const r = await checkXboxGameRunning(game.installLocation);
 if (!r.running) return true;
 } catch { /* 忽略单次检测失败 */ }
 }
 return false;
 }, []);

 const handleLaunch = useCallback(async (game: XboxInstalledGame) => {
 setLaunching(game.pfn);
 try {
 await launchXboxGame(game.aumid);
 onAddLog(`已发出启动指令：${game.displayName}`, 'info');
 const result = await pollUntilRunning(game);
 if (result === 'running') {
 setRunning(prev => ({ ...prev, [game.pfn]: true }));
 toast(`${game.displayName} 已启动`, 'success');
 } else if (result === 'stalled') {
 toast(`${game.displayName} 启动停滞（仅启动助手在运行）——已自动重试一次`, 'warning');
 await launchXboxGame(game.aumid);
 const retry = await pollUntilRunning(game, 10);
 if (retry === 'running') {
 setRunning(prev => ({ ...prev, [game.pfn]: true }));
 toast(`${game.displayName} 已启动`, 'success');
 } else {
 toast(`${game.displayName} 未能拉起游戏进程，请稍后重试`, 'error');
 }
 } else {
 toast(`未检测到 ${game.displayName} 的游戏进程，可重试一次`, 'warning');
 }
 } catch (err) {
 const msg = err instanceof Error ? err.message : String(err);
 toast(`启动失败：${msg}`, 'error');
 onAddLog(`启动 ${game.displayName} 失败：${msg}`, 'error');
 } finally {
 setLaunching(null);
 }
 }, [toast, onAddLog, pollUntilRunning]);

 const showConfirm = useCallback((config: ConfirmDialogConfig): Promise<boolean> =>
 new Promise(resolve => {
 confirmResolve.current = resolve;
 setConfirmConfig(config);
 }), []);

 const handleUploadCloud = useCallback(async (game: XboxInstalledGame) => {
 const ok = await showConfirm({
 title: `上传云存档 · ${game.displayName}`,
 message: 'Xbox 云存档没有官方上传接口，同步只在游戏会话内发生。将为你启动游戏：进入游戏后等待「同步存档」提示完成，然后正常退出游戏。\n\n⚠️ 覆盖风险：本工具无法读取 Xbox 云端状态，"游戏已退出"只代表本地会话结束，不代表云端已写入。若此时另一端仍有旧档并触发同步，可能反向覆盖本地刚移植的存档。上传后请务必在另一台设备验证读档。',
 confirmLabel: '启动游戏并监控',
 variant: 'default',
 });
 if (!ok) return;

 setUploadStates(prev => ({ ...prev, [game.pfn]: 'starting' }));
 try {
 await launchXboxGame(game.aumid);
 onAddLog(`云存档上传：已启动 ${game.displayName}`, 'info');
 const result = await pollUntilRunning(game);
 if (result !== 'running') {
 // 停滞场景自动重试一次（GameLaunchHelper 与 Xbox 后台组件复活存在时序竞争）
 await launchXboxGame(game.aumid);
 const retry = await pollUntilRunning(game, 10);
 if (retry !== 'running') {
 toast(`未能拉起 ${game.displayName}，请手动启动游戏完成同步`, 'error');
 onAddLog(`云存档上传：${game.displayName} 未能启动`, 'error');
 return;
 }
 }
 setUploadStates(prev => ({ ...prev, [game.pfn]: 'monitoring' }));
 toast(`${game.displayName} 已启动，请等待游戏内「同步存档」完成后退出`, 'info');
 const exited = await pollUntilExited(game);
 if (exited) {
 toast(`${game.displayName} 已退出：仅确认本地会话结束，云端是否写入尚未验证，请在另一台设备读档确认`, 'warning');
 onAddLog(`云存档上传：${game.displayName} 本地会话已结束（云端写入未验证）`, 'warning');
 } else {
 toast(`${game.displayName} 长时间未退出，已停止监控（不影响游戏）`, 'warning');
 onAddLog(`云存档上传：${game.displayName} 监控超时`, 'warning');
 }
 } catch (err) {
 const msg = err instanceof Error ? err.message : String(err);
 toast(`上传流程失败：${msg}`, 'error');
 onAddLog(`云存档上传失败：${msg}`, 'error');
 } finally {
 setUploadStates(prev => ({ ...prev, [game.pfn]: 'idle' }));
 }
 }, [showConfirm, onAddLog, toast, pollUntilRunning, pollUntilExited]);

 const handleStopCloudSync = useCallback(async () => {
 setStopping(true);
 setStopResult(null);
 setCloudStage('准备中…');
 try {
 // The server runs the long task asynchronously; poll its real stage instead
 // of blocking the renderer for up to 30s on a single HTTP request.
 await stopXboxCloudSync();
 for (let i = 0; i < 80; i++) {
 const p = await getXboxCloudSyncStatus();
 setCloudStage(p.stage);
 if (p.done) {
 if (p.error) throw new Error(p.error);
 const r = p.result!;
 setStopResult(r);
 const parts: string[] = [];
 parts.push(r.xboxAppClosed ? 'Xbox 应用已关闭' : 'Xbox 应用未在运行');
 if (r.servicesStopped.length) parts.push(`服务已停止：${r.servicesStopped.join(', ')}`);
 if (r.servicesFailed.length) parts.push(`服务停止失败（需管理员）：${r.servicesFailed.join(', ')}`);
 if (r.gamesRunning.length) parts.push(`注意：仍有游戏进程在运行：${r.gamesRunning.join(', ')}`);
 const partial = r.servicesFailed.length > 0 || r.xboxAppStillRunning.length > 0 || r.gamesRunning.length > 0;
 toast(partial ? '云同步防护已执行，但有未完成项' : '云存档同步防护已执行', partial ? 'warning' : 'success');
 onAddLog(`停止云同步：${parts.join('；')}`, partial ? 'warning' : 'success');
 if (r.xboxAppStillRunning.length > 0) {
 toast(`部分进程未能关闭：${r.xboxAppStillRunning.join(', ')}，建议手动退出`, 'warning');
 }
 return;
 }
 await sleep(500);
 }
 throw new Error('云同步防护超时（40 秒），请查看日志');
 } catch (err) {
 const msg = err instanceof Error ? err.message : String(err);
 toast(`停止云同步失败：${msg}`, 'error');
 onAddLog(`停止云同步失败：${msg}`, 'error');
 } finally {
 setStopping(false);
 setCloudStage('');
 }
 }, [toast, onAddLog]);

 const filtered = games.filter(g => {
 if (!showAll && !g.isGame) return false;
 if (!query.trim()) return true;
 const q = query.trim().toLowerCase();
 return g.displayName.toLowerCase().includes(q) || g.pfn.toLowerCase().includes(q);
 });

 return (
    <div className="space-y-4">
      {/* 云存档同步区（页面大标题已在上方，此处不再重复标题） */}
      <div className="panel p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
 <div className="flex items-center gap-2">
 <CloudOff className="w-3.5 h-3.5 text-ink-muted" />
 <h3 className="text-[14px] font-medium text-ink-text">云存档同步控制</h3>
 </div>
 <button
 onClick={handleStopCloudSync}
 disabled={stopping}
 className="px-3 py-1.5 text-[13px] btn-primary disabled:opacity-40 flex items-center gap-1.5"
 >
 {stopping ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CloudOff className="w-3 h-3" />}
 {stopping ? '执行中...' : '停止云同步'}
 </button>
 {cloudStage && <span className="text-[12px] text-ink-muted self-center">{cloudStage}</span>}
 </div>
        <p className="t-meta">
          临时关闭 Xbox 应用与后台组件并尝试停止 GamingServices，降低移植后被云端旧档覆盖的概率。注意：服务可能被系统自动重启、已排队上传不会撤销；移植后首次启动遇到冲突仍必须选「使用本地存档」
        </p>
 {stopResult && (
 <div className="text-[12px] font-mono text-ink-muted pl-3 border-l border-ink-border space-y-1">
 <div>· Xbox 应用：{stopResult.xboxAppClosed ? `已关闭（${stopResult.xboxAppStillRunning.length === 0 ? '无残留' : `仍有 ${stopResult.xboxAppStillRunning.join(', ')}`}` : '未在运行'}</div>
 <div>· XboxPcAppFT：{stopResult.ftKilled ? '已击杀（会被系统自动复活，属预期）' : '未在运行'}</div>
 <div>· GamingServices：{stopResult.servicesStopped.length > 0 ? `已停止 ${stopResult.servicesStopped.join(', ')}` : stopResult.servicesFailed.length > 0 ? `停止失败（需管理员权限）：${stopResult.servicesFailed.join(', ')}` : '无需处理'}</div>
 {stopResult.gamesRunning.length > 0 && (
 <div className="text-ink-warning">· 仍有游戏进程运行：{stopResult.gamesRunning.join(', ')}——其云会话仍然存活，请先退出游戏</div>
 )}
 {stopResult.hints.map((h, i) => <div key={i} className="text-ink-muted">· {h}</div>)}
 </div>
 )}
 </div>

 {/* 游戏库区 */}
 <div className="space-y-3">
 <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onForceRefresh}
          disabled={scanning}
          className="px-3 py-1.5 text-[13px] btn-ghost disabled:opacity-40 flex items-center gap-1.5"
          title="忽略缓存，重新枚举本机已安装的打包应用"
        >
          <RefreshCw className={`w-3 h-3 ${scanning ? 'animate-spin' : ''}`} />
          {scanning ? '刷新中…' : '强制刷新'}
        </button>
 <div className="relative flex-1 min-w-[160px]">
 <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-ink-faint" />
 <input
 value={query}
 onChange={e => setQuery(e.target.value)}
 placeholder="搜索游戏名或包名..."
 className="w-full pl-7 pr-2 py-1.5 text-[13px] border border-ink-border rounded-btn hover:border-ink-faint focus:outline-none focus:border-ink-accent focus:shadow-[0_0_0_2px_var(--ink-accent-soft)] bg-ink-base text-ink-text placeholder:text-ink-faint"
 />
 </div>
 <label className="flex items-center gap-1.5 text-[12px] text-ink-muted cursor-pointer select-none">
 <input
 type="checkbox"
 checked={showAll}
 onChange={e => setShowAll(e.target.checked)}
 className="w-3.5 h-3.5 accent-[color:var(--ink-accent)]"
 />
 显示全部应用
 </label>
 </div>

      {!hasScanned && !scanning && (
        <p className="t-meta py-8 text-center">点左下角「扫描」加载本机已安装的 Game Pass 游戏</p>
      )}
      {hasScanned && filtered.length === 0 && !scanning && (
        <p className="t-meta py-8 text-center">没有匹配的结果</p>
      )}

        <div className="panel divide-y divide-ink-borderSoft overflow-hidden">
          {filtered.map(game => {
            const upload = uploadStates[game.pfn] || 'idle';
            const isUploading = upload === 'starting' || upload === 'monitoring';
            const isHighlighted = highlightKey === game.pfn;
            return (
              <div
                key={game.pfn}
                data-pfn={game.pfn}
                className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${
                  isHighlighted ? 'bg-ink-accent-soft' : 'hover:bg-ink-hover'
                }`}
              >
 <div className="w-7 h-7 rounded-[4px] border border-ink-borderSoft bg-ink-elevated flex items-center justify-center overflow-hidden shrink-0">
 <img
 src={`${API_BASE}/api/xbox-icon/${encodeURIComponent(game.pfn)}`}
 alt=""
 className="w-7 h-7 object-contain"
 onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
 />
 </div>
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2">
 <span className="text-[14px] text-ink-text truncate">{game.displayName}</span>
 {game.hasWgs && (
 <span className="badge bg-ink-success-soft text-ink-success shrink-0">有存档</span>
 )}
 {running[game.pfn] && (
 <span className="flex items-center gap-1 text-[11px] text-ink-success shrink-0">
 <span className="w-1.5 h-1.5 rounded-full bg-ink-success" />
 运行中
 </span>
 )}
 {isUploading && (
 <span className="flex items-center gap-1 text-[12px] text-ink-accent shrink-0">
 <Loader2 className="w-2.5 h-2.5 animate-spin" />
 {upload === 'starting' ? '启动中...' : '同步监控中——退出游戏后自动确认'}
 </span>
 )}
 </div>
 <div className="text-[12px] font-mono text-ink-faint truncate">{game.pfn}</div>
 </div>
 <div className="flex items-center gap-1.5 shrink-0">
 <button
 onClick={() => handleUploadCloud(game)}
 disabled={isUploading || launching === game.pfn}
 title="启动游戏触发云同步；工具只能确认本地会话结束，无法验证云端写入，需在另一台设备确认"
 className="px-2.5 py-1 text-[12px] btn-ghost disabled:opacity-40 flex items-center gap-1"
 >
 <CloudUpload className="w-3 h-3" />
 上传云存档
 </button>
 <button
 onClick={() => handleLaunch(game)}
 disabled={launching === game.pfn || isUploading}
 title="绕过 Xbox 客户端直接启动"
 className="px-2.5 py-1 text-[12px] btn-primary disabled:opacity-40 flex items-center gap-1"
 >
 {launching === game.pfn
 ? <RefreshCw className="w-3 h-3 animate-spin" />
 : <Play className="w-3 h-3" />}
 {launching === game.pfn ? '启动中...' : '启动'}
 </button>
 </div>
 </div>
 );
 })}
 </div>
 </div>

 {confirmConfig && (
 <ConfirmDialog
 {...confirmConfig}
 onConfirm={() => { setConfirmConfig(null); confirmResolve.current?.(true); }}
 onCancel={() => { setConfirmConfig(null); confirmResolve.current?.(false); }}
 />
 )}
 </div>
 );
};

export default XboxLibraryPanel;
