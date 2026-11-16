import React, { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle, Save, Monitor, Sun, Moon, RotateCcw } from 'lucide-react';
import { ACCENT_OPTIONS, ThemeMode, AccentColor, applyTheme, cacheTheme } from '../theme';
import { AppSettings } from '../types';
import { fetchSettings, saveSettings, testAiConnectionApi } from '../services/api';
import { resetLayout, toLayoutPatch, useLayout } from '../layout';
import { useToast } from './Toast';

interface SettingsPanelProps {
  onAddLog: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  themeMode: ThemeMode;
  accent: AccentColor;
  onThemeChange: (mode: ThemeMode) => void;
  onAccentChange: (accent: AccentColor) => void;
}

const INPUT_CLASS =
  'w-full bg-ink-base border border-ink-border rounded-btn px-3 py-2 text-[14px] text-ink-text placeholder:text-ink-faint hover:border-ink-faint focus:outline-none focus:border-ink-accent focus:shadow-[0_0_0_2px_var(--ink-accent-soft)] transition-colors';

const LABEL_CLASS = 'block text-[12px] font-medium text-ink-muted mb-1.5';

const SettingsPanel: React.FC<SettingsPanelProps> = ({ onAddLog, themeMode, accent, onThemeChange, onAccentChange }) => {
  const toast = useToast();
  const layout = useLayout();

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Form state — apiKey is never populated from the server (only the hint is).
  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [timeoutMs, setTimeoutMs] = useState(20000);
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [keepCount, setKeepCount] = useState(50);
  const [autoAnalyze, setAutoAnalyze] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { settings: s } = await fetchSettings();
      setSettings(s);
      setEnabled(s.ai.enabled);
      setBaseUrl(s.ai.baseUrl);
      setModel(s.ai.model);
      setTimeoutMs(s.ai.timeoutMs);
      setAutoAnalyze(Boolean(s.ai.autoAnalyze));
      setKeepCount(s.backup.keepCount);
      setApiKey('');
      setClearKey(false);
      if (s.appearance) { applyTheme(s.appearance); cacheTheme(s.appearance); }
    } catch (err) {
      toast(`加载设置失败：${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  /** 恢复默认布局：内存 + localStorage 立即复位，服务器值同步写回。 */
  const handleResetLayout = async () => {
    const next = resetLayout();
    try {
      await saveSettings({ layout: toLayoutPatch(next) });
      toast('已恢复默认布局', 'success');
    } catch (e: any) {
      // 本地已复位，服务器没写成功只影响下次启动
      toast(`布局已复位，但写入设置文件失败：${e.message}`, 'warning');
    }
    onAddLog('[布局] 已恢复默认值', 'info');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // 用户刚填了密钥却没勾启用 → 自动启用，否则保存后仍无法分析，看起来像"没存上"。
      const willHaveKey = apiKey.trim() !== '' || (Boolean(settings?.ai.apiKeySet) && !clearKey);
      const nextEnabled = enabled || (apiKey.trim() !== '' && !clearKey);

      const patch: Parameters<typeof saveSettings>[0] = {
        ai: { enabled: nextEnabled, baseUrl, model, timeoutMs: Number(timeoutMs), autoAnalyze },
        backup: { keepCount: Number(keepCount) },
        appearance: { theme: themeMode, accent },
      };
      // undefined = keep existing key; '' = explicitly clear it.
      if (apiKey.trim()) patch.ai!.apiKey = apiKey.trim();
      else if (clearKey) patch.ai!.apiKey = '';

      const { settings: s } = await saveSettings(patch);
      setSettings(s);
      setEnabled(s.ai.enabled);
      setApiKey('');
      setClearKey(false);

      const hint = !willHaveKey
        ? '设置已保存（未填写 API Key，AI 功能不可用）'
        : s.ai.enabled
          ? '设置已保存，AI 助手已启用'
          : '设置已保存，AI 助手未启用';
      toast(hint, willHaveKey ? 'success' : 'warning');
      onAddLog(hint, willHaveKey ? 'success' : 'warning');
    } catch (err) {
      toast(`保存失败：${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // 用表单当前值测试：用户填完 key 不必先保存就能验证。
      const r = await testAiConnectionApi({
        baseUrl,
        model,
        apiKey: apiKey.trim() || undefined,
        timeoutMs: Number(timeoutMs),
      });
      setTestResult({ ok: true, message: `连接成功，模型：${r.model}` });
      toast('AI 连接正常', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestResult({ ok: false, message: msg });
      toast(`连接失败：${msg}`, 'error');
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="panel p-10 flex items-center justify-center gap-2 text-ink-muted text-[13px]">
        <Loader2 className="w-4 h-4 animate-spin" />
        正在加载设置…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 外观 */}
      <section className="panel p-5">
        <header className="pb-3 border-b border-ink-borderSoft">
          <h2 className="t-title">外观</h2>
          <p className="t-meta mt-0.5">主题与强调色，改动立即生效</p>
        </header>

        <div className="pt-4 space-y-5">
          <div>
            <div className={LABEL_CLASS}>主题</div>
            <div className="flex flex-wrap gap-2">
              {([
                { value: 'system' as ThemeMode, label: '跟随系统', Icon: Monitor },
                { value: 'light' as ThemeMode, label: '浅色', Icon: Sun },
                { value: 'dark' as ThemeMode, label: '深色', Icon: Moon },
              ]).map(({ value, label, Icon }) => (
                <button
                  key={value}
                  onClick={() => onThemeChange(value)}
                  className={`px-3 py-2 rounded-btn text-[13px] flex items-center gap-1.5 transition-colors ${
                    themeMode === value
                      ? 'bg-ink-active text-ink-text font-medium border border-ink-border'
                      : 'btn-ghost'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className={LABEL_CLASS}>强调色</div>
            <div className="flex items-center gap-2">
              {ACCENT_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => onAccentChange(opt.value)}
                  title={opt.label}
                  aria-label={opt.label}
                  className={`w-7 h-7 rounded-full transition-all ${
                    accent === opt.value ? 'ring-2 ring-offset-2' : 'hover:scale-105'
                  }`}
                  style={{
                    backgroundColor: opt.swatch,
                    // ring 颜色跟随当前主题文字色，避免固定色在浅色下不可见
                    ['--tw-ring-color' as any]: 'var(--ink-text)',
                    ['--tw-ring-offset-color' as any]: 'var(--ink-surface)',
                  }}
                />
              ))}
            </div>
            <p className="t-meta mt-1.5">强调色用于焦点框、选中态与少量状态提示</p>
          </div>
        </div>
      </section>

      {/* AI 助手 */}
      <section className="panel p-5">
        <header className="flex items-center justify-between gap-3 pb-3 border-b border-ink-borderSoft">
          <div>
            <h2 className="t-title">AI 失败诊断</h2>
            <p className="t-meta mt-0.5">OpenAI 兼容接口，密钥只保存在本机</p>
          </div>
          <label className="flex items-center gap-2 shrink-0 cursor-pointer select-none">
            <span className="text-[12px] text-ink-muted">{enabled ? '已启用' : '未启用'}</span>
            <input
              type="checkbox"
              checked={enabled}
              onChange={e => setEnabled(e.target.checked)}
              className="w-3.5 h-3.5 accent-ink-muted"
            />
          </label>
        </header>

        <div className="pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className={LABEL_CLASS}>API 地址（Base URL）</label>
            <input
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className={`${INPUT_CLASS} font-mono text-[12px]`}
            />
            <p className="text-[11px] text-ink-faint mt-1">
              只填到版本路径，工具会自动补 <span className="font-mono">/chat/completions</span>
            </p>
          </div>

          <div>
            <label className={LABEL_CLASS}>模型</label>
            <input
              value={model}
              onChange={e => setModel(e.target.value)}
              placeholder="gpt-4o-mini"
              className={`${INPUT_CLASS} font-mono text-[12px]`}
            />
          </div>

          <div>
            <label className={LABEL_CLASS}>超时（毫秒）</label>
            <input
              type="number"
              value={timeoutMs}
              onChange={e => setTimeoutMs(Number(e.target.value))}
              min={3000}
              max={120000}
              step={1000}
              className={`${INPUT_CLASS} font-mono text-[12px]`}
            />
          </div>

          <div className="md:col-span-2">
            <label className={LABEL_CLASS}>API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={e => { setApiKey(e.target.value); setClearKey(false); }}
              placeholder={settings?.ai.apiKeySet ? `已保存 ${settings.ai.apiKeyHint}，留空则保持不变` : '未设置'}
              className={`${INPUT_CLASS} font-mono text-[12px]`}
              autoComplete="off"
            />
            <div className="flex items-center gap-3 mt-1.5">
              <label className="flex items-center gap-1.5 text-[11px] text-ink-faint cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={clearKey}
                  onChange={e => { setClearKey(e.target.checked); if (e.target.checked) setApiKey(''); }}
                  className="w-3 h-3 accent-ink-muted"
                />
                清除已保存的密钥
              </label>
              <span className="text-[11px] text-ink-faint">· 明文存放于本机 settings.json</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-4 mt-4 border-t border-ink-borderSoft">
          <label className="flex items-center gap-2 text-[12px] text-ink-muted cursor-pointer select-none mr-3">
            <input
              type="checkbox"
              checked={autoAnalyze}
              onChange={e => setAutoAnalyze(e.target.checked)}
              className="w-3.5 h-3.5"
            />
            失败后自动分析
          </label>
          <button onClick={handleTest} disabled={testing} className="btn-ghost px-3 py-1.5 text-[12px] flex items-center gap-1.5">
            {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
            测试连接
          </button>
          {testResult && (
            <span className={`flex items-center gap-1 text-[11px] ${testResult.ok ? 'text-ink-success' : 'text-ink-danger'}`}>
              {testResult.ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
              {testResult.message}
            </span>
          )}
        </div>
      </section>

      {/* 备份 */}
      <section className="panel p-5">
        <header className="pb-3 border-b border-ink-borderSoft">
          <h2 className="t-title">备份策略</h2>
          <p className="t-meta mt-0.5">自动备份被覆盖的一方，可在备份中心还原到原位置</p>
        </header>
        <div className="pt-4 max-w-xs">
          <label className={LABEL_CLASS}>最多保留备份数量</label>
          <input
            type="number"
            value={keepCount}
            onChange={e => setKeepCount(Number(e.target.value))}
            min={1}
            max={500}
            className={`${INPUT_CLASS} font-mono text-[12px]`}
          />
          <p className="text-[11px] text-ink-faint mt-1">超出后自动清理最旧的备份（含元数据文件）</p>
        </div>
      </section>

      {/* 布局 */}
      <section className="panel p-5">
        <header className="pb-3 border-b border-ink-borderSoft">
          <h2 className="t-title">布局</h2>
          <p className="t-meta mt-0.5">
            拖动各面板边缘可直接调整尺寸，松手自动保存。此处可一键恢复默认。
          </p>
        </header>
        <div className="pt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
            <dt className="text-ink-muted">侧边栏</dt>
            <dd className="font-mono text-[11px] text-ink-faint tabular-nums">{layout.sidebarWidth}px</dd>
            <dt className="text-ink-muted">顶栏</dt>
            <dd className="font-mono text-[11px] text-ink-faint tabular-nums">{layout.topbarHeight}px</dd>
            <dt className="text-ink-muted">正文留白</dt>
            <dd className="font-mono text-[11px] text-ink-faint tabular-nums">{layout.contentPadding}px</dd>
            <dt className="text-ink-muted">日志浮窗</dt>
            <dd className="font-mono text-[11px] text-ink-faint tabular-nums">
              {layout.logWidth}×{layout.logHeight} @ ({layout.logX}, {layout.logY})
            </dd>
            <dt className="text-ink-muted">AI 会话列</dt>
            <dd className="font-mono text-[11px] text-ink-faint tabular-nums">{layout.aiListWidth}px</dd>
            <dt className="text-ink-muted">AI 面板高</dt>
            <dd className="font-mono text-[11px] text-ink-faint tabular-nums">{layout.aiPanelHeight}px</dd>
          </dl>
          <button onClick={handleResetLayout} className="btn-ghost px-3 py-1.5 text-[12px] flex items-center gap-1.5">
            <RotateCcw className="w-3.5 h-3.5" />
            恢复默认布局
          </button>
        </div>
      </section>

      {/* 关于 */}
      <section className="panel p-5">
        <header className="pb-3 border-b border-ink-borderSoft">
          <h2 className="t-title">关于</h2>
          <p className="t-meta mt-0.5">Steam ↔ Xbox 存档移植工具</p>
        </header>
        <dl className="pt-4 grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-[12px]">
          <dt className="text-ink-muted">配置文件</dt>
          <dd className="font-mono text-[11px] text-ink-faint break-all">{settings?.storePath || '—'}</dd>
          <dt className="text-ink-muted">备份目录</dt>
          <dd className="font-mono text-[11px] text-ink-faint">Backups/（程序运行目录下）</dd>
          <dt className="text-ink-muted">存档校验</dt>
          <dd className="text-ink-faint">写入后核对文件尺寸与 MD5，并检查 WGS 容器结构未被改写</dd>
        </dl>
      </section>

      <div className="flex justify-end">
        <button onClick={handleSave} disabled={saving} className="btn-primary px-4 py-2 text-[13px] flex items-center gap-2">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {saving ? '保存中…' : '保存设置'}
        </button>
      </div>
    </div>
  );
};

export default SettingsPanel;
