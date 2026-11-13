import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles,
  Loader2,
  Plus,
  Search,
  Trash2,
  Pin,
  PinOff,
  Download,
  PanelLeftClose,
  ChevronLeft,
  Pencil,
  RotateCcw,
  AlertTriangle,
} from 'lucide-react';
import { AiHistoryItem, AiSession, AiTurn, FailureContext } from '../types';
import {
  fetchAiHistory,
  fetchAiHistoryEntry,
  updateAiSession,
  deleteAiHistoryApi,
  clearAiHistoryApi,
  exportAiSession,
  explainFailureApi,
} from '../services/api';
import { AiConversation } from './AiTurnView';
import { useToast } from './Toast';

/**
 * AI 诊断面板 — 主内容区左侧的第二列。
 *
 * 折叠态是 44px 竖条（图标 + 竖排文字），展开态是可拖宽的会话列表 +
 * 对话视图。承载「浏览历史会话 / 查看 / 切换 / 重新打开 / 继续追问」。
 */

export type AiPanelWidth = 44 | number;

interface AiPanelProps {
  /** 从失败弹窗搬过来的现场（"在 AI 面板继续"） */
  pendingSession: { context: FailureContext; turns: AiTurn[]; headline: string; sessionId?: string | null } | null;
  /** 消费掉 pendingSession（面板收到后清空） */
  onPendingConsumed: () => void;
  /** 面板开合状态由父级控制 */
  expanded: boolean;
  onToggle: () => void;
  width: number;
  onWidthChange: (w: number) => void;
}

/** 会话按日期分组：今天 / 昨天 / 本周 / 更早 */
function groupByDate(items: AiHistoryItem[]): { label: string; items: AiHistoryItem[] }[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const buckets: { label: string; min: number; max: number; items: AiHistoryItem[] }[] = [
    { label: '今天', min: startOfToday, max: Infinity, items: [] },
    { label: '昨天', min: startOfToday - 86400000, max: startOfToday, items: [] },
    { label: '本周', min: startOfToday - 6 * 86400000, max: startOfToday - 86400000, items: [] },
    { label: '更早', min: -Infinity, max: startOfToday - 6 * 86400000, items: [] },
  ];
  for (const it of items) {
    const t = new Date(it.updatedAt || it.createdAt).getTime();
    const b = buckets.find(b => t >= b.min && t < b.max) || buckets[buckets.length - 1];
    b.items.push(it);
  }
  return buckets.filter(b => b.items.length > 0).map(b => ({ label: b.label, items: b.items }));
}

