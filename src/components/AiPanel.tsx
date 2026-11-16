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
  Pencil,
  RotateCcw,
  AlertTriangle,
  MessageSquare,
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
import { useLayout } from '../layout';
import { DragHandle } from './DragHandle';

/**
 * AI 诊断页 — 侧边栏里的一个 tab，与「游戏移植」「Xbox 游戏库」同级。
 *
 * 布局：左侧会话列表（固定宽，独立滚动）+ 右侧对话区。
 * 承载「浏览历史会话 / 查看 / 切换 / 重新打开 / 继续追问」。
 */
interface AiPanelProps {
  /** 从失败弹窗搬过来的现场（"在 AI 诊断中继续"） */
  pendingSession: { context: FailureContext; turns: AiTurn[]; headline: string; sessionId?: string | null } | null;
  /** 消费掉 pendingSession（面板收到后清空） */
  onPendingConsumed: () => void;
  /** 会话总数变化时上报，供侧边栏显示角标 */
  onCountChange?: (n: number) => void;
}

/**
 * 快捷提问模板。
 *
 * 覆盖用户最高频的几类问题：怎么开始移植、为什么写不进去、怎么救回来。
 * 通用问答会话（新建）用这一组；已有失败会话的追问用 FOLLOWUP_TEMPLATES。
 */
const NEW_SESSION_TEMPLATES = [
  '怎么把 Steam 存档移植到 Xbox？',
  '为什么写不进去，提示 needs-launch？',
  '字节不兼容（幻兽帕鲁这类）该怎么办？',
  '怎么恢复上一次的备份？',
];

/** 已有失败会话的追问模板——都是「现场已知、用户想深挖」的问题。 */
const FOLLOWUP_TEMPLATES = [
  '那具体该怎么操作？',
  '这个错误怎么避免下次再犯？',
  '有没有不用重装的办法？',
];

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

/** 一个会话有没有失败现场（决定走诊断模式还是通用问答模式） */
function hasFailureContext(ctx?: FailureContext | null): boolean {
  return !!(ctx && (ctx.error || ctx.code || ctx.gameName || ctx.stage));
}

