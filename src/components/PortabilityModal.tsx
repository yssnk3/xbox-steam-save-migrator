import React, { useEffect, useState } from 'react';
import { GameItem, PortabilityReport } from '../types';
import { portabilityReport } from '../services/api';
import { useToast } from './Toast';
import {
 X, FlaskConical, ArrowRight, ArrowLeft, FileText, ShieldCheck, KeyRound,
 CloudOff, Loader2,
} from 'lucide-react';

interface PortabilityModalProps {
 game: GameItem | null;
 onClose: () => void;
}

const VERDICT_META: Record<string, { label: string; cls: string }> = {
 ok: { label: '可移植', cls: 'bg-emerald-500/100/10 text-emerald-400 border-emerald-500/30' },
 partial: { label: '部分不可写', cls: 'bg-amber-500/100/10 text-amber-400 border-amber-500/30' },
 'needs-launch': { label: '需先启动游戏', cls: 'bg-amber-500/100/10 text-amber-400 border-amber-500/30' },
 'no-source': { label: '未找到源存档', cls: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30' },
 empty: { label: '源为空', cls: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30' },
 refused: { label: '已拦截', cls: 'bg-red-500/10 text-red-400 border-red-500/30' },
 error: { label: '预演异常', cls: 'bg-red-500/10 text-red-400 border-red-500/30' },
 unknown: { label: '未知', cls: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20' },
};

function DirectionCard({ title, icon, report }: {
 title: string;
 icon: React.ReactNode;
 report: PortabilityReport['steamToXbox'];
}) {
 const meta = VERDICT_META[report.verdict] || VERDICT_META.unknown;
 return (
 <div className="rounded-card border border-white/[0.08] bg-ink-surface/[0.02] p-4 space-y-3">
 <div className="flex items-center gap-2">
 <span className="text-zinc-400">{icon}</span>
 <span className="font-semibold text-sm text-zinc-100">{title}</span>
 <span className={`ml-auto px-2 py-0.5 rounded border text-[11px] font-bold ${meta.cls}`}>{meta.label}</span>
 </div>

 {(report.reasons || []).map((r, i) => (
 <div key={i} className="text-[12px] leading-relaxed text-zinc-400">{r}</div>
 ))}

 {report.willWrite && report.willWrite.length > 0 && (
 <div className="space-y-1">
 <div className="text-[11px] font-semibold text-zinc-300 flex items-center gap-1">
 <ShieldCheck className="w-3.5 h-3.5" /> 将写入 {report.willWrite.length} 个槽位
 </div>
 <div className="max-h-40 overflow-auto rounded-card border border-white/[0.06] bg-black/60">
 {report.willWrite.map(w => (
 <div key={w.slot + w.source} className="px-3 py-1.5 text-[11px] font-mono text-zinc-400 border-b border-white/[0.04] last:border-0 flex items-center gap-2">
 <span className="text-zinc-200 truncate">{w.source}</span>
 <ArrowRight className="w-3 h-3 text-zinc-600 shrink-0" />
 <span className="truncate">{w.slot}</span>
 <span className="ml-auto text-zinc-600 shrink-0">{w.size}B</span>
 </div>
 ))}
 </div>
 </div>
 )}

 {report.files && report.files.length > 0 && (
 <div className="space-y-1">
 <div className="text-[11px] font-semibold text-zinc-300 flex items-center gap-1">
 <FileText className="w-3.5 h-3.5" /> 将提取 {report.files.length} 个文件
 </div>
 <div className="max-h-40 overflow-auto rounded-card border border-white/[0.06] bg-black/60">
 {report.files.map(f => (
 <div key={f.name + f.container} className="px-3 py-1.5 text-[11px] font-mono text-zinc-400 border-b border-white/[0.04] last:border-0">
 <span className="text-zinc-200">{f.name}</span>
 {f.original && f.original !== f.name && <span className="text-zinc-600"> ← {f.original}</span>}
 <span className="ml-auto text-zinc-600">{f.size}B</span>
 </div>
 ))}
 </div>
 </div>
 )}

 {report.unusedSteamFiles && report.unusedSteamFiles.length > 0 && (
 <div className="text-[11px] text-amber-400/90">
 ⚠️ 以下文件没有对应槽位，不会写入：{report.unusedSteamFiles.join('、')}
 </div>
 )}

 {report.mirrors && report.mirrors.length > 0 && (
 <div className="text-[11px] text-zinc-400 flex items-center gap-1.5">
 <CloudOff className="w-3.5 h-3.5 shrink-0" /> 云镜像将同步 {report.mirrors.length} 个：{report.mirrors.join('、')}
 </div>
 )}

 {report.skippedContainers && report.skippedContainers.length > 0 && (
 <div className="max-h-28 overflow-auto rounded-card border border-white/[0.06] bg-black/60">
 {report.skippedContainers.map(s => (
 <div key={s.container} className="px-3 py-1 text-[11px] font-mono text-zinc-500">
 ⏭️ {s.container}：{s.reason}
 </div>
 ))}
 </div>
 )}
 </div>
 );
}

export const PortabilityModal: React.FC<PortabilityModalProps> = ({ game, onClose }) => {
 const toast = useToast();
 const [report, setReport] = useState<PortabilityReport | null>(null);
 const [loading, setLoading] = useState(false);

 useEffect(() => {
 let cancelled = false;
 setReport(null);
 if (!game) return;
 setLoading(true);
 (async () => {
 try {
 const r = await portabilityReport({ gameId: game.id });
 if (!cancelled) setReport(r);
 } catch (err: any) {
 if (!cancelled) toast(`预演失败: ${err.message}`, 'error');
 } finally {
 if (!cancelled) setLoading(false);
 }
 })();
 return () => { cancelled = true; };
 }, [game?.id]);

 if (!game) return null;

 return (
 <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 " onClick={onClose}>
 <div
 className="glass-panel w-full max-w-2xl rounded-card p-5 space-y-4 max-h-[85vh] overflow-auto"
 onClick={e => e.stopPropagation()}
 >
 {/* Header */}
 <div className="flex items-center gap-3">
 <div className="p-2 rounded-card bg-ink-surface/[0.06] border border-white/[0.08] text-zinc-300">
 <FlaskConical className="w-5 h-5" />
 </div>
 <div className="flex-1">
 <h2 className="font-bold text-base text-white">移植测试（预演）</h2>
 <div className="text-xs text-zinc-500">{game.name}</div>
 </div>
 <button onClick={onClose} className="p-1.5 rounded-card hover:bg-ink-surface/[0.06] text-zinc-400 hover:text-white transition-colors">
 <X className="w-4 h-4" />
 </button>
 </div>

 {/* Flags */}
 {report?.game && (
 <div className="flex flex-wrap gap-1.5">
 {report.game.accountBound && (
 <span className="px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/100/10 text-amber-400 text-[11px] flex items-center gap-1">
 <KeyRound className="w-3 h-3" /> 账号绑定：只移植自己的存档
 </span>
 )}
 {report.game.needsConversionTool && (
 <span className="px-2 py-0.5 rounded border border-red-500/30 bg-red-500/10 text-red-400 text-[11px]">
 需外部工具转换：{report.game.needsConversionTool}
 </span>
 )}
 {report.game.identifyOnly && (
 <span className="px-2 py-0.5 rounded border border-white/[0.1] bg-ink-surface/[0.05] text-zinc-400 text-[11px]">
 识别专用类（未实测布局）
 </span>
 )}
 </div>
 )}

 {/* Body */}
 {loading && !report && (
 <div className="flex items-center justify-center py-10 text-zinc-500 text-sm gap-2">
 <Loader2 className="w-4 h-4 animate-spin" /> 正在预演（只读，不写任何文件）…
 </div>
 )}

 {report && (
 <div className="space-y-3">
 <DirectionCard
 title="Xbox ➔ Steam（提取）"
 icon={<ArrowLeft className="w-4 h-4" />}
 report={report.xboxToSteam}
 />
 <DirectionCard
 title="Steam ➔ Xbox（写入）"
 icon={<ArrowRight className="w-4 h-4" />}
 report={report.steamToXbox}
 />
 <div className="text-[11px] text-zinc-500 leading-relaxed border-l-2 border-white/[0.1] pl-3">
 预演只验证「字节会不会落进游戏真正读取的槽位」。游戏是否接受外来字节（加密、校验和、账号绑定）仍需实际进游戏读档确认一次。
 </div>
 </div>
 )}
 </div>
 </div>
 );
};

export default PortabilityModal;
