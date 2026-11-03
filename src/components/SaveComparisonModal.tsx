import React, { useEffect, useState, useCallback } from 'react';
import { GameItem } from '../types';
import { inspectSave, openFolder } from '../services/api';
import { useToast } from './Toast';
import { X, ArrowRight, ArrowLeft, Folder, ShieldCheck, Clock, Sparkles, AlertTriangle } from 'lucide-react';

interface SaveComparisonModalProps {
 game: GameItem | null;
 onClose: () => void;
 onMigrate: (gameId: string, direction: 'xbox_to_steam' | 'steam_to_xbox', customSteamPath?: string, customXboxPath?: string) => Promise<void>;
 isMigrating: boolean;
}

interface SteamFileInfo { fileName: string; size: number; md5: string; }
interface XboxContainerInfo { containerName: string; cloudName: string; guidHex: string; size: number; mappedFiles: any[]; }
interface InspectionData {
 recommendation: string;
 recommendationReason: string;
 steamInspection: { exists: boolean; path: string; files: SteamFileInfo[] };
 xboxInspection: { exists: boolean; path: string; containers: XboxContainerInfo[] };
}

export const SaveComparisonModal: React.FC<SaveComparisonModalProps> = ({
 game,
 onClose,
 onMigrate,
 isMigrating
}) => {
 const toast = useToast();

 // ALL hooks must run before any early return — this was the original bug.
 const [customSteamPath, setCustomSteamPath] = useState('');
 const [customXboxPath, setCustomXboxPath] = useState('');
 const [activeDirection, setActiveDirection] = useState<'xbox_to_steam' | 'steam_to_xbox'>('xbox_to_steam');
 const [inspectionData, setInspectionData] = useState<InspectionData | null>(null);
 const [loadingInspect, setLoadingInspect] = useState(false);

 const loadInspection = useCallback(async (gameId: string) => {
 setLoadingInspect(true);
 try {
 const data = await inspectSave(gameId);
 setInspectionData(data);
 if (data.recommendation === 'steam_to_xbox') {
 setActiveDirection('steam_to_xbox');
 } else {
 setActiveDirection('xbox_to_steam');
 }
 } catch (err: any) {
 toast(`存档检视失败: ${err.message}`, 'error');
 } finally {
 setLoadingInspect(false);
 }
 }, [toast]);

 useEffect(() => {
 if (game) {
 setCustomSteamPath(game.steamSavePath);
 setCustomXboxPath(game.xboxWgsPath);
 loadInspection(game.id);
 }
 }, [game, loadInspection]);

 // ESC to close
 useEffect(() => {
 if (!game) return;
 const handler = (e: KeyboardEvent) => {
 if (e.key === 'Escape') onClose();
 };
 document.addEventListener('keydown', handler);
 return () => document.removeEventListener('keydown', handler);
 }, [game, onClose]);

 // Early return AFTER all hooks — this is the fix for the Rules of Hooks violation.
 if (!game) return null;

 const handleOpenFolder = async (pathStr: string) => {
 try {
 await openFolder(pathStr);
 } catch (err: any) {
 toast(`无法打开目录: ${err.message}`, 'error');
 }
 };

 const handleExecute = async () => {
 await onMigrate(game.id, activeDirection, customSteamPath, customXboxPath);
 };

 const handleBackdropClick = (e: React.MouseEvent) => {
 if (e.target === e.currentTarget) onClose();
 };

 // Build a diff map: match Steam files to Xbox containers by name
 const steamFiles = inspectionData?.steamInspection?.files || [];
 const xboxContainers = inspectionData?.xboxInspection?.containers || [];

 const isAgainstRecommendation = inspectionData &&
 ((inspectionData.recommendation === 'xbox_to_steam' && activeDirection === 'steam_to_xbox') ||
 (inspectionData.recommendation === 'steam_to_xbox' && activeDirection === 'xbox_to_steam'));

 return (
 <div
 className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
 onClick={handleBackdropClick}
 role="dialog"
 aria-modal="true"
 aria-label={`存档对比 — ${game.name}`}
 >
 <div className="bg-[#141417] border border-white/[0.08] w-full max-w-4xl rounded-card overflow-hidden relative modal-animate">

 {/* Modal Header */}
 <div className="px-6 py-4 border-b border-white/[0.07] flex items-center justify-between">
 <div className="flex items-center gap-3">
 {game.iconUrl && (
 <img src={game.iconUrl} alt={game.name} className="w-11 h-11 rounded-card object-cover border border-white/[0.1]" />
 )}
 <div>
 <h2 className="font-bold text-base text-white">{game.name}</h2>
 <p className="text-xs text-zinc-500">双端存档校验、文件预览与智能移植面板</p>
 </div>
 </div>

 <button
 onClick={onClose}
 className="p-2 rounded-card text-zinc-500 hover:text-white hover:bg-ink-surface/[0.06] transition-colors"
 aria-label="关闭"
 >
 <X className="w-5 h-5" />
 </button>
 </div>

 {/* Modal Body */}
 <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">

 {/* Smart Recommendation Banner */}
 {inspectionData && inspectionData.recommendationReason && (
 <div className="p-4 rounded-card bg-ink-surface/[0.03] border border-white/[0.08] flex items-center justify-between gap-4">
 <div className="flex items-center gap-3">
 <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
 <div className="text-xs text-zinc-300">
 <span className="font-semibold block mb-0.5">智能推荐诊断：</span>
 {inspectionData.recommendationReason}
 </div>
 </div>
 {isAgainstRecommendation && (
 <span className="px-3 py-1 text-xs font-bold rounded-card bg-red-500/15 text-red-400 border border-red-500/30 shrink-0 flex items-center gap-1">
 <AlertTriangle className="w-3.5 h-3.5" />
 方向相反
 </span>
 )}
 </div>
 )}

 {/* Side-by-side comparison */}
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 
 {/* Steam Side Panel */}
 <div className="p-4 rounded-card bg-ink-surface/[0.02] border border-white/[0.08] space-y-3">
 <div className="flex items-center justify-between border-b border-white/[0.07] pb-2.5">
 <div className="flex items-center gap-2 text-zinc-200 font-semibold text-sm">
 <span className="w-2 h-2 rounded-full bg-sky-400"></span>
 Steam 本地存档区
 </div>
 {game.isSteamDetected && (
 <button
 onClick={() => handleOpenFolder(customSteamPath)}
 className="px-2.5 py-1 text-[11px] font-medium rounded-btn bg-ink-surface/[0.04] hover:bg-ink-surface/[0.08] text-zinc-300 border border-white/[0.08] transition-colors flex items-center gap-1"
 >
 <Folder className="w-3.5 h-3.5" />
 打开文件夹
 </button>
 )}
 </div>

 <div className="space-y-2 text-xs">
 <div>
 <label className="text-zinc-400 text-[11px] block mb-1">Steam 存档绝对路径：</label>
 <input
 type="text"
 value={customSteamPath}
 onChange={e => setCustomSteamPath(e.target.value)}
 className="w-full bg-zinc-900 border border-zinc-800 rounded-card px-3 py-2 font-mono text-[11px] text-zinc-200 focus:outline-none focus:border-white/25"
 />
 </div>

 <div className="flex items-center justify-between text-zinc-400 pt-1">
 <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> 更新时间：</span>
 <span className="font-mono text-zinc-200">{game.steamLastModified ? new Date(game.steamLastModified).toLocaleString('zh-CN') : '未检测到'}</span>
 </div>

 {/* File list with real MD5 */}
 <div className="pt-2">
 <span className="text-zinc-400 text-[11px] block mb-1 font-semibold">存档文件列表 (MD5)：</span>
 <div className="bg-zinc-900/90 rounded-card p-2 max-h-32 overflow-y-auto font-mono text-[10px] space-y-1 border border-zinc-800">
 {steamFiles.length > 0 ? (
 steamFiles.map((f, idx) => (
 <div key={idx} className="flex items-center justify-between text-zinc-300 border-b border-zinc-800/40 pb-0.5 gap-2">
 <span className="truncate flex-1" title={f.fileName}>{f.fileName}</span>
 <span className="text-zinc-500 shrink-0">{(f.size / 1024).toFixed(1)} KB</span>
 <span className="text-zinc-400 text-[9px] bg-ink-surface/[0.06] px-1 rounded shrink-0" title={f.md5}>{f.md5.substring(0, 8)}</span>
 </div>
 ))
 ) : (
 <span className="text-zinc-600 block text-center py-2">{loadingInspect ? '加载中...' : '暂无文件列表'}</span>
 )}
 </div>
 </div>
 </div>
 </div>

 {/* Xbox Side Panel */}
 <div className="p-4 rounded-card bg-ink-surface/[0.02] border border-white/[0.08] space-y-3">
 <div className="flex items-center justify-between border-b border-white/[0.07] pb-2.5">
 <div className="flex items-center gap-2 text-zinc-200 font-semibold text-sm">
 <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
 Xbox WGS 容器存档区
 </div>
 {game.isXboxDetected && (
 <button
 onClick={() => handleOpenFolder(customXboxPath)}
 className="px-2.5 py-1 text-[11px] font-medium rounded-btn bg-ink-surface/[0.04] hover:bg-ink-surface/[0.08] text-zinc-300 border border-white/[0.08] transition-colors flex items-center gap-1"
 >
 <Folder className="w-3.5 h-3.5" />
 打开 WGS 目录
 </button>
 )}
 </div>

 <div className="space-y-2 text-xs">
 <div>
 <label className="text-zinc-400 text-[11px] block mb-1">Xbox WGS 目录路径：</label>
 <input
 type="text"
 value={customXboxPath}
 onChange={e => setCustomXboxPath(e.target.value)}
 className="w-full bg-zinc-900 border border-zinc-800 rounded-card px-3 py-2 font-mono text-[11px] text-zinc-200 focus:outline-none focus:border-white/25"
 />
 </div>

 <div className="flex items-center justify-between text-zinc-400 pt-1">
 <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> 更新时间：</span>
 <span className="font-mono text-zinc-200">{game.xboxLastModified ? new Date(game.xboxLastModified).toLocaleString('zh-CN') : '未检测到'}</span>
 </div>

 {/* Containers preview */}
 <div className="pt-2">
 <span className="text-zinc-400 text-[11px] block mb-1 font-semibold">WGS Save Containers：</span>
 <div className="bg-zinc-900/90 rounded-card p-2 max-h-32 overflow-y-auto font-mono text-[10px] space-y-1 border border-zinc-800">
 {xboxContainers.length > 0 ? (
 xboxContainers.map((c, idx) => (
 <div key={idx} className="flex items-center justify-between text-zinc-300 border-b border-zinc-800/40 pb-0.5 gap-2">
 <span className="truncate flex-1" title={c.containerName}>{c.containerName}</span>
 <span className="text-zinc-500 shrink-0">{(c.size / 1024).toFixed(1)} KB</span>
 <span className="text-zinc-400 text-[9px] bg-ink-surface/[0.06] px-1 rounded shrink-0">{c.mappedFiles?.length || 0} files</span>
 </div>
 ))
 ) : (
 <span className="text-zinc-600 block text-center py-2">{loadingInspect ? '加载中...' : '暂无容器列表'}</span>
 )}
 </div>
 </div>
 </div>
 </div>

 </div>

 {/* Direction Selection */}
 <div className="space-y-2">
 <label className="text-xs font-bold text-zinc-200 block">确认移植方向：</label>
 <div className="grid grid-cols-2 gap-3">
 
 <button
 onClick={() => setActiveDirection('xbox_to_steam')}
 className={`p-4 rounded-card border flex flex-col items-center gap-2 transition-colors ${
 activeDirection === 'xbox_to_steam'
 ? 'bg-emerald-600/15 border-emerald-500/60 text-white'
 : 'bg-ink-surface/[0.02] border-white/[0.08] text-zinc-400 hover:border-white/[0.2]'
 }`}
 >
 <div className="flex items-center gap-2 font-bold text-sm">
 <ArrowLeft className="w-4 h-4 text-emerald-400" />
 <span>从 Xbox 提取并移植至 Steam</span>
 </div>
 <p className="text-[11px] text-zinc-500 text-center">
 解析 Xbox WGS containers.index 提取 Blob 存档文件，写入 Steam 本地目录。
 </p>
 </button>

 <button
 onClick={() => setActiveDirection('steam_to_xbox')}
 className={`p-4 rounded-card border flex flex-col items-center gap-2 transition-colors ${
 activeDirection === 'steam_to_xbox'
 ? 'bg-sky-600/15 border-sky-500/60 text-white'
 : 'bg-ink-surface/[0.02] border-white/[0.08] text-zinc-400 hover:border-white/[0.2]'
 }`}
 >
 <div className="flex items-center gap-2 font-bold text-sm">
 <span>从 Steam 打包并移植至 Xbox</span>
 <ArrowRight className="w-4 h-4 text-sky-400" />
 </div>
 <p className="text-[11px] text-zinc-500 text-center">
 读取 Steam 本地存档，打包 Blob 结构并逆向生成 containers.index 写入 Xbox。
 </p>
 </button>

 </div>
 </div>

 {/* Reverse-direction warning */}
 {isAgainstRecommendation && (
 <div className="p-3.5 rounded-card bg-red-950/40 border border-red-500/40 flex items-center gap-3 text-xs text-red-200">
 <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
 <span>警告：当前选择的移植方向与智能推荐相反，可能导致较新的存档被较旧的存档覆盖！</span>
 </div>
 )}

 {/* Backup Guarantee Banner */}
 <div className="p-3.5 rounded-card bg-zinc-950 border border-zinc-800 flex items-center justify-between text-xs text-zinc-400">
 <div className="flex items-center gap-2">
 <ShieldCheck className="w-4 h-4 text-emerald-400" />
 <span>智能安全防护：覆盖前强制自动创建 ZIP 时间戳归档</span>
 </div>
 <span className="text-[11px] text-emerald-400 font-mono">备份已就绪</span>
 </div>

 </div>

 {/* Modal Footer */}
 <div className="px-6 py-4 border-t border-white/[0.07] flex items-center justify-end gap-3">
 <button
 onClick={onClose}
 className="px-4 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
 >
 取消
 </button>

 <button
 onClick={handleExecute}
 disabled={isMigrating}
 className="px-6 py-2.5 text-xs font-bold rounded-card bg-ink-accent hover:bg-ink-accent-hover text-white transition-colors disabled:opacity-50 flex items-center gap-2"
 >
 {isMigrating ? (
 <>
 <span className="w-3.5 h-3.5 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin"></span>
 <span>正在提取并转换中...</span>
 </>
 ) : (
 <span>一键开始存档无损移植</span>
 )}
 </button>
 </div>

 </div>
 </div>
 );
};