export const AiPanel: React.FC<AiPanelProps> = ({ pendingSession, onPendingConsumed, onCountChange }) => {
  const toast = useToast();
  const { aiListWidth, aiPanelHeight } = useLayout();
  const [sessions, setSessions] = useState<AiHistoryItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [session, setSession] = useState<AiSession | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [followUp, setFollowUp] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  /** 新建会话模式：没有失败现场，直接向模型提问 */
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const [cursor, setCursor] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 拉列表
  const refreshList = useCallback(async () => {
    try {
      const { history } = await fetchAiHistory();
      setSessions(history);
      onCountChange?.(history.length);
      return history;
    } catch (e: any) {
      toast(`读取会话列表失败：${e.message}`, 'error');
      return [];
    }
  }, [toast, onCountChange]);

  useEffect(() => { void refreshList(); }, [refreshList]);

  // 打开会话
  const openSession = useCallback(async (id: string) => {
    setActiveId(id);
    setComposing(false);
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
    const { headline, sessionId } = pendingSession;
    onPendingConsumed();
    (async () => {
      try {
        if (sessionId) {
          await openSession(sessionId);
          toast(`已把「${headline}」搬到 AI 诊断`, 'success');
        } else {
          const r = await explainFailureApi(pendingSession.context, { messages: [] });
          await refreshList();
          if (r.sessionId) await openSession(r.sessionId);
          toast(`已把「${headline}」搬到 AI 诊断`, 'success');
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
      // 通用问答会话没有失败现场 → 首轮问题得单独传，否则模型收不到问题
      const firstQuestion = session.turns.find(t => t.question)?.question || null;
      const r = hasFailureContext(session.context)
        ? await explainFailureApi(session.context, { messages, sessionId: session.id })
        : await explainFailureApi({}, { question: firstQuestion || q, messages, sessionId: session.id });
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
      // 通用问答会话没有失败现场 → 用首轮问题重问；失败会话 → 带现场重诊断
      const firstQuestion = session.turns.find(t => t.question)?.question || null;
      const r = hasFailureContext(session.context)
        ? await explainFailureApi(session.context, { messages: [], sessionId: session.id })
        : await explainFailureApi({}, { question: firstQuestion || '请继续', sessionId: session.id });
      const turn: AiTurn = {
        question: hasFailureContext(session.context) ? null : firstQuestion,
        answer: r.text,
        model: r.model,
        at: new Date().toISOString(),
      };
      setSession({ ...session, turns: [turn], updatedAt: new Date().toISOString() });
      await refreshList();
    } catch (e: any) {
      toast(`重新分析失败：${e.message}`, 'error');
    } finally {
      setAsking(false);
    }
  };

  // 通用问答：没有失败现场，直接向模型提问，服务端落盘为新会话
  const askNew = async (question: string) => {
    const q = question.trim();
    if (!q) return;
    setAsking(true);
    try {
      const r = await explainFailureApi({}, { question: q });
      setDraft('');
      setComposing(false);
      await refreshList();
      if (r.sessionId) await openSession(r.sessionId);
    } catch (e: any) {
      toast(`提问失败：${e.message}`, 'error');
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
      setComposing(false);
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

  // 键盘导航：↑↓ 在会话列表里移动、Enter 打开、Esc 逐层退出
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = e.target instanceof HTMLElement &&
        (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');

      // Esc：关闭新建 → 取消搜索 → 清空选中
      if (e.key === 'Escape') {
        if (composing) { setComposing(false); e.preventDefault(); return; }
        if (query) { setQuery(''); e.preventDefault(); return; }
        if (session) { setSession(null); setActiveId(null); e.preventDefault(); return; }
        return;
      }

      if (inField && !(e.ctrlKey || e.metaKey)) return;

      // Ctrl+K：聚焦会话搜索（App 在 AI 页会让出这个键）
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }

      // ↑↓：列表里切换选中项
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && filtered.length > 0) {
        e.preventDefault();
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        setCursor(prev => {
          const next = (prev + dir + filtered.length) % filtered.length;
          const item = filtered[next];
          if (item) {
            listRef.current
              ?.querySelector<HTMLElement>(`[data-session-id="${item.id}"]`)
              ?.scrollIntoView({ block: 'nearest' });
          }
          return next;
        });
        return;
      }

      // Enter：打开光标处的会话
      if (e.key === 'Enter' && filtered[cursor]) {
        e.preventDefault();
        void openSession(filtered[cursor].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [composing, query, session, filtered, cursor, openSession]);

  const startNew = () => {
    setSession(null);
    setActiveId(null);
    setComposing(true);
    setDraft('');
  };

  return (
    <div className="panel relative flex overflow-hidden" style={{ height: aiPanelHeight, minHeight: 420 }}>
      {/* ---------- 左：会话列表 ---------- */}
      <div className="relative shrink-0 flex flex-col border-r border-ink-borderSoft min-h-0" style={{ width: aiListWidth }}>
        {/* 右边缘拖拽调宽 */}
        <DragHandle layoutKey="aiListWidth" edge="right" label="拖动调整会话列表宽度" />
        <div className="shrink-0 px-3 py-2.5 space-y-2 border-b border-ink-borderSoft">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-faint pointer-events-none" />
            <input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="搜索会话"
              className="input-inset w-full pl-7 pr-2 py-1.5 text-[12px]"
            />
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={startNew}
              className="btn-ghost px-2 py-1 text-[11px] flex items-center gap-1"
              title="新建一个通用问答会话"
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

        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
          {filtered.length === 0 ? (
            <p className="text-[11px] text-ink-faint px-2 py-6 text-center leading-relaxed">
              {query ? '没有匹配的会话' : '还没有诊断会话\n移植失败后可在弹窗里点「在 AI 诊断中继续」'}
            </p>
          ) : (
            groupByDate(filtered).map(group => (
              <div key={group.label} className="mb-3">
                <div className="px-2 py-1 text-[11px] text-ink-faint">{group.label}</div>
                {group.items.map(item => {
                  const idx = filtered.findIndex(s => s.id === item.id);
                  const isCursor = idx === cursor && idx >= 0;
                  const isActive = item.id === activeId;
                  return (
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
                          data-session-id={item.id}
                          onClick={() => { setCursor(idx); void openSession(item.id); }}
                          className={`w-full text-left px-2 py-1.5 rounded-btn transition-colors ${
                            isActive
                              ? 'bg-ink-raised'
                              : isCursor
                                ? 'bg-ink-elevated ring-1 ring-ink-border'
                                : 'hover:bg-ink-elevated'
                          }`}
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
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>

      {/* ---------- 右：对话区 ---------- */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {composing ? (
          <>
            <div className="shrink-0 px-4 py-3 border-b border-ink-borderSoft">
              <div className="text-[13px] font-medium text-ink-text">新会话</div>
              <div className="text-[11px] text-ink-muted mt-0.5">
                直接提问，或从下面挑一个常见问题
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
              <div className="space-y-1.5 max-w-[560px]">
                {NEW_SESSION_TEMPLATES.map(t => (
                  <button
                    key={t}
                    onClick={() => void askNew(t)}
                    disabled={asking}
                    className="w-full text-left px-3 py-2.5 rounded-btn border border-ink-border hover:bg-ink-elevated transition-colors text-[12px] text-ink-text disabled:opacity-50"
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="shrink-0 px-4 py-3 border-t border-ink-borderSoft space-y-2">
              {asking && (
                <div className="flex items-center gap-1.5 text-[11px] text-ink-muted">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  思考中…
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && draft.trim() && !asking) void askNew(draft);
                  }}
                  placeholder="问点什么…"
                  disabled={asking}
                  className="input-inset flex-1 px-3 py-2 text-[12px] disabled:opacity-50"
                />
                <button
                  onClick={() => void askNew(draft)}
                  disabled={!draft.trim() || asking}
                  className="btn-primary px-3 py-2 text-[12px] shrink-0 disabled:opacity-40"
                >
                  提问
                </button>
              </div>
            </div>
          </>
        ) : session ? (
          <>
            {/* 会话头 */}
            <div className="shrink-0 px-4 py-2.5 border-b border-ink-borderSoft flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-ink-text truncate">
                  {session.title || session.context?.gameName || '未识别游戏'}
                </div>
                <div className="text-[11px] text-ink-faint truncate mt-0.5">
                  {session.context?.code ? `${session.context.code} · ` : ''}
                  {session.turns.length} 轮 · {new Date(session.updatedAt || session.createdAt).toLocaleString('zh-CN')}
                </div>
              </div>
              <button
                onClick={() => void doExport(session.id)}
                className="p-1.5 rounded-btn text-ink-faint hover:text-ink-text hover:bg-ink-elevated"
                title="导出 Markdown"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => void remove(session.id)}
                className="p-1.5 rounded-btn text-ink-faint hover:text-ink-danger hover:bg-ink-elevated"
                title="删除会话"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* 失败现场 */}
            {hasFailureContext(session.context) && (session.context?.error || session.context?.code) && (
              <div className="shrink-0 px-4 py-2.5 border-b border-ink-borderSoft bg-ink-sidebar/60">
                <div className="flex items-center gap-1.5 text-[11px] text-ink-warning mb-1">
                  <AlertTriangle className="w-3 h-3" />
                  <span>失败现场</span>
                </div>
                {session.context?.code && (
                  <div className="text-[11px] font-mono text-ink-muted">{session.context.code}</div>
                )}
                {session.context?.error && (
                  <div className="text-[11px] text-ink-muted leading-relaxed mt-0.5">
                    {session.context.error}
                  </div>
                )}
              </div>
            )}

            {/* 对话 */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-[11px] text-ink-muted">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  加载中…
                </div>
              ) : (
                <div className="max-w-[640px]">
                  <AiConversation turns={session.turns} />
                </div>
              )}
            </div>

            {/* 追问输入 */}
            <div className="shrink-0 px-4 py-3 border-t border-ink-borderSoft space-y-2">
              {asking && (
                <div className="flex items-center gap-1.5 text-[11px] text-ink-muted">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  分析中…
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  value={followUp}
                  onChange={e => setFollowUp(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && followUp.trim() && !asking) void ask(followUp);
                  }}
                  placeholder="继续追问…"
                  disabled={asking}
                  className="input-inset flex-1 px-3 py-2 text-[12px] disabled:opacity-50"
                />
                <button
                  onClick={() => void ask(followUp)}
                  disabled={!followUp.trim() || asking}
                  className="btn-primary px-3 py-2 text-[12px] shrink-0 disabled:opacity-40"
                >
                  发送
                </button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1">
                  {!asking && FOLLOWUP_TEMPLATES.map(t => (
                    <button
                      key={t}
                      onClick={() => void ask(t)}
                      className="px-2 py-1 rounded-btn border border-ink-borderSoft hover:bg-ink-elevated hover:border-ink-border transition-colors text-[10px] text-ink-muted hover:text-ink-text"
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 shrink-0">
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
          </>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="w-10 h-10 rounded-card bg-ink-elevated border border-ink-borderSoft flex items-center justify-center text-ink-faint">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[13px] text-ink-text">选择左侧的会话，或新建一个</div>
              <div className="text-[11px] text-ink-muted mt-1 leading-relaxed">
                移植失败后，可在失败弹窗里点「在 AI 诊断中继续」把现场搬进来
              </div>
            </div>
            <button onClick={startNew} className="btn-ghost px-3 py-1.5 text-[12px] flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              新建会话
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AiPanel;