export const AiPanel: React.FC<AiPanelProps> = ({
  pendingSession,
  onPendingConsumed,
  expanded,
  onToggle,
  width,
  onWidthChange,
}) => {
  const toast = useToast();
  const [sessions, setSessions] = useState<AiHistoryItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [session, setSession] = useState<AiSession | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [followUp, setFollowUp] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  // 窄屏（<1280px）展开时转为覆盖层，不挤压主内容区
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1280);

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 1280);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 拉列表
  const refreshList = useCallback(async () => {
    try {
      const { history } = await fetchAiHistory();
      setSessions(history);
      return history;
    } catch (e: any) {
      toast(`读取会话列表失败：${e.message}`, 'error');
      return [];
    }
  }, [toast]);

  useEffect(() => {
    if (!expanded) return;
    void refreshList();
  }, [expanded, refreshList]);

  // 打开会话
  const openSession = useCallback(async (id: string) => {
    setActiveId(id);
    setLoading(true);
    try {
      const { entry } = await fetchAiHistoryEntry(id);
      setSession(entry);
    } catch (e: any) {
      toast(`打开会话失败：${e.message}`, 'error');
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // 从失败弹窗搬来的现场 → 续接同一会话（弹窗首轮已在服务端落盘）
  useEffect(() => {
    if (!pendingSession) return;
    const { context, headline, sessionId } = pendingSession;
    onPendingConsumed();
    (async () => {
      try {
        if (sessionId) {
          // 已有会话：直接打开，把弹窗里的轮次同步进去
          const { entry } = await fetchAiHistoryEntry(sessionId);
          setSession(entry);
          setActiveId(sessionId);
          toast(`已把「${headline}」搬到 AI 面板`, 'success');
        } else {
          // 没有会话 id（弹窗未分析）：新建一轮
          const r = await explainFailureApi(context, { messages: [] });
          toast(`已把「${headline}」搬到 AI 面板`, 'success');
          await refreshList();
          if (r.sessionId) await openSession(r.sessionId);
        }
      } catch (e: any) {
        toast(`AI 分析失败：${e.message}`, 'error');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSession]);

  // 追问
  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || !session) return;
    setAsking(true);
    try {
      const messages: { role: 'user' | 'assistant'; content: string }[] = [];
      for (const t of session.turns) {
        if (t.question) messages.push({ role: 'user', content: t.question });
        messages.push({ role: 'assistant', content: t.answer });
      }
      messages.push({ role: 'user', content: q });
      const r = await explainFailureApi(session.context, { messages, sessionId: session.id });
      const nextTurn: AiTurn = { question: q, answer: r.text, model: r.model, at: new Date().toISOString() };
      setSession({ ...session, turns: [...session.turns, nextTurn], updatedAt: new Date().toISOString() });
      setFollowUp('');
      await refreshList();
    } catch (e: any) {
      toast(`追问失败：${e.message}`, 'error');
    } finally {
      setAsking(false);
    }
  };

  // 重新诊断：清空轮次，从头再来一轮
  const reanalyze = async () => {
    if (!session) return;
    setAsking(true);
    try {
      const r = await explainFailureApi(session.context, { messages: [], sessionId: session.id });
      const turn: AiTurn = { question: null, answer: r.text, model: r.model, at: new Date().toISOString() };
      setSession({ ...session, turns: [turn], updatedAt: new Date().toISOString() });
      await refreshList();
    } catch (e: any) {
      toast(`重新分析失败：${e.message}`, 'error');
    } finally {
      setAsking(false);
    }
  };

  const rename = async (id: string, title: string) => {
    try {
      await updateAiSession(id, { title });
      await refreshList();
    } catch (e: any) {
      toast(`重命名失败：${e.message}`, 'error');
    }
  };

  const togglePin = async (item: AiHistoryItem) => {
    try {
      await updateAiSession(item.id, { pinned: !item.pinned });
      await refreshList();
    } catch (e: any) {
      toast(`操作失败：${e.message}`, 'error');
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteAiHistoryApi(id);
      if (activeId === id) { setActiveId(null); setSession(null); }
      await refreshList();
    } catch (e: any) {
      toast(`删除失败：${e.message}`, 'error');
    }
  };

  const clearAll = async () => {
    if (!window.confirm('确定清空全部 AI 诊断会话？此操作不可撤销。')) return;
    try {
      await clearAiHistoryApi();
      setActiveId(null);
      setSession(null);
      await refreshList();
      toast('已清空全部会话', 'success');
    } catch (e: any) {
      toast(`清空失败：${e.message}`, 'error');
    }
  };

  const doExport = async (id: string) => {
    try {
      const { filename, markdown } = await exportAiSession(id);
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast(`导出失败：${e.message}`, 'error');
    }
  };

  // 搜索过滤：标题 / 游戏名 / 错误码 / 回答预览
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(s =>
      [s.title, s.gameName, s.code, s.answerPreview]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(q)),
    );
  }, [sessions, query]);

  // 拖拽调宽
  const onDragStart = (e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startW: width };
    e.preventDefault();
  };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const next = Math.min(420, Math.max(200, dragRef.current.startW - (e.clientX - dragRef.current.startX)));
      onWidthChange(next);
    };
    const up = () => { dragRef.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [onWidthChange]);

  // ---------- 折叠态：44px 竖条 ----------
  if (!expanded) {
    return (
      <aside className="w-11 shrink-0 h-screen sticky top-0 bg-ink-sidebar border-r border-ink-borderSoft flex flex-col items-center py-3 gap-2">
        <button
          onClick={onToggle}
          className="w-8 h-8 rounded-btn hover:bg-ink-elevated text-ink-muted transition-colors"
          title="展开 AI 面板"
        >
          <Sparkles className="w-4 h-4" />
        </button>
        <div className="flex-1 min-h-0 flex items-start justify-center">
          <span className="text-[11px] text-ink-faint tracking-widest select-none" style={{ writingMode: 'vertical-rl' }}>
            AI 诊断
          </span>
        </div>
        {sessions.length > 0 && (
          <span className="text-[11px] text-ink-faint tabular-nums">{sessions.length}</span>
        )}
      </aside>
    );
  }

  return (
    <aside
      className={
        narrow
          ? 'fixed left-[240px] top-0 bottom-0 z-40 bg-ink-sidebar border-r border-ink-borderSoft flex flex-col shadow-card'
          : 'shrink-0 h-screen sticky top-0 bg-ink-sidebar border-r border-ink-borderSoft flex flex-col'
      }
      style={narrow ? { width: Math.min(width, 420) } : { width }}
    >
      {/* 头部 */}
      <header className="shrink-0 px-3 py-2.5 flex items-center gap-2 border-b border-ink-borderSoft">
        <Sparkles className="w-4 h-4 text-ink-muted shrink-0" />
        <span className="text-[13px] font-medium text-ink-text flex-1 truncate">AI 诊断</span>
        <button
          onClick={onToggle}
          className="p-1 rounded-btn text-ink-faint hover:text-ink-text hover:bg-ink-elevated transition-colors"
          title="收起面板"
        >
          <PanelLeftClose className="w-4 h-4" />
        </button>
      </header>

      {/* 工具条 */}
      <div className="shrink-0 px-3 py-2 space-y-2 border-b border-ink-borderSoft">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-faint pointer-events-none" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索会话"
            className="input-inset w-full pl-7 pr-2 py-1.5 text-[12px]"
          />
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setActiveId(null); setSession(null); }}
            className="btn-ghost px-2 py-1 text-[11px] flex items-center gap-1"
            title="查看新会话"
          >
            <Plus className="w-3 h-3" />
            新会话
          </button>
          <button
            onClick={clearAll}
            disabled={sessions.length === 0}
            className="btn-ghost px-2 py-1 text-[11px] flex items-center gap-1 disabled:opacity-40"
            title="清空全部会话"
          >
            <Trash2 className="w-3 h-3" />
            清空
          </button>
        </div>
      </div>

      {/* 会话列表 / 会话详情 —— 按需二选一 */}
      {!session ? (
        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
          {filtered.length === 0 ? (
            <p className="text-[11px] text-ink-faint px-2 py-6 text-center leading-relaxed">
              {query ? '没有匹配的会话' : '还没有诊断会话\n移植失败后可在弹窗里点「在 AI 面板继续」'}
            </p>
          ) : (
            groupByDate(filtered).map(group => (
              <div key={group.label} className="mb-3">
                <div className="px-2 py-1 text-[11px] text-ink-faint">{group.label}</div>
                {group.items.map(item => (
                  <div key={item.id} className="group/session">
                    {renamingId === item.id ? (
                      <div className="px-1 py-1">
                        <input
                          autoFocus
                          value={renameText}
                          onChange={e => setRenameText(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { void rename(item.id, renameText); setRenamingId(null); }
                            if (e.key === 'Escape') setRenamingId(null);
                          }}
                          onBlur={() => { void rename(item.id, renameText); setRenamingId(null); }}
                          className="input-inset w-full px-2 py-1 text-[12px]"
                        />
                      </div>
                    ) : (
                      <button
                        onClick={() => void openSession(item.id)}
                        className="w-full text-left px-2 py-1.5 rounded-btn hover:bg-ink-elevated transition-colors"
                      >
                        <div className="flex items-center gap-1.5">
                          {item.pinned && <Pin className="w-3 h-3 text-ink-warning shrink-0" />}
                          <span className="text-[12px] text-ink-text truncate flex-1">
                            {item.title || item.gameName || '未识别游戏'}
                          </span>
                          {item.turnCount > 1 && (
                            <span className="text-[10px] text-ink-faint shrink-0">{item.turnCount} 轮</span>
                          )}
                        </div>
                        <div className="text-[11px] text-ink-faint truncate mt-0.5">
                          {item.code ? `${item.code} · ` : ''}{item.answerPreview || '（无内容）'}
                        </div>
                      </button>
                    )}
                    {/* 悬停操作 */}
                    <div className="px-1 flex items-center gap-0.5 opacity-0 group-hover/session:opacity-100 transition-opacity">
                      <button
                        onClick={() => { setRenamingId(item.id); setRenameText(item.title || ''); }}
                        className="p-1 rounded text-ink-faint hover:text-ink-text hover:bg-ink-elevated"
                        title="重命名"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => void togglePin(item)}
                        className="p-1 rounded text-ink-faint hover:text-ink-text hover:bg-ink-elevated"
                        title={item.pinned ? '取消置顶' : '置顶'}
                      >
                        {item.pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                      </button>
                      <button
                        onClick={() => void doExport(item.id)}
                        className="p-1 rounded text-ink-faint hover:text-ink-text hover:bg-ink-elevated"
                        title="导出 Markdown"
                      >
                        <Download className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => void remove(item.id)}
                        className="p-1 rounded text-ink-faint hover:text-ink-danger hover:bg-ink-elevated"
                        title="删除"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col">
          {/* 会话头 */}
          <div className="shrink-0 px-3 py-2 border-b border-ink-borderSoft flex items-center gap-1.5">
            <button
              onClick={() => { setSession(null); setActiveId(null); }}
              className="p-1 rounded-btn text-ink-faint hover:text-ink-text hover:bg-ink-elevated"
              title="返回列表"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium text-ink-text truncate">
                {session.title || session.context?.gameName || '未识别游戏'}
              </div>
              <div className="text-[10px] text-ink-faint truncate">
                {session.context?.code ? `${session.context.code} · ` : ''}
                {session.turns.length} 轮 · {new Date(session.updatedAt || session.createdAt).toLocaleString('zh-CN')}
              </div>
            </div>
            <button
              onClick={() => void doExport(session.id)}
              className="p-1 rounded-btn text-ink-faint hover:text-ink-text hover:bg-ink-elevated"
              title="导出 Markdown"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => void remove(session.id)}
              className="p-1 rounded-btn text-ink-faint hover:text-ink-danger hover:bg-ink-elevated"
              title="删除会话"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* 现场信息 */}
          {(session.context?.error || session.context?.code) && (
            <div className="shrink-0 px-3 py-2 border-b border-ink-borderSoft">
              <div className="flex items-center gap-1.5 text-[11px] text-ink-warning mb-1">
                <AlertTriangle className="w-3 h-3" />
                <span>失败现场</span>
              </div>
              {session.context?.code && (
                <div className="text-[10px] font-mono text-ink-muted">{session.context.code}</div>
              )}
              {session.context?.error && (
                <div className="text-[11px] text-ink-muted leading-relaxed line-clamp-3">{session.context.error}</div>
              )}
            </div>
          )}

          {/* 对话 */}
          <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-[11px] text-ink-muted">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                加载中…
              </div>
            ) : (
              <AiConversation turns={session.turns} compact />
            )}
          </div>

          {/* 追问输入 */}
          <div className="shrink-0 px-3 py-2.5 border-t border-ink-borderSoft space-y-2">
            {asking && (
              <div className="flex items-center gap-1.5 text-[11px] text-ink-muted">
                <Loader2 className="w-3 h-3 animate-spin" />
                分析中…
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <input
                value={followUp}
                onChange={e => setFollowUp(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && followUp.trim() && !asking) void ask(followUp);
                }}
                placeholder="继续追问…"
                disabled={asking}
                className="input-inset flex-1 px-2.5 py-1.5 text-[12px] disabled:opacity-50"
              />
              <button
                onClick={() => void ask(followUp)}
                disabled={!followUp.trim() || asking}
                className="btn-primary px-2.5 py-1.5 text-[11px] shrink-0 disabled:opacity-40"
              >
                发送
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-ink-faint truncate">
                {session.turns[session.turns.length - 1]?.model || ''}
              </span>
              <button
                onClick={() => void reanalyze()}
                disabled={asking}
                className="text-[11px] text-ink-muted hover:text-ink-text transition-colors flex items-center gap-1 disabled:opacity-40"
              >
                <RotateCcw className="w-3 h-3" />
                重新诊断
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 拖拽把手 */}
      <div
        onMouseDown={onDragStart}
        className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-ink-accent/20"
        title="拖动调整宽度"
      />
    </aside>
  );
};

export default AiPanel;
