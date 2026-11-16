import React, { useState } from 'react';
import { LogEntry } from '../types';
import { Terminal, ChevronDown, ChevronUp, CheckCircle2, AlertTriangle, Info, XCircle, X } from 'lucide-react';
import { useLayout } from '../layout';
import { DragHandle } from './DragHandle';

interface LogConsoleProps {
  logs: LogEntry[];
  onClear: () => void;
  onClose: () => void;
}

/**
 * 运行日志控制台。
 *
 * 视觉上是一块固定的深色代码面（对应 Notion 的 code block），
 * 在浅色/深色主题下都保持同一套深色底 + 浅色字，避免主题翻转后对比度失效。
 */
const TONE = {
  success: '#4DAB9A',
  error: '#FF7369',
  warning: '#D9A343',
  info: '#7F9CB8',
};

export const LogConsole: React.FC<LogConsoleProps> = ({ logs, onClear, onClose }) => {
  const [collapsed, setCollapsed] = useState(false);
  const { logWidth, logHeight } = useLayout();

  return (
    <div
      className="fixed bottom-4 right-4 z-30 max-w-[calc(100vw-2rem)] rounded-[8px] overflow-hidden border border-[#2F2F2F] bg-[#1F1E1B] shadow-[rgba(15,15,15,0.1)_0_3px_6px,rgba(15,15,15,0.2)_0_9px_24px]"
      style={{ width: logWidth }}
    >
      {/* 四条边 + 四个角都能拖（浮层是真正能自由改尺寸的部件） */}
      {!collapsed && (
        <>
          <DragHandle layoutKey="logWidth" edge="left" label="拖动调整日志面板宽度" />
          <DragHandle layoutKey="logWidth" edge="right" label="拖动调整日志面板宽度" />
          <DragHandle layoutKey="logHeight" edge="top" label="拖动调整日志面板高度" />
          <DragHandle layoutKey="logHeight" edge="bottom" label="拖动调整日志面板高度" />
          <DragHandle layoutKey="logWidth" layoutKeyY="logHeight" axis="xy" edge="top-left" label="拖动调整日志面板尺寸" />
          <DragHandle layoutKey="logWidth" layoutKeyY="logHeight" axis="xy" edge="top-right" label="拖动调整日志面板尺寸" />
          <DragHandle layoutKey="logWidth" layoutKeyY="logHeight" axis="xy" edge="bottom-left" label="拖动调整日志面板尺寸" />
          <DragHandle layoutKey="logWidth" layoutKeyY="logHeight" axis="xy" edge="bottom-right" label="拖动调整日志面板尺寸" />
        </>
      )}
      {/* 标题栏 */}
      <div className="px-4 py-2.5 bg-[#252525] border-b border-[#333] flex items-center justify-between">
        <div className="flex items-center gap-2 text-[12px] font-medium text-[#D4D4D4]">
          <Terminal className="w-3.5 h-3.5" style={{ color: TONE.success }} />
          <span>运行日志 ({logs.length})</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onClear}
            className="text-[12px] text-[#9B9B9B] hover:text-[#E8E8E6] transition-colors px-2 py-1 rounded-[4px] hover:bg-white/5"
          >
            清空
          </button>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1 rounded-[4px] text-[#9B9B9B] hover:text-[#E8E8E6] hover:bg-white/5 transition-colors"
            aria-label={collapsed ? '展开日志' : '折叠日志'}
          >
            {collapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded-[4px] text-[#9B9B9B] hover:text-[#E8E8E6] hover:bg-white/5 transition-colors"
            aria-label="关闭日志面板"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 日志列表 */}
      {!collapsed && (
        <div className="p-3 overflow-y-auto space-y-2 font-mono text-[12px] bg-[#191919]" style={{ height: logHeight }}>
          {logs.length === 0 ? (
            <div className="text-[#6F6F6F] text-center py-4">暂无日志</div>
          ) : (
            logs.map(log => (
              <div
                key={log.id}
                className="flex items-start gap-2 leading-relaxed border-b border-white/[0.06] pb-1.5 last:border-0"
              >
                <span className="text-[#6F6F6F] text-[11px] shrink-0 tabular-nums">{log.timestamp}</span>
                {log.type === 'success' && (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: TONE.success }} />
                )}
                {log.type === 'error' && (
                  <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: TONE.error }} />
                )}
                {log.type === 'warning' && (
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: TONE.warning }} />
                )}
                {log.type === 'info' && (
                  <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: TONE.info }} />
                )}

                <span
                  className="break-all"
                  style={{
                    color:
                      log.type === 'success'
                        ? TONE.success
                        : log.type === 'error'
                          ? TONE.error
                          : log.type === 'warning'
                            ? TONE.warning
                            : '#D4D4D4',
                  }}
                >
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

export default LogConsole;