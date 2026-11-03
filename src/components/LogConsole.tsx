import React, { useState } from 'react';
import { LogEntry } from '../types';
import { Terminal, ChevronDown, ChevronUp, CheckCircle2, AlertTriangle, Info, XCircle, X } from 'lucide-react';

interface LogConsoleProps {
 logs: LogEntry[];
 onClear: () => void;
 onClose: () => void;
}

export const LogConsole: React.FC<LogConsoleProps> = ({ logs, onClear, onClose }) => {
 const [collapsed, setCollapsed] = useState(false);

 return (
 <div className="fixed bottom-4 right-4 z-30 w-96 max-w-[calc(100vw-2rem)] glass-panel rounded-card border border-slate-800 shadow-2xl overflow-hidden">
 
 {/* Console Bar Header */}
 <div className="px-4 py-2.5 bg-slate-950/80 border-b border-slate-800/80 flex items-center justify-between">
 <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
 <Terminal className="w-3.5 h-3.5 text-emerald-400" />
 <span>控制台实时运行日志 ({logs.length})</span>
 </div>

 <div className="flex items-center gap-1">
 <button
 onClick={onClear}
 className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors px-2 py-1 rounded hover:bg-slate-800/50"
 >
 清空
 </button>
 <button
 onClick={() => setCollapsed(!collapsed)}
 className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800/50 transition-colors"
 aria-label={collapsed ? '展开日志' : '折叠日志'}
 >
 {collapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
 </button>
 <button
 onClick={onClose}
 className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800/50 transition-colors"
 aria-label="关闭日志面板"
 >
 <X className="w-4 h-4" />
 </button>
 </div>
 </div>

 {/* Console Log Messages */}
 {!collapsed && (
 <div className="p-3 max-h-48 overflow-y-auto space-y-2 font-mono text-[11px] bg-slate-950/90">
 {logs.length === 0 ? (
 <div className="text-slate-600 text-center py-2 text-xs">准备就绪。等待操作...</div>
 ) : (
 logs.map(log => (
 <div key={log.id} className="flex items-start gap-2 leading-relaxed border-b border-slate-900/80 pb-1">
 <span className="text-slate-500 text-[10px] shrink-0">{log.timestamp}</span>
 {log.type === 'success' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />}
 {log.type === 'error' && <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />}
 {log.type === 'warning' && <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />}
 {log.type === 'info' && <Info className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />}
 
 <span className={`break-all ${
 log.type === 'success' ? 'text-emerald-300' :
 log.type === 'error' ? 'text-red-300' :
 log.type === 'warning' ? 'text-amber-300' : 'text-slate-300'
 }`}>
 {log.message}
 </span>
 </div>
 ))
 )}
 </div>
 )}

 </div>
 );
};
