import React, { useEffect, useRef, useState } from 'react';
import { identifySave, identifyAndMigrate, manualMigrateSave, pickFile, pickFolder, resolveCounterpart, copySave } from '../services/api';
import { migrationOutcome, outcomeText } from '../utils/migrationOutcome';
import { VerifyReport } from '../types';
import { useToast } from './Toast';
import { Folder, FileText, ArrowLeft, ArrowRight, ArrowRightLeft, RefreshCw, Search, Sparkles, ChevronDown, ChevronUp, Wand2, Settings2, FlaskConical } from 'lucide-react';

interface IdentifyMigratePanelProps {
 onAddLog: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
 onMigrated: () => void;
 isMigrating: boolean;
 /** App-level confirm dialog; returns true if the user confirmed. */
 onConfirmMigrate: (info: { dirText: string; gameName?: string; direction: 'xbox_to_steam' | 'steam_to_xbox' }) => Promise<boolean>;
 /** Sink busy state to App so ALL migration buttons disable during this one. */
 onMigratingChange: (v: boolean) => void;
  /** Optional: open the read-only portability test (预演) for the identified game. */
  onPreviewGame?: (gameId: string) => void;
  /** Optional: surface a failure so App can offer AI diagnosis. */
  onFailure?: (ctx: {
    error?: unknown;
    verify?: unknown;
    message?: string;
    direction?: string;
    /** 游戏名，让 AI 知道是哪款游戏出的问题 */
    gameName?: string | null;
    /** 后端错误码（PLATFORM_RUNNING / BYTE_INCOMPATIBLE 等） */
    code?: string | null;
  }) => void;
}

interface IdentifyResult {
 side?: 'xbox' | 'steam' | 'unknown';
 error?: string;
 indexPackageName?: string;
 formatHint?: string;
 formatDetected?: string;
 matches?: Array<{
 id: string;
 name: string;
 category?: string;
 confidence: 'high' | 'medium' | 'low';
 matchTypes: string[];
 evidence: string[];
 evidenceSummary?: string;
 steamAppId?: string;
 xboxPackageName?: string;
 notes?: string | null;
 steamXboxByteIncompatible?: boolean;
 needsConversionTool?: boolean | string | null;
 accountBound?: boolean;
 }>;
}

interface Counterpart {
 found?: boolean;
 gameId?: string;
 name?: string;
 category?: string | null;
 notes?: string | null;
 steamSavePath?: string | null;
 steamExists?: boolean;
 steamLastModified?: string | null;
 steamSize?: number;
 steamFileCount?: number;
 xboxWgsPath?: string | null;
 xboxExists?: boolean;
 xboxLastModified?: string | null;
 xboxSize?: number;
 xboxFileCount?: number;
}

const MATCH_TYPE_LABEL: Record<string, string> = {
 xbox_package_folder: 'Xbox 包目录',
 containers_index: 'containers.index 包名',
 steam_userdata_appid: 'Steam AppID',
 known_folder: '已知存档目录',
 file_pattern: '文件模式',
 install_dir: '安装目录',
 file_convention: '存档命名约定',
 format_fingerprint: '文件格式指纹',
 content_keyword: '内容关键词',
 path_keyword: '路径关键词',
};

const CONFIDENCE_STYLE: Record<string, string> = {
 high: 'text-ink-success',
 medium: 'text-ink-warning',
 low: 'bg-ink-elevated text-ink-muted border-ink-border',
};

const CONFIDENCE_LABEL: Record<string, string> = { high: '高置信', medium: '中置信', low: '低置信' };

