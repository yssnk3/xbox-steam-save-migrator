import React, { useEffect, useState } from 'react';
import { X, Sparkles, Loader2, AlertTriangle, RefreshCw, Settings as SettingsIcon, ChevronRight, FileWarning } from 'lucide-react';
import { FailureContext, AiExplanation } from '../types';
import { explainFailureApi, fetchSettings } from '../services/api';
import { useToast } from './Toast';

interface FailureAssistantModalProps {
  context: FailureContext;
  /** Raw outcome description shown at the top (e.g. "落盘校验未通过"). */
  headline: string;
  onClose: () => void;
  onGotoSettings: () => void;
  onGotoBackups: () => void;
}

/** Turn the three-section plain-text answer into labeled blocks. */
function parseSections(text: string): { label: string; body: string[] }[] {
  const lines = text.split(/\r?\n/);
  const sections: { label: string; body: string[] }[] = [];
  let current: { label: string; body: string[] } | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    const m = /^(原因|可能方案|下一步操作)[：:]\s*(.*)$/.exec(line);
    if (m) {
      current = { label: m[1], body: m[2] ? [m[2]] : [] };
      sections.push(current);
      continue;
    }
    if (!line) continue;
    if (current) current.body.push(line.replace(/^[-•*]\s*/, ''));
  }

  // Model didn't follow the format — show the whole thing rather than dropping it.
  if (sections.length === 0) return [{ label: '分析结果', body: lines.filter(l => l.trim()) }];
  return sections;
}

const SECTION_ACCENT: Record<string, string> = {
  原因: 'text-ink-warning',
  可能方案: 'text-ink-text',
  下一步操作: 'text-ink-text',
};

const FailureAssistantModal: React.FC<FailureAssistantModalProps> = ({
  context,
  headline,
  onClose,
  onGotoSettings,
  onGotoBackups,
}) => {
  const toast = useToast();
  // 'ready' = 可直接分析；'disabled' = 有密钥但未启用；'unconfigured' = 没有密钥
  const [aiState, setAiState] = useState<'loading' | 'ready' | 'disabled' | 'unconfigured'>('loading');
  const [explaining, setExplaining] = useState(false);
  const [result, setResult] = useState<AiExplanation | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        else setAiState('ready');
      })
      .catch(() => { if (!cancelled) setAiState('unconfigured'); });
    return () => { cancelled = true; };
  }, []);

  const runExplain = async () => {
    setExplaining(true);
    setError(null);
    try {
      const r = await explainFailureApi(context);
      setResult(r);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast(`AI 分析失败：${msg}`, 'error');
    } finally {
      setExplaining(false);
    }
  };

  // Known facts the tool can state without the model's help.
  const verify = context.verify;
  const badFiles = verify?.files?.filter(f => f.size === 0 || f.md5Match === false) || [];
  const badBlobs = verify?.blobs?.filter(b => !b.exists || !b.sizeOk) || [];

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/70" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="bg-ink-surface border border-ink-border w-full max-w-2xl rounded-card shadow-glass overflow-hidden flex flex-col max-h-[85vh] modal-animate"
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
                      onClick={runExplain}
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
                <button onClick={runExplain} className="btn-ghost px-3 py-1.5 text-[12px] inline-flex items-center gap-1.5">
                  <RefreshCw className="w-3 h-3" />
                  重试
                </button>
              </div>
            )}

            {result && !explaining && (
              <div className="space-y-4">
                {parseSections(result.text).map((sec, i) => (
                  <div key={i}>
                    <h4 className={`text-[12px] font-medium mb-1.5 ${SECTION_ACCENT[sec.label] || 'text-ink-text'}`}>
                      {sec.label}
                    </h4>
                    {sec.body.length === 1 ? (
                      <p className="text-[12px] text-ink-text leading-relaxed">{sec.body[0]}</p>
                    ) : (
                      <ul className="space-y-1">
                        {sec.body.map((b, j) => (
                          <li key={j} className="text-[12px] text-ink-text leading-relaxed flex gap-2">
                            <ChevronRight className="w-3 h-3 text-ink-faint mt-1 shrink-0" />
                            <span>{b}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
                <div className="flex items-center justify-between pt-2 border-t border-ink-borderSoft">
                  <span className="font-mono text-[11px] text-ink-faint">模型：{result.model}</span>
                  <button onClick={runExplain} className="text-[11px] text-ink-muted hover:text-ink-text transition-colors flex items-center gap-1">
                    <RefreshCw className="w-3 h-3" />
                    重新分析
                  </button>
                </div>
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

const CornerIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-1" />
  </svg>
);

export default FailureAssistantModal;
