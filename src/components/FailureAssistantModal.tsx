import React, { useEffect, useRef, useState } from 'react';
import { X, Sparkles, Loader2, AlertTriangle, RefreshCw, Settings as SettingsIcon, FileWarning, PanelRightOpen } from 'lucide-react';
import { FailureContext, AiExplanation, AiHistoryItem, AiTurn } from '../types';
import { explainFailureApi, fetchSettings, fetchAiHistory, fetchAiHistoryEntry, deleteAiHistoryApi } from '../services/api';
import { AiConversation } from './AiTurnView';
import { useToast } from './Toast';

interface FailureAssistantModalProps {
  context: FailureContext;
  /** Raw outcome description shown at the top (e.g. "落盘校验未通过"). */
  headline: string;
  /** 最近运行日志，作为诊断上下文一并送给模型 */
  recentLogs?: { type?: string; message: string }[];
  onClose: () => void;
  onGotoSettings: () => void;
  onGotoBackups: () => void;
  /** 把当前对话搬到 AI 面板继续（面板不可用时隐藏该按钮） */
  onContinueInPanel?: (payload: { context: FailureContext; turns: AiTurn[]; headline: string; sessionId?: string | null }) => void;
}

const FailureAssistantModal: React.FC<FailureAssistantModalProps> = ({
  context,
  headline,
  recentLogs = [],
  onClose,
  onGotoSettings,
  onGotoBackups,
  onContinueInPanel,
}) => {
  const toast = useToast();
  // 'ready' = 可直接分析；'disabled' = 有密钥但未启用；'unconfigured' = 没有密钥
  const [aiState, setAiState] = useState<'loading' | 'ready' | 'disabled' | 'unconfigured'>('loading');
  const [explaining, setExplaining] = useState(false);
  const [result, setResult] = useState<AiExplanation | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 多轮：每次问答压入，首轮为 null（问题就是诊断这次失败）
  const [turns, setTurns] = useState<AiTurn[]>([]);
  const [followUp, setFollowUp] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<AiHistoryItem[]>([]);
  // 服务端落盘的会话 id —— 搬去 AI 面板时直接续接同一个会话
  const [sessionId, setSessionId] = useState<string | null>(null);
  // 自动分析只跑一次；用 ref 让上面的 effect 能调用后面定义的 runExplain
  const autoRanRef = useRef(false);
  const runExplainRef = useRef<((question?: string) => Promise<void>) | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    fetchSettings()
      .then(({ settings }) => {
        if (cancelled) return;
        if (!settings.ai.apiKeySet) setAiState('unconfigured');
        else if (!settings.ai.enabled) setAiState('disabled');
        else {
          setAiState('ready');
          // 「失败后自动分析」：配置齐备时自动发起首轮，且整个弹窗只发一次
          if (settings.ai.autoAnalyze && !autoRanRef.current) {
            autoRanRef.current = true;
            void runExplainRef.current?.();
          }
        }
      })
      .catch(() => { if (!cancelled) setAiState('unconfigured'); });
    return () => { cancelled = true; };
  }, []);

  // 打开历史抽屉时才拉列表，避免每次弹窗都请求
  const openHistory = async () => {
    setHistoryOpen(true);
    try {
      const { history: list } = await fetchAiHistory();
      setHistory(list);
    } catch {
      setHistory([]);
    }
  };

  const loadHistoryEntry = async (id: string) => {
    try {
      const { entry } = await fetchAiHistoryEntry(id);
      const list: AiTurn[] = (entry.turns || []).map(t => ({
        question: t.question ?? null,
        answer: t.answer,
        model: t.model || '',
        at: t.at,
      }));
      setTurns(list.length ? list : [{ question: null, answer: entry.turns?.[0]?.answer || '', model: entry.turns?.[0]?.model || '', at: entry.createdAt }]);
      setResult({ text: entry.turns?.[0]?.answer || '', model: entry.turns?.[0]?.model || '' });
      setHistoryOpen(false);
    } catch (e: any) {
      toast(`读取历史失败：${e.message}`, 'error');
    }
  };

  const removeHistory = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteAiHistoryApi(id);
      setHistory(prev => prev.filter(h => h.id !== id));
    } catch {
      toast('删除失败', 'error');
    }
  };

  const runExplain = async (question?: string) => {
    setExplaining(true);
    setError(null);
    try {
      // 把已有的问答转成 OpenAI messages 历史
      const messages: { role: 'user' | 'assistant'; content: string }[] = [];
      for (const t of turns) {
        if (t.question) messages.push({ role: 'user', content: t.question });
        messages.push({ role: 'assistant', content: t.answer });
      }
      if (question) messages.push({ role: 'user', content: question });

      const r = await explainFailureApi(context, {
        messages,
        logs: recentLogs,
        sessionId,
      });
      if (r.sessionId) setSessionId(r.sessionId);
      setTurns(prev => [...prev, { question: question || null, answer: r.text, model: r.model, at: new Date().toISOString() }]);
      setResult(r);
      if (question) setFollowUp('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast(`AI 分析失败：${msg}`, 'error');
    } finally {
      setExplaining(false);
    }
  };

  // 让配置加载的 effect 能在挂载后调用到最新的 runExplain
  useEffect(() => {
    runExplainRef.current = runExplain;
  });

  // Known facts the tool can state without the model's help.
  const verify = context.verify;
  const badFiles = verify?.files?.filter(f => f.size === 0 || f.md5Match === false) || [];
  const badBlobs = verify?.blobs?.filter(b => !b.exists || !b.sizeOk) || [];

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-[rgba(15,15,15,0.6)]" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="bg-ink-surface border border-ink-border w-full max-w-2xl rounded-modal shadow-glass overflow-hidden flex flex-col max-h-[85vh] modal-animate"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <header className="px-5 py-3.5 border-b border-ink-borderSoft flex items-start gap-3 shrink-0">
          <AlertTriangle className="w-4 h-4 text-ink-danger mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <h2 className="text-[15px] font-semibold text-ink-text leading-tight">移植未成功</h2>
            <p className="text-[12px] text-ink-muted mt-0.5">{headline}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-btn text-ink-faint hover:text-ink-text hover:bg-ink-elevated transition-colors shrink-0">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="overflow-y-auto flex-1">
          {/* Known facts */}
          <section className="px-5 py-4 border-b border-ink-borderSoft space-y-2">
            <h3 className="text-[12px] font-medium text-ink-muted">已知信息</h3>
            <dl className="grid grid-cols-1 sm:grid-cols-[100px_1fr] gap-x-3 gap-y-1.5 text-[12px]">
              {context.code && (
                <>
                  <dt className="text-ink-faint">错误码</dt>
                  <dd className="font-mono text-ink-warning">{context.code}</dd>
                </>
              )}
              <dt className="text-ink-faint">错误信息</dt>
              <dd className="text-ink-text break-words">{context.error || '（无）'}</dd>
              {context.gameName && (
                <>
                  <dt className="text-ink-faint">游戏</dt>
                  <dd className="text-ink-text">{context.gameName}</dd>
                </>
              )}
              {context.direction && (
                <>
                  <dt className="text-ink-faint">方向</dt>
                  <dd className="text-ink-text">
                    {context.direction === 'xbox_to_steam' ? 'Xbox → Steam' : context.direction === 'steam_to_xbox' ? 'Steam → Xbox' : context.direction}
                  </dd>
                </>
              )}
              {context.stage && (
                <>
                  <dt className="text-ink-faint">发生位置</dt>
                  <dd className="font-mono text-[11px] text-ink-muted">{context.stage}</dd>
                </>
              )}
            </dl>

            {/* Concrete verify failures — the part the old UI never showed */}
            {(badFiles.length > 0 || badBlobs.length > 0) && (
              <div className="mt-3 pt-3 border-t border-ink-borderSoft">
                <div className="flex items-center gap-1.5 text-[12px] text-ink-danger mb-1.5">
                  <FileWarning className="w-3.5 h-3.5" />
                  <span>落盘校验明细</span>
                </div>
                <ul className="space-y-1">
                  {badFiles.map(f => (
                    <li key={f.name} className="font-mono text-[11px] text-ink-muted">
                      {f.name} — {f.size === 0 ? '文件为 0 字节' : f.md5Match === false ? 'MD5 与来源不一致' : '校验异常'}
                    </li>
                  ))}
                  {badBlobs.map(b => (
                    <li key={b.name} className="font-mono text-[11px] text-ink-muted">
                      {b.name} — {!b.exists ? '目标文件缺失' : '大小不符'}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* AI answer */}
          <section className="px-5 py-4">
            {!result && !explaining && (
              <div className="text-center py-6">
                {aiState === 'unconfigured' ? (
                  <>
                    <p className="text-[12px] text-ink-muted mb-3">
                      尚未填写 API Key，无法分析失败原因
                    </p>
                    <button onClick={onGotoSettings} className="btn-primary px-3.5 py-2 text-[12px] inline-flex items-center gap-2">
                      <SettingsIcon className="w-3.5 h-3.5" />
                      去设置中配置
                    </button>
                  </>
                ) : aiState === 'disabled' ? (
                  <>
                    <p className="text-[12px] text-ink-muted mb-3">
                      API Key 已保存，但 AI 助手处于「未启用」状态
                    </p>
                    <button onClick={onGotoSettings} className="btn-primary px-3.5 py-2 text-[12px] inline-flex items-center gap-2">
                      <SettingsIcon className="w-3.5 h-3.5" />
                      去设置中启用
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-[12px] text-ink-muted mb-3">
                      可以让 AI 结合当前现场信息分析原因并给出解决方案
                    </p>
                    <button
                      onClick={() => runExplain()}
                      disabled={aiState !== 'ready'}
                      className="btn-primary px-3.5 py-2 text-[12px] inline-flex items-center gap-2"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      AI 分析失败原因
                    </button>
                  </>
                )}
              </div>
            )}

            {explaining && (
              <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-ink-muted">
                <Loader2 className="w-4 h-4 animate-spin" />
                正在分析…
              </div>
            )}

            {error && !explaining && (
              <div className="text-center py-6 space-y-3">
                <p className="text-[12px] text-ink-danger break-words">{error}</p>
                <button onClick={() => runExplain()} className="btn-ghost px-3 py-1.5 text-[12px] inline-flex items-center gap-1.5">
                  <RefreshCw className="w-3 h-3" />
                  重试
                </button>
              </div>
            )}

            {result && !explaining && (
              <div className="space-y-4">
                {/* 对话流：每轮一问一答 */}
                <AiConversation turns={turns} />

                {/* 追问输入 */}
                <div className="pt-2 border-t border-ink-borderSoft">
                  <div className="flex items-center gap-2">
                    <input
                      value={followUp}
                      onChange={e => setFollowUp(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && followUp.trim() && !explaining) {
                          runExplain(followUp.trim());
                        }
                      }}
                      placeholder="继续追问，例如：那具体怎么恢复备份？"
                      className="input-inset flex-1 px-3 py-2 text-[12px]"
                    />
                    <button
                      onClick={() => followUp.trim() && runExplain(followUp.trim())}
                      disabled={!followUp.trim() || explaining}
                      className="btn-primary px-3 py-2 text-[12px] shrink-0"
                    >
                      追问
                    </button>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="t-mono">模型：{turns[turns.length - 1]?.model || result.model}</span>
                    <div className="flex items-center gap-3">
                      {onContinueInPanel && turns.length > 0 && (
                        <button
                          onClick={() => onContinueInPanel({ context, turns, headline, sessionId })}
                          className="text-[11px] text-ink-muted hover:text-ink-text transition-colors flex items-center gap-1"
                          title="把这次诊断搬到 AI 面板继续追问"
                        >
                          <PanelRightOpen className="w-3 h-3" />
                          在 AI 面板继续
                        </button>
                      )}
                      <button onClick={openHistory} className="text-[11px] text-ink-muted hover:text-ink-text transition-colors flex items-center gap-1">
                        <HistoryIcon />
                        历史
                      </button>
                      <button onClick={() => { setTurns([]); setResult(null); }} className="text-[11px] text-ink-muted hover:text-ink-text transition-colors flex items-center gap-1">
                        <RefreshCw className="w-3 h-3" />
                        重新分析
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 历史抽屉 */}
            {historyOpen && (
              <div className="mt-4 pt-3 border-t border-ink-borderSoft">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[12px] text-ink-muted">最近的诊断记录</span>
                  <button onClick={() => setHistoryOpen(false)} className="text-[11px] text-ink-faint hover:text-ink-text">收起</button>
                </div>
                {history.length === 0 ? (
                  <p className="t-meta py-3">还没有诊断记录</p>
                ) : (
                  <ul className="space-y-1 max-h-52 overflow-y-auto">
                    {history.map(h => (
                      <li key={h.id}>
                        <button
                          onClick={() => loadHistoryEntry(h.id)}
                          className="w-full text-left px-2 py-1.5 rounded-btn hover:bg-ink-elevated transition-colors flex items-start gap-2"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-[12px] text-ink-text truncate">
                              {h.title || h.gameName || '未识别游戏'}
                              {h.code ? ` · ${h.code}` : ''}
                            </div>
                            <div className="t-meta truncate">{h.answerPreview}</div>
                          </div>
                          <span className="t-mono shrink-0">{new Date(h.createdAt).toLocaleDateString('zh-CN')}</span>
                          <span
                            onClick={e => removeHistory(h.id, e)}
                            className="shrink-0 text-ink-faint hover:text-ink-danger px-1"
                            title="删除"
                          >
                            ×
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        </div>

        {/* Footer */}
        <footer className="px-5 py-3 border-t border-ink-borderSoft flex items-center justify-between gap-3 shrink-0">
          <button onClick={onGotoBackups} className="text-[12px] text-ink-muted hover:text-ink-text transition-colors flex items-center gap-1.5">
            <CornerIcon />
            查看备份并还原
          </button>
          <button onClick={onClose} className="btn-ghost px-3 py-1.5 text-[12px]">
            关闭
          </button>
        </footer>
      </div>
    </div>
  );
};

const HistoryIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l3 2" />
  </svg>
);

const CornerIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-1" />
  </svg>
);

export default FailureAssistantModal;