type LogFn = (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;

/** Shared audit-report logging for both migration entry points in this panel. */
function logVerifyReport(v: VerifyReport | undefined, log: LogFn) {
 if (!v) return;
 if (!v.ok) {
 log(`[落盘校验] 未通过：${v.note}`, 'error');
 return;
 }
 log(`[落盘校验] 已安装至目标路径：${v.targetPath}`, 'info');
 if (v.mode === 'in-place') {
 log('[写入方式] 保留 Xbox 端原有容器结构，仅替换存档字节（容器名/GUID/清单未改动）', 'info');
 } else if (v.mode === 'rebuild') {
 log('[写入方式] Xbox 端此前无存档结构，已新建容器（容器名按文件名推断，游戏可能读不到）', 'warning');
 }
 (v.files || []).forEach(f => {
 const hashNote = f.md5Match === true ? '（MD5 校验通过）' : f.md5Match === false ? '（⚠️ MD5 校验不一致）' : '';
 log(`✅ 已写入 ${f.name} (${f.size}B)${f.original && f.original !== f.name ? ` ← ${f.original}` : ''} → ${f.path}${hashNote}`, 'success');
 });
 (v.blobs || []).forEach(b => {
 const hashNote = b.md5Match === true ? '（MD5 校验通过）' : b.md5Match === false ? '（⚠️ MD5 不一致）' : '';
 const src = b.source ? ` ← ${b.source}` : '';
 log(`✅ Xbox 容器已写入 ${b.name}${src} (${b.exists && b.sizeOk ? '成功' : b.exists ? '大小不符' : '缺失'})${hashNote}`, 'success');
 });
 (v.skippedContainers || []).forEach(s => {
 log(`⏭️ 跳过容器 ${s.container}：${s.reason}`, 'info');
 });
 if (v.unusedSteamFiles && v.unusedSteamFiles.length > 0) {
 log(`⚠️ 以下 Steam 存档在 Xbox 结构中没有对应存档位，未被移植：${v.unusedSteamFiles.join('、')}`, 'warning');
 }
 if (v.note) log(`[请确认] ${v.note}`, 'warning');
}

/** Coarse save-format class implied by which platform layout the folder uses. */
const SIDE_FORMAT_LABEL: Record<string, string> = {
 xbox: 'Xbox WGS 容器格式',
 steam: 'Steam 存档格式',
 unknown: '格式未判定',
};

function formatBytes(bytes?: number): string {
 if (!bytes) return '0 B';
 const k = 1024;
 const sizes = ['B', 'KB', 'MB', 'GB'];
 const i = Math.floor(Math.log(bytes) / Math.log(k));
 return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(dateStr?: string | null): string {
 if (!dateStr) return '—';
 return new Date(dateStr).toLocaleString('zh-CN', {
 month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
 });
}

export const IdentifyMigratePanel: React.FC<IdentifyMigratePanelProps> = ({ onAddLog, onMigrated, isMigrating, onConfirmMigrate, onMigratingChange, onPreviewGame, onFailure }) => {
 const toast = useToast();

 // === Primary flow: pick ONE save path → identify → one-click migrate ===
 const [sourcePath, setSourcePath] = useState('');
 const [sourceResult, setSourceResult] = useState<IdentifyResult | null>(null);
 const [probingSource, setProbingSource] = useState(false);
 const [counterpart, setCounterpart] = useState<Counterpart | null>(null);
 const [oneClickBusy, setOneClickBusy] = useState(false);

 // === Custom mode (advanced): dual-path inputs, kept from the old panel ===
 const [customOpen, setCustomOpen] = useState(false);
 const [steamPath, setSteamPath] = useState('');
 const [xboxPath, setXboxPath] = useState('');
 const [direction, setDirection] = useState<'xbox_to_steam' | 'steam_to_xbox'>('xbox_to_steam');
 const [busy, setBusy] = useState(false);

 // === Same-side copy: arbitrary target folder chosen by the user, source is
 // whatever they picked above. Works for all four cases: xbox->xbox,
 // steam->steam, xbox->steam, steam->xbox. ===
 const [copyTargetPath, setCopyTargetPath] = useState('');
 const [copyTargetSide, setCopyTargetSide] = useState<'xbox' | 'steam' | 'auto'>('auto');
 const [copyBusy, setCopyBusy] = useState(false);

 const [steamMatch, setSteamMatch] = useState<IdentifyResult | null>(null);
 const [xboxMatch, setXboxMatch] = useState<IdentifyResult | null>(null);
 const [identifying, setIdentifying] = useState<'steam' | 'xbox' | null>(null);

 const sourceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
 const steamTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
 const xboxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

 // Debounced auto-identify of the picked source path + counterpart resolution.
 useEffect(() => {
 if (sourceTimer.current) clearTimeout(sourceTimer.current);
 if (sourcePath.trim()) {
 setSourceResult(null);
 setCounterpart(null);
 sourceTimer.current = setTimeout(async () => {
 setProbingSource(true);
 try {
 const match = await identifySave(sourcePath.trim());
 setSourceResult(match);
 const gid = match?.matches?.[0]?.id;
 if (gid) {
 const cp = await resolveCounterpart(gid);
 if (cp?.found) {
 setCounterpart(cp);
 onAddLog(`已识别《${cp.name}》并解析双端路径`, 'success');
 }
 }
 } catch (err: any) {
 setSourceResult({ error: err.message });
 } finally {
 setProbingSource(false);
 }
 }, 500);
 } else {
 setSourceResult(null);
 setCounterpart(null);
 }
 return () => { if (sourceTimer.current) clearTimeout(sourceTimer.current); };
 }, [sourcePath]);

 // Debounced identify for the custom-mode dual inputs (kept from the old panel).
 useEffect(() => {
 if (steamTimer.current) clearTimeout(steamTimer.current);
 if (steamPath.trim()) {
 setSteamMatch(null);
 steamTimer.current = setTimeout(async () => {
 setIdentifying('steam');
 try {
 const match = await identifySave(steamPath.trim());
 setSteamMatch(match);
 const gid = match?.matches?.[0]?.id;
 if (gid && !xboxPath.trim()) {
 const cp = await resolveCounterpart(gid);
 if (cp?.xboxWgsPath) {
 setXboxPath(cp.xboxWgsPath);
 onAddLog(`已自动补全对面 Xbox 路径：${cp.xboxWgsPath}`, 'success');
 }
 }
 } catch (err: any) {
 setSteamMatch({ error: err.message });
 } finally {
 setIdentifying(null);
 }
 }, 500);
 } else {
 setSteamMatch(null);
 }
 return () => { if (steamTimer.current) clearTimeout(steamTimer.current); };
 }, [steamPath]);

 useEffect(() => {
 if (xboxTimer.current) clearTimeout(xboxTimer.current);
 if (xboxPath.trim()) {
 setXboxMatch(null);
 xboxTimer.current = setTimeout(async () => {
 setIdentifying('xbox');
 try {
 const match = await identifySave(xboxPath.trim());
 setXboxMatch(match);
 const gid = match?.matches?.[0]?.id;
 if (gid && !steamPath.trim()) {
 const cp = await resolveCounterpart(gid);
 if (cp?.steamSavePath) {
 setSteamPath(cp.steamSavePath);
 onAddLog(`已自动补全对面 Steam 路径：${cp.steamSavePath}`, 'success');
 }
 }
 } catch (err: any) {
 setXboxMatch({ error: err.message });
 } finally {
 setIdentifying(null);
 }
 }, 500);
 } else {
 setXboxMatch(null);
 }
 return () => { if (xboxTimer.current) clearTimeout(xboxTimer.current); };
 }, [xboxPath]);

 const handlePick = async (setter: (v: string) => void) => {
 try {
 const path = await pickFolder();
 if (path) setter(path);
 } catch (err: any) {
 toast(`无法打开文件夹选择器: ${err.message}`, 'error');
 }
 };

 const handlePickFile = async (setter: (v: string) => void) => {
 try {
 const path = await pickFile();
 if (path) setter(path);
 } catch (err: any) {
 toast(`无法打开文件选择器: ${err.message}`, 'error');
 }
 };

 // The picked folder identifies the GAME and its format class; the migration
 // direction is then chosen explicitly by the user against whichever ends
 // actually exist on this PC. The picked folder is used as the source when it
 // happens to be the source side for the chosen direction.
 const topMatch = sourceResult?.matches && sourceResult.matches.length > 0 ? sourceResult.matches[0] : null;
 const sourceSide = sourceResult?.side;

 // Effective source path per direction (picked folder wins when it is that side).
 const xboxSourcePath = sourceSide === 'xbox' ? sourcePath.trim() : (counterpart?.xboxWgsPath || null);
 const steamSourcePath = sourceSide === 'steam' ? sourcePath.trim() : (counterpart?.steamSavePath || null);

 // A direction is runnable only when its source exists AND the target path is known.
 const canXboxToSteam = Boolean(xboxSourcePath && counterpart?.steamSavePath);
 const canSteamToXbox = Boolean(steamSourcePath && counterpart?.xboxWgsPath);

 // Server-side hard gates, mirrored here so the buttons say no immediately:
 // conversion-required games (Palworld) can't transfer either direction;
 // byte-incompatible games only block Steam→Xbox writing.
 const conversionBlocked = Boolean((topMatch as any)?.needsConversionTool);
 const steamToXboxBlocked = conversionBlocked || Boolean((topMatch as any)?.steamXboxByteIncompatible);
 const runnableXboxToSteam = canXboxToSteam && !conversionBlocked;
 const runnableSteamToXbox = canSteamToXbox && !steamToXboxBlocked;

 // Recommend the direction that carries the newer save.
 const sTime = counterpart?.steamLastModified ? new Date(counterpart.steamLastModified).getTime() : 0;
 const xTime = counterpart?.xboxLastModified ? new Date(counterpart.xboxLastModified).getTime() : 0;
 let recommended: 'xbox_to_steam' | 'steam_to_xbox' | null = null;
 if (xTime > 0 && xTime > sTime + 5000) recommended = 'xbox_to_steam';
 else if (sTime > 0 && sTime > xTime + 5000) recommended = 'steam_to_xbox';
 // Never recommend (or badge) a direction that can't actually run.
 if (recommended === 'xbox_to_steam' && !runnableXboxToSteam) recommended = null;
 if (recommended === 'steam_to_xbox' && !runnableSteamToXbox) recommended = null;

 const handleOneClickMigrate = async (chosen: 'xbox_to_steam' | 'steam_to_xbox') => {
 if (!sourcePath.trim()) {
 toast('请先选择存档文件夹或文件！', 'warning');
 return;
 }
 if (chosen === 'xbox_to_steam' && !canXboxToSteam) {
 toast('无法执行 Xbox → Steam：未找到 Xbox 端存档，或未能定位 Steam 存档目录。请用「自定义移植」手动指定路径。', 'warning');
 return;
 }
 if (chosen === 'steam_to_xbox' && !canSteamToXbox) {
 toast('无法执行 Steam → Xbox：未找到 Steam 端存档，或未能定位 Xbox WGS 目录。请用「自定义移植」手动指定路径。', 'warning');
 return;
 }
 // Known-unsafe games: refuse inline before anything is written (the server
 // gates these too). Byte-incompatible (black-screen repro) blocks only
 // Steam→Xbox; conversion-required (Palworld) blocks both directions.
 const topAny = topMatch as any;
 if (chosen === 'steam_to_xbox' && topAny?.steamXboxByteIncompatible) {
 toast(`《${topMatch!.name}》经实测两端存档字节不兼容（移植后游戏启动黑屏），已阻止写入以保护 Xbox 存档。`, 'error');
 onAddLog(`[已拦截] 《${topMatch!.name}》Steam→Xbox 字节格式不兼容（实测移植后黑屏），未写入任何文件。`, 'error');
 return;
 }
 if (topAny?.needsConversionTool) {
 const tool = typeof topAny.needsConversionTool === 'string' ? topAny.needsConversionTool : '专用转换工具';
 toast(`《${topMatch!.name}》两端存档字节布局不同，需先用 ${tool} 等外部工具转换，暂不支持直接移植。`, 'error');
 onAddLog(`[已拦截] 《${topMatch!.name}》需经 ${tool} 转换格式，未写入任何文件。`, 'error');
 return;
 }

 const dirText = chosen === 'xbox_to_steam' ? 'Xbox ➔ Steam' : 'Steam ➔ Xbox';
 const confirmed = await onConfirmMigrate({ dirText, gameName: topMatch?.name, direction: chosen });
 if (!confirmed) return;

 setOneClickBusy(true);
 onMigratingChange(true);
 onAddLog(`[识别移植] ${topMatch ? `《${topMatch.name}》` : '未识别游戏'} ${dirText} 开始执行...`, 'info');
 try {
 const res = await identifyAndMigrate({ sourcePath: sourcePath.trim(), direction: chosen });
 if (res.backup) {
 onAddLog(`[安全备份] 已自动生成 Zip 压缩归档: ${res.backup.backupFileName}`, 'success');
 }

 // Grade by the audit report, not by the HTTP success flag.
 const outcome = migrationOutcome(res.verify, res.identified);
 if (outcome === 'success') {
 onAddLog(`[移植成功] ${res.message}`, 'success');
 toast(outcomeText(outcome, topMatch?.name, res.verify), 'success');
 } else if (outcome === 'needs-review') {
 onAddLog(`[移植完成·需确认] ${res.message}`, 'warning');
 toast(outcomeText(outcome, topMatch?.name, res.verify), 'warning');
      } else {
        onAddLog(`[移植校验失败] ${res.message}`, 'error');
        toast(outcomeText(outcome, topMatch?.name, res.verify), 'error');
        onFailure?.({ verify: res.verify, message: res.message, direction: chosen, gameName: topMatch?.name ?? null });
      }

      // Audit report — same transparency as the main migration path.
      logVerifyReport(res.verify, onAddLog);

 if (res.warnings && res.warnings.length > 0) {
 res.warnings.forEach((w: string) => {
 onAddLog(`[安全提醒] ${w}`, 'warning');
 toast(w, 'warning');
 });
 }
 onMigrated();
 } catch (err: any) {
 onAddLog(`[移植失败] ${err.message}`, 'error');
 toast(`移植失败: ${err.message}`, 'error');
 } finally {
 setOneClickBusy(false);
 onMigratingChange(false);
 }
 };

 /** Side-agnostic copy: same-side (xbox->xbox, steam->steam) and arbitrary
 * 异端. Source is whatever the user picked above; target comes from the
 * copy-target field. */
 const handleCopyToTarget = async (forcedTargetSide?: 'xbox' | 'steam') => {
 const src = sourcePath.trim();
 const dst = copyTargetPath.trim();
 if (!src) { toast('请先选择源存档文件夹！', 'warning'); return; }
 if (!dst) { toast('请填写目标存档目录！', 'warning'); return; }
 if (src === dst) { toast('源目录与目标目录相同，没有意义。', 'warning'); return; }
 const sourceSide = (sourceResult?.side === 'xbox' || sourceResult?.side === 'steam') ? sourceResult.side : null;
 if (!sourceSide) { toast('未能识别源存档所属端，请先选择可识别的存档文件夹。', 'warning'); return; }
 const targetSide = forcedTargetSide
 || (copyTargetSide === 'auto'
 ? (/[\\/]systemappdata[\\/]wgs([\\/]|$)/i.test(dst) || /[\\/]packages[\\/][^\\/]+[\\/]/i.test(dst) || /containers\.index$/i.test(dst) ? 'xbox' : 'steam')
 : copyTargetSide);
 if (sourceSide === targetSide) {
 const ok = window.confirm(
 `即将进行${sourceSide === 'xbox' ? 'Xbox → Xbox' : 'Steam → Steam'} 同端复制。\n源：${src}\n目标：${dst}\n\n` +
 '工具会自动备份目标目录（若已存在）。同端复制常用于多账号切换、WGS 实例迁移、跨机恢复。是否继续？'
 );
 if (!ok) return;
 }
 setCopyBusy(true);
 onMigratingChange(true);
 const dirText = `${sourceSide === 'xbox' ? 'Xbox' : 'Steam'} ➔ ${targetSide === 'xbox' ? 'Xbox' : 'Steam'}`;
 onAddLog(`[任意目标移植] 源${sourceSide} → 目标${targetSide}：${src} → ${dst}`, 'info');
 try {
 const res = await copySave({ sourcePath: src, sourceSide, targetPath: dst, targetSide });
 if (res.backup) onAddLog(`[安全备份] 已自动生成 Zip 压缩归档: ${res.backup.backupFileName}`, 'success');
 const outcome = migrationOutcome(res.verify, null);
 if (outcome === 'success') { onAddLog(`[移植成功] ${res.message}`, 'success'); toast(outcomeText(outcome, topMatch?.name, res.verify), 'success'); }
 else if (outcome === 'needs-review') { onAddLog(`[移植完成·需确认] ${res.message}`, 'warning'); toast(outcomeText(outcome, topMatch?.name, res.verify), 'warning'); }
      else { onAddLog(`[移植校验失败] ${res.message}`, 'error'); toast(outcomeText(outcome, topMatch?.name, res.verify), 'error'); onFailure?.({ verify: res.verify, message: res.message, direction: `${sourceSide}_to_${targetSide}`, gameName: topMatch?.name ?? null }); }
 logVerifyReport(res.verify, onAddLog);
 if (res.warnings && res.warnings.length > 0) {
 res.warnings.forEach((w: string) => { onAddLog(`[安全提醒] ${w}`, 'warning'); toast(w, 'warning'); });
 }
 onMigrated();
    } catch (err: any) {
      onAddLog(`[移植失败] ${err.message}`, 'error');
      toast(`移植失败: ${err.message}`, 'error');
      onFailure?.({ error: err, direction: `${sourceSide}_to_${targetSide}`, code: (err as any)?.code ?? null, gameName: topMatch?.name ?? null });
    } finally {
      setCopyBusy(false);
      onMigratingChange(false);
    }
  };

 // Toggle custom mode; pre-fill the dual inputs from the resolved counterpart.
 const toggleCustom = () => {
 if (!customOpen && counterpart) {
 if (!steamPath.trim() && counterpart.steamSavePath) setSteamPath(counterpart.steamSavePath);
 if (!xboxPath.trim() && counterpart.xboxWgsPath) setXboxPath(counterpart.xboxWgsPath);
 // Seed the custom-mode direction with whichever end holds the newer save.
 if (recommended) setDirection(recommended);
 }
 setCustomOpen(!customOpen);
 };

 const handleMigrate = async () => {
 if (!steamPath || !xboxPath) {
 toast('请先选择 Steam 存档目录和 Xbox WGS 目录！', 'warning');
 return;
 }
 const dirText = direction === 'xbox_to_steam' ? 'Xbox ➔ Steam' : 'Steam ➔ Xbox';

 const confirmed = await onConfirmMigrate({ dirText, direction });
 if (!confirmed) return;

 setBusy(true);
 onMigratingChange(true);
 onAddLog(`[自定义移植] 开始执行 ${dirText}...`, 'info');
 try {
 const res = await manualMigrateSave({ steamPath, xboxPath, direction });
 if (res.backup) {
 onAddLog(`[安全备份] 已自动生成 Zip 压缩归档: ${res.backup.backupFileName}`, 'success');
 }
 // Grade by the audit report — manual migration now carries a verify too.
 const outcome = migrationOutcome(res.verify, null);
 if (outcome === 'success') {
 onAddLog(`[移植成功] ${res.message}`, 'success');
 toast(outcomeText(outcome, null, res.verify), 'success');
 } else if (outcome === 'needs-review') {
 onAddLog(`[移植完成·需确认] ${res.message}`, 'warning');
 toast(outcomeText(outcome, null, res.verify), 'warning');
      } else {
        onAddLog(`[移植校验失败] ${res.message}`, 'error');
        toast(outcomeText(outcome, null, res.verify), 'error');
        onFailure?.({ verify: res.verify, message: res.message, direction, gameName: topMatch?.name ?? null });
      }
 logVerifyReport(res.verify, onAddLog);
 if (res.warnings && res.warnings.length > 0) {
 res.warnings.forEach((w: string) => {
 onAddLog(`[安全提醒] ${w}`, 'warning');
 toast(w, 'warning');
 });
 }
 onMigrated();
    } catch (err: any) {
      onAddLog(`[移植失败] ${err.message}`, 'error');
      toast(`移植失败: ${err.message}`, 'error');
      onFailure?.({ error: err, direction, code: (err as any)?.code ?? null, gameName: topMatch?.name ?? null });
    } finally {
      setBusy(false);
      onMigratingChange(false);
    }
  };

 const IdentifyCard = ({ label, result, probing }: {
 label: string;
 result: IdentifyResult | null;
 probing: boolean;
 }) => {
 const match = result?.matches && result.matches.length > 0 ? result.matches[0] : null;
 return (
 <div className={`rounded-btn px-3 py-2 border text-[11px] leading-relaxed ${
 probing
 ? 'border-ink-border bg-ink-elevated text-ink-muted'
 : match
 ? 'border-ink-border bg-ink-surface text-ink-text'
 : 'border-ink-borderSoft text-ink-muted'
 }`}>
 {probing ? (
 <span className="flex items-center gap-1.5">
 <Search className="w-3 h-3 animate-spin" />
 正在自动识别 {label} 对应的游戏...
 </span>
 ) : result?.error ? (
 <span className="flex items-center gap-1.5 text-ink-danger">
 <Sparkles className="w-3 h-3" />
 {label}识别失败: {result.error}
 </span>
 ) : match ? (
 <div className="space-y-1">
 <div className="flex items-center gap-2 flex-wrap">
 <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium border ${CONFIDENCE_STYLE[match.confidence]}`}>
 {CONFIDENCE_LABEL[match.confidence]}
 </span>
 <span className="font-semibold text-ink-text">{match.name}</span>
 {result && result.side && (
 <span className="text-[11px] px-1.5 py-0.5 rounded bg-ink-elevated text-ink-muted border border-ink-border">
 {result.side === 'xbox' ? 'Xbox 端' : result.side === 'steam' ? 'Steam 端' : '未判定'}
 </span>
 )}
 </div>
 <div className="text-ink-muted">
 命中线索：{match.matchTypes.map(t => MATCH_TYPE_LABEL[t] || t).join('、')}
 </div>
 {(match.steamAppId || match.xboxPackageName) && (
 <div className="text-[12px] text-ink-faint font-mono truncate">
 {match.steamAppId && <span>Steam AppID {match.steamAppId}</span>}
 {match.steamAppId && match.xboxPackageName && <span> · </span>}
 {match.xboxPackageName && <span>{match.xboxPackageName}</span>}
 </div>
 )}
 <div className="text-ink-faint truncate" title={match.evidenceSummary || match.evidence.join('；')}>
 {match.evidenceSummary || match.evidence[0]}
 </div>
 </div>
 ) : (
 <div className="space-y-0.5">
 <span className="flex items-center gap-1.5">
 <Sparkles className="w-3 h-3" />
 未匹配到已知游戏，仍可直接移植（将按原始文件名处理）
 </span>
 {result && result.formatHint && (
 <span className="block text-ink-faint text-[11px] pl-5">
 检测到文件格式：{result.formatDetected || result.formatHint}
 </span>
 )}
 </div>
 )}
 </div>
 );
 };

 const PathInput = ({ label, value, setter, placeholder, result, probing }: {
 label: string;
 value: string;
 setter: (v: string) => void;
 placeholder: string;
 result: IdentifyResult | null;
 probing: boolean;
 }) => (
 <div className="space-y-1.5">
 <label className="text-[12px] font-medium text-ink-muted">{label}</label>
 <div className="flex gap-2">
 <input
 type="text"
 value={value}
 onChange={e => setter(e.target.value)}
 placeholder={placeholder}
 className="flex-1 min-w-0 bg-ink-base border border-ink-border rounded-btn px-3 py-2.5 font-mono text-[12px] text-ink-text hover:border-ink-faint focus:outline-none focus:border-ink-accent focus:shadow-[0_0_0_2px_var(--ink-accent-soft)] placeholder:text-ink-faint transition-colors"
 />
 <div className="flex gap-1.5 shrink-0">
 <button
 onClick={() => handlePickFile(setter)}
 disabled={isMigrating || busy || oneClickBusy}
 title="选择单个存档文件（自动识别所属游戏）"
 className="px-3 py-2 text-[12px] font-medium rounded-btn bg-ink-surface hover:bg-ink-elevated text-ink-muted border border-ink-border transition-colors flex items-center gap-1 disabled:opacity-50"
 >
 <FileText className="w-3.5 h-3.5" />
 <span>选文件</span>
 </button>
 <button
 onClick={() => handlePick(setter)}
 disabled={isMigrating || busy || oneClickBusy}
 title="选择整个存档目录"
 className="px-3 py-2 text-[12px] font-medium rounded-btn bg-ink-surface hover:bg-ink-elevated text-ink-muted border border-ink-border transition-colors flex items-center gap-1 disabled:opacity-50"
 >
 <Folder className="w-3.5 h-3.5" />
 <span>浏览目录</span>
 </button>
 </div>
 </div>
 {value.trim() && (
 <IdentifyCard label="该路径" result={result} probing={probing} />
 )}
 </div>
 );

 const dirText = direction === 'xbox_to_steam' ? 'Xbox ➔ Steam' : 'Steam ➔ Xbox';
 const busyAny = busy || oneClickBusy || isMigrating;

 return (
 <div className="panel p-5">
 <div className="space-y-5">
 {/* Heading */}
        <div>
          <h2 className="t-subtitle">识别存档</h2>
          <p className="t-meta mt-0.5">
            选择存档文件夹，自动识别游戏与格式，再由你选择移植方向
          </p>
        </div>

 {/* Step 1: pick ONE source path — the primary action */}
 <div className="space-y-2">
 <label className="text-[12px] font-medium text-ink-muted flex items-center gap-1.5">
 <span className="w-4 h-4 rounded-full bg-ink-active text-ink-muted flex items-center justify-center text-[11px] font-semibold border border-ink-borderSoft">1</span>
 选择存档文件夹（或单个存档文件）
 </label>
 <div className="flex gap-2">
 <input
 type="text"
 value={sourcePath}
 onChange={e => setSourcePath(e.target.value)}
 placeholder="粘贴路径，或点击右侧按钮选择 Steam 存档目录 / Xbox WGS 目录"
 className="flex-1 min-w-0 bg-ink-base border border-ink-border rounded-btn px-3 py-2.5 font-mono text-[12px] text-ink-text hover:border-ink-faint focus:outline-none focus:border-ink-accent focus:shadow-[0_0_0_2px_var(--ink-accent-soft)] placeholder:text-ink-faint transition-colors"
 />
 <button
 onClick={() => handlePickFile(setSourcePath)}
 disabled={busyAny}
 title="选择单个存档文件（自动识别所属游戏）"
 className="px-3 py-2.5 text-[13px] btn-ghost flex items-center gap-1 disabled:opacity-50"
 >
 <FileText className="w-4 h-4" />
 <span>选文件</span>
 </button>
 <button
 onClick={() => handlePick(setSourcePath)}
 disabled={busyAny}
 className="px-4 py-2.5 text-[13px] btn-primary flex items-center gap-1.5 disabled:opacity-50"
 >
 <Folder className="w-4 h-4" />
 <span>选择存档文件夹</span>
 </button>
 </div>

 {/* Identification result: format class first, then the game */}
 {sourcePath.trim() && (
 <div className="space-y-2">
 {!probingSource && sourceResult && !sourceResult.error && (
 <div className="rounded-[5px] px-3 py-2 border border-ink-borderSoft bg-ink-elevated text-[12px] flex items-center gap-2 flex-wrap">
 <span className="text-ink-muted">存档格式：</span>
 <span className="px-1.5 py-0.5 rounded border border-ink-border bg-ink-surface text-ink-text font-semibold">
 {SIDE_FORMAT_LABEL[sourceResult.side || 'unknown']}
 </span>
 {sourceResult.formatDetected && (
 <span className="px-1.5 py-0.5 rounded border border-ink-border bg-ink-surface text-ink-muted">
 {sourceResult.formatDetected}
 </span>
 )}
 </div>
 )}
 <IdentifyCard label="该存档" result={sourceResult} probing={probingSource} />
 </div>
 )}
 </div>

 {/* Step 2: local dual-end saves + explicit direction choice */}
 {counterpart && (
 <div className="space-y-2">
 <label className="text-[12px] font-medium text-ink-muted flex items-center gap-1.5">
 <span className="w-4 h-4 rounded-full bg-ink-active text-ink-muted flex items-center justify-center text-[11px] font-semibold border border-ink-borderSoft">2</span>
 本机已有的双端存档 —— 选择要移植到哪一端
 </label>

 <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
 {/* Steam side */}
 <div className={`rounded-[5px] px-3 py-2.5 border text-[12px] space-y-1 ${
 counterpart.steamExists ? 'border-ink-border bg-ink-surface' : 'border-ink-borderSoft bg-ink-elevated/50'
 }`}>
 <div className="flex items-center gap-2">
 <span className={`w-1.5 h-1.5 rounded-full ${counterpart.steamExists ? 'bg-ink-success' : 'bg-ink-raised'}`} />
 <span className={`font-semibold ${counterpart.steamExists ? 'text-ink-text' : 'text-ink-muted'}`}>Steam 端</span>
 {recommended === 'xbox_to_steam' && counterpart.steamExists && (
 <span className="px-1.5 py-0.5 rounded text-[11px] border border-ink-border bg-ink-elevated text-ink-muted">较旧</span>
 )}
 {recommended === 'steam_to_xbox' && (
 <span className="px-1.5 py-0.5 rounded text-[11px] text-ink-accent">较新</span>
 )}
 </div>
 <div className={`font-mono truncate ${counterpart.steamExists ? 'text-ink-muted' : 'text-ink-faint'}`} title={counterpart.steamSavePath || ''}>
 {counterpart.steamSavePath || '未找到（可用「自定义移植」手动指定）'}
 </div>
 {counterpart.steamExists && (
 <div className="text-ink-faint font-mono">
 {counterpart.steamFileCount || 0} 个文件 · {formatBytes(counterpart.steamSize)} · {formatDate(counterpart.steamLastModified)}
 </div>
 )}
 </div>

 {/* Xbox side */}
 <div className={`rounded-[5px] px-3 py-2.5 border text-[12px] space-y-1 ${
 counterpart.xboxExists ? 'border-ink-border bg-ink-surface' : 'border-ink-borderSoft bg-ink-elevated/50'
 }`}>
 <div className="flex items-center gap-2">
 <span className={`w-1.5 h-1.5 rounded-full ${counterpart.xboxExists ? 'bg-ink-success' : 'bg-ink-raised'}`} />
 <span className={`font-semibold ${counterpart.xboxExists ? 'text-ink-text' : 'text-ink-muted'}`}>Xbox 端</span>
 {recommended === 'xbox_to_steam' && (
 <span className="px-1.5 py-0.5 rounded text-[11px] text-ink-accent">较新</span>
 )}
 {recommended === 'steam_to_xbox' && counterpart.xboxExists && (
 <span className="px-1.5 py-0.5 rounded text-[11px] border border-ink-border bg-ink-elevated text-ink-muted">较旧</span>
 )}
 </div>
 <div className={`font-mono truncate ${counterpart.xboxExists ? 'text-ink-muted' : 'text-ink-faint'}`} title={counterpart.xboxWgsPath || ''}>
 {counterpart.xboxWgsPath || '未找到（可用「自定义移植」手动指定）'}
 </div>
 {counterpart.xboxExists && (
 <div className="text-ink-faint font-mono">
 {counterpart.xboxFileCount || 0} 个文件 · {formatBytes(counterpart.xboxSize)} · {formatDate(counterpart.xboxLastModified)}
 </div>
 )}
 </div>
 </div>

 {/* Per-game migration warnings, before the user commits a direction */}
 {topMatch && ((topMatch as any).steamXboxByteIncompatible || (topMatch as any).needsConversionTool || (topMatch as any).accountBound) && (
 <div className="space-y-1 rounded-btn border border-ink-border px-3 py-2 text-[11px] leading-relaxed text-ink-muted">
 {(topMatch as any).needsConversionTool && (
 <div>⛔ 两端存档字节布局不同，需先用 {typeof (topMatch as any).needsConversionTool === 'string' ? (topMatch as any).needsConversionTool : '专用工具'} 等外部工具转换，暂不支持直接移植。</div>
 )}
 {(topMatch as any).steamXboxByteIncompatible && (
 <div>⛔ 实测两端存档字节不兼容（移植后黑屏），Steam→Xbox 写入会被拦截。</div>
 )}
 {(topMatch as any).accountBound && (
 <div>🔑 在线服务类，存档与账号绑定：只移植你自己账号的存档，使用他人存档可能无法读档甚至有封号风险。</div>
 )}
 </div>
 )}

 {/* Explicit direction buttons — user picks the target end */}
 <div className="flex flex-col md:flex-row items-stretch gap-2">
 <button
 onClick={() => handleOneClickMigrate('xbox_to_steam')}
 disabled={busyAny || !runnableXboxToSteam}
 title={runnableXboxToSteam
 ? '把 Xbox 端存档移植到 Steam'
 : '需要 Xbox 端存在存档、能定位 Steam 存档目录，且该游戏支持直接移植'}
 className={`flex-1 px-4 py-2.5 text-[13px] font-medium rounded-btn border transition-colors disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center gap-2 ${
 recommended === 'xbox_to_steam'
 ? 'bg-ink-success-soft border-[color:var(--ink-success-border)] text-ink-success font-semibold'
 : 'bg-ink-base hover:bg-ink-hover text-ink-text border-ink-border'
 }`}
 >
 {oneClickBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ArrowLeft className="w-4 h-4" />}
 移植到 Steam 端
 <span className="text-[12px] opacity-60">（Xbox → Steam）</span>
 {recommended === 'xbox_to_steam' && <span className="badge bg-ink-success-soft text-ink-success">推荐</span>}
 </button>

 <button
 onClick={() => handleOneClickMigrate('steam_to_xbox')}
 disabled={busyAny || !runnableSteamToXbox}
 title={runnableSteamToXbox
 ? '把 Steam 端存档移植到 Xbox'
 : '需要 Steam 端存在存档、能定位 Xbox WGS 目录，且该游戏支持直接移植'}
 className={`flex-1 px-4 py-2.5 text-[13px] font-medium rounded-btn border transition-colors disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center gap-2 ${
 recommended === 'steam_to_xbox'
 ? 'bg-ink-accent-soft border-[color:var(--ink-accent-border)] text-ink-accent font-semibold'
 : 'bg-ink-base hover:bg-ink-hover text-ink-text border-ink-border'
 }`}
 >
 {oneClickBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
 移植到 Xbox 端
 <span className="text-[12px] opacity-60">（Steam → Xbox）</span>
 {recommended === 'steam_to_xbox' && <span className="badge bg-ink-accent-soft text-ink-accent">推荐</span>}
 </button>

 {onPreviewGame && topMatch && (
 <button
 onClick={() => onPreviewGame(topMatch.id)}
 disabled={busyAny}
 title="移植测试（预演）：不写任何文件，预测两端移植时字节会落到哪些槽位"
 className="md:flex-none px-3 py-2.5 text-[13px] font-medium rounded-btn btn-ghost transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
 >
 <FlaskConical className="w-3.5 h-3.5" />
 预演
 </button>
 )}
 </div>

 {/* Same-side / arbitrary-target copy. Source is whatever the user
 picked above; target is freely chosen. Covers xbox->xbox and
 steam->steam (multi-account / multi-instance / cross-machine
 restore) and any user-chosen异端 path. */}
 <div className="space-y-2 rounded-btn border border-ink-border bg-ink-elevated p-3">
 <div className="text-[13px] text-ink-muted flex items-center gap-1.5">
 <ArrowRightLeft className="w-3 h-3" />
 <span>同端复制 / 移植到任意目录（多账号、WGS 实例迁移、跨机恢复）</span>
 </div>
 <div className="flex flex-col md:flex-row gap-2">
 <input
 type="text"
 value={copyTargetPath}
 onChange={e => setCopyTargetPath(e.target.value)}
 placeholder="目标存档目录（任意端、可与源同端）"
 className="flex-1 bg-ink-base border border-ink-border rounded-btn px-3 py-2 font-mono text-[12px] text-ink-text hover:border-ink-faint focus:outline-none focus:border-ink-accent focus:shadow-[0_0_0_2px_var(--ink-accent-soft)] placeholder:text-ink-faint transition-colors"
 />
 <button
 onClick={() => handlePick(setCopyTargetPath)}
 disabled={busyAny}
 className="px-3 py-2 text-[12px] font-medium rounded-btn bg-ink-surface hover:bg-ink-elevated text-ink-muted border border-ink-border transition-colors flex items-center gap-1 disabled:opacity-50"
 >
 <Folder className="w-3.5 h-3.5" />
 浏览
 </button>
 <select
 value={copyTargetSide}
 onChange={e => setCopyTargetSide(e.target.value as any)}
 className="bg-ink-surface border border-ink-border text-ink-text text-[12px] rounded-btn px-2 py-2"
 title="目标类型：auto=按路径自动判断"
 >
 <option value="auto">自动判断</option>
 <option value="xbox">Xbox 端</option>
 <option value="steam">Steam 端</option>
 </select>
 </div>
 <div className="flex flex-col md:flex-row gap-2">
 <button
 onClick={() => handleCopyToTarget('xbox')}
 disabled={busyAny || !sourcePath.trim() || !copyTargetPath.trim() || !sourceResult || sourceResult.side !== 'xbox'}
 title={!sourcePath.trim()
 ? '请先选择源存档文件夹'
 : sourceResult?.side !== 'xbox'
 ? '当前源不是 Xbox 端，请用 Xbox WGS 目录作为源'
 : !copyTargetPath.trim()
 ? '请填写目标目录'
 : '从源 Xbox WGS 复制到指定 Xbox WGS（同端复制）'}
 className="flex-1 px-4 py-2.5 text-[12px] font-semibold rounded-btn bg-ink-surface hover:bg-ink-elevated text-ink-text border border-ink-border transition-colors disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center gap-1.5"
 >
 {copyBusy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
 复制到 Xbox 端
 </button>
 <button
 onClick={() => handleCopyToTarget('steam')}
 disabled={busyAny || !sourcePath.trim() || !copyTargetPath.trim() || !sourceResult || sourceResult.side !== 'steam'}
 title={!sourcePath.trim()
 ? '请先选择源存档文件夹'
 : sourceResult?.side !== 'steam'
 ? '当前源不是 Steam 端，请用 Steam 存档目录作为源'
 : !copyTargetPath.trim()
 ? '请填写目标目录'
 : '从源 Steam 存档目录复制到指定 Steam 目录（同端复制）'}
 className="flex-1 px-4 py-2.5 text-[12px] font-semibold rounded-btn bg-ink-surface hover:bg-ink-elevated text-ink-text border border-ink-border transition-colors disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center gap-1.5"
 >
 {copyBusy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ArrowLeft className="w-3.5 h-3.5" />}
 复制到 Steam 端
 </button>
 </div>
 {copyTargetSide !== 'auto' && (
 <div className="text-[12px] text-ink-faint">
 目标类型已显式选择为 {copyTargetSide === 'xbox' ? 'Xbox' : 'Steam'}；上方两个按钮按目标端显示。
 </div>
 )}
 </div>

 {recommended && (
 <div className="text-[12px] text-ink-faint">
 推荐依据：{recommended === 'xbox_to_steam' ? 'Xbox' : 'Steam'} 端存档修改时间较新。方向由你决定，反向移植会用较旧的档覆盖较新的档。
 </div>
 )}
 </div>
 )}

 {/* No game recognized (or no counterpart resolvable): fall back to custom mode */}
 {sourcePath.trim() && !probingSource && !counterpart && (
 <div className="rounded-btn px-3 py-2.5 border border-ink-border bg-ink-elevated text-[13px] text-ink-muted">
 {sourceResult?.error
 ? `无法识别该路径：${sourceResult.error}`
 : '未能定位该游戏在本机的双端存档路径（可能只装了一端，或不在预设库中）。请展开下方「自定义移植」手动指定 Steam 与 Xbox 两个目录。'}
 </div>
 )}

 {/* Custom mode toggle */}
 <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
 <button
 onClick={toggleCustom}
 className="px-5 py-3 text-[12px] font-medium rounded-btn bg-ink-surface hover:bg-ink-elevated text-ink-muted border border-ink-border transition-colors flex items-center justify-center gap-1.5"
 >
 <Settings2 className="w-4 h-4" />
 自定义移植（手动指定两个目录）
 {customOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
 </button>
 </div>

 {/* Custom mode: dual-path inputs + direction + execute */}
 {customOpen && (
 <div className="space-y-4 pt-4 border-t border-ink-borderSoft">
 <div className="text-[12px] text-ink-muted flex items-center gap-1.5">
 <span className="w-4 h-4 rounded-full bg-ink-active text-ink-muted flex items-center justify-center text-[11px] font-semibold border border-ink-borderSoft">3</span>
 手动指定双端路径（识别结果会自动填入，可修改）
 </div>
 <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
 <PathInput
 label="Steam 存档目录"
 value={steamPath}
 setter={setSteamPath}
 placeholder="例如 D:\Games\Steam\userdata\1483014080\1623730\remote..."
 result={steamMatch}
 probing={identifying === 'steam'}
 />
 <PathInput
 label="Xbox WGS 目录（含 containers.index）"
 value={xboxPath}
 setter={setXboxPath}
 placeholder="例如 C:\Users\...\AppData\Local\Packages\...\SystemAppData\wgs\0009000000000000_..."
 result={xboxMatch}
 probing={identifying === 'xbox'}
 />
 </div>

 <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
 <div className="flex items-center gap-0.5 p-0.5 rounded-[5px] bg-ink-elevated border border-ink-borderSoft w-full md:w-auto">
 <button
 onClick={() => setDirection('xbox_to_steam')}
 data-active={direction === 'xbox_to_steam'}
 className="px-3 py-1.5 text-[13px] rounded-[4px] transition-colors flex items-center gap-1.5 flex-1 md:flex-none text-ink-muted hover:text-ink-text data-[active=true]:bg-ink-base data-[active=true]:text-ink-text data-[active=true]:font-medium data-[active=true]:shadow-[0_1px_2px_rgba(15,15,15,0.1)]"
 >
 <ArrowLeft className="w-3.5 h-3.5" />
 Xbox ➔ Steam
 </button>
 <button
 onClick={() => setDirection('steam_to_xbox')}
 data-active={direction === 'steam_to_xbox'}
 className="px-3 py-1.5 text-[13px] rounded-[4px] transition-colors flex items-center gap-1.5 flex-1 md:flex-none text-ink-muted hover:text-ink-text data-[active=true]:bg-ink-base data-[active=true]:text-ink-text data-[active=true]:font-medium data-[active=true]:shadow-[0_1px_2px_rgba(15,15,15,0.1)]"
 >
 Steam ➔ Xbox
 <ArrowRight className="w-3.5 h-3.5" />
 </button>
 </div>

 <button
 onClick={handleMigrate}
 disabled={busyAny}
 className="flex-1 md:flex-none px-5 py-2.5 text-[13px] btn-primary disabled:opacity-50 flex items-center justify-center gap-2"
 >
 {busy ? (
 <>
 <RefreshCw className="w-4 h-4 animate-spin" />
 正在移植...
 </>
 ) : (
 <>
 开始自定义移植
 </>
 )}
 </button>
 </div>
 <div className="text-[12px] text-ink-faint">当前方向：{dirText}</div>
 </div>
 )}
 </div>
 </div>
 );
};

export default IdentifyMigratePanel;
