import React, { useEffect, useState, useCallback, useRef } from 'react';
import { GameItem, LogEntry, FailureContext, EnvInfo, XboxInstalledGame, AiTurn } from './types';
import { fetchGames, fetchBackups, fetchXboxLibrary, migrateSave, inspectSave, pickFolder } from './services/api';
import { migrationOutcome, outcomeText } from './utils/migrationOutcome';
import { buildFailureContext } from './utils/failureContext';
import FailureAssistantModal from './components/FailureAssistantModal';
import { Sidebar, TabKey } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { SearchPalette, SearchResult } from './components/SearchPalette';
import { EnvBanner } from './components/EnvBanner';
import { fetchEnv, saveSettings, fetchSettings, fetchAiHistory } from './services/api';
import { applyCachedTheme, applyTheme, cacheTheme, watchSystemTheme, ThemeMode, AccentColor, DEFAULT_APPEARANCE } from './theme';
import { applyServerLayout, loadCachedLayout, useLayout } from './layout';
import { GameGrid } from './components/GameGrid';
import { SaveComparisonModal } from './components/SaveComparisonModal';
import { PortabilityModal } from './components/PortabilityModal';
import { BackupManager } from './components/BackupManager';
import XboxLibraryPanel from './components/XboxLibraryPanel';
import SettingsPanel from './components/SettingsPanel';
import { ManualConverter } from './components/ManualConverter';
import { AiPanel } from './components/AiPanel';
import { DragHandle } from './components/DragHandle';
import { IdentifyMigratePanel } from './components/IdentifyMigratePanel';
import { LogConsole } from './components/LogConsole';
import { CustomGameModal } from './components/CustomGameModal';
import { ConfirmDialog, ConfirmDialogConfig } from './components/ConfirmDialog';
import { WelcomeScreen, isWelcomeDismissed, dismissWelcome } from './components/WelcomeScreen';
import { useToast } from './components/Toast';
import { Plus, Wrench, ChevronDown, ChevronUp, Terminal, RefreshCw } from 'lucide-react';


/** 每个 tab 在正文顶部的大标题与说明（Notion 页面标题形态） */
const PAGE_META: Record<TabKey, { title: string; desc: string }> = {
  games: { title: '游戏移植', desc: '识别本机存档，选择方向后一键移植；支持 Steam ↔ Xbox 双向转换。' },
  xbox: { title: 'Xbox 游戏库', desc: '列出本机已安装的 Xbox / Game Pass 游戏，可直接启动以生成存档结构。' },
  backups: { title: '备份中心', desc: '每次移植前自动备份，可在此查看、还原或清理历史备份。' },
  ai: { title: 'AI 诊断', desc: '查看历史诊断会话、继续追问，或直接提问；移植失败时也可把现场搬进来。' },
  settings: { title: '设置', desc: '路径自检、外观主题与 AI 诊断配置。' },
};

export const App: React.FC = () => {
 const toast = useToast();
 const [activeTab, setActiveTab] = useState<TabKey>('games');
 const [games, setGames] = useState<GameItem[]>([]);
 const [loadingGames, setLoadingGames] = useState(false);

 const [selectedGame, setSelectedGame] = useState<GameItem | null>(null);
 const [testGame, setTestGame] = useState<GameItem | null>(null);
 const [isMigrating, setIsMigrating] = useState(false);
 const [showCustomGameModal, setShowCustomGameModal] = useState(false);
 const [logVisible, setLogVisible] = useState(false);
 const [showWelcome, setShowWelcome] = useState(!isWelcomeDismissed());
 const [advancedOpen, setAdvancedOpen] = useState(false);

 const [logs, setLogs] = useState<LogEntry[]>([]);
  const [failureContext, setFailureContext] = useState<FailureContext | null>(null);
  const [failureHeadline, setFailureHeadline] = useState('');
  const [env, setEnv] = useState<EnvInfo | null>(null);
  const [backupCount, setBackupCount] = useState(0);
  const [libraryGames, setLibraryGames] = useState<XboxInstalledGame[]>([]);
  const [libraryScanning, setLibraryScanning] = useState(false);
  const [libraryScanned, setLibraryScanned] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTarget, setSearchTarget] = useState<{ tab: TabKey; key: string } | null>(null);
  const [envDismissed, setEnvDismissed] = useState(false);
 const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const [accent, setAccent] = useState<AccentColor>('neutral');
  const { contentPadding } = useLayout();

 // AI 诊断：作为侧边栏的一个 tab；失败弹窗可把现场搬进来
 const [aiPending, setAiPending] = useState<{ context: FailureContext; turns: AiTurn[]; headline: string; sessionId?: string | null } | null>(null);
 const [aiSessionCount, setAiSessionCount] = useState(0);


 // Confirm dialog state
 const [confirmConfig, setConfirmConfig] = useState<ConfirmDialogConfig | null>(null);
 const [confirmResolve, setConfirmResolve] = useState<((v: boolean) => void) | null>(null);

 // Safety net: if a migration never settles (backend crash / stale await), the
 // `isMigrating` flag would leave every transfer button disabled forever —
 // the reported "无法操作" symptom. Auto-release after a generous timeout.
 const migrateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
 const beginMigrating = useCallback(() => {
 setIsMigrating(true);
 if (migrateTimer.current) clearTimeout(migrateTimer.current);
 migrateTimer.current = setTimeout(() => {
 setIsMigrating(false);
 toast('移植似乎未在预期时间内完成，已自动解除锁定。请检查日志后重试。', 'warning');
 }, 120000);
 }, [toast]);
 const endMigrating = useCallback(() => {
 if (migrateTimer.current) clearTimeout(migrateTimer.current);
 setIsMigrating(false);
 }, []);

 const addLog = useCallback((message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
 const newEntry: LogEntry = {
 id: Math.random().toString(),
 timestamp: new Date().toLocaleTimeString('zh-CN'),
 type,
 message
 };
 setLogs(prev => [newEntry, ...prev.slice(0, 49)]);
 }, []);

 // Turn the backend's audit report into human-readable landing log lines.
 const reportVerify = useCallback((result: any) => {
 const v = result?.verify;
 if (!v) return;
 if (!v.ok) {
 addLog(`[落盘校验] 未通过：目标文件中存在缺失或为 0 字节。${v.note}`, 'error');
 return;
 }
 addLog(`[落盘校验] 已安装至游戏读取路径：${v.targetPath}`, 'info');
 if (v.mode === 'in-place') {
 addLog('[写入方式] 保留 Xbox 端原有容器结构，仅替换存档字节（容器名/GUID/清单未改动）', 'info');
 } else if (v.mode === 'rebuild') {
 addLog('[写入方式] Xbox 端此前无存档结构，已新建容器（容器名按文件名推断，游戏可能读不到）', 'warning');
 }
 (v.files || []).forEach((f: any) => {
 const hashNote = f.md5Match === true ? '（MD5 校验通过）' : f.md5Match === false ? '（⚠️ MD5 校验不一致）' : '';
 addLog(`✅ 已写入 ${f.name} (${f.size}B) ${f.original && f.original !== f.name ? `← ${f.original}` : ''} → ${f.path}${hashNote}`, 'success');
 });
 (v.blobs || []).forEach((b: any) => {
 const hashNote = b.md5Match === true ? '（MD5 校验通过）' : b.md5Match === false ? '（⚠️ MD5 不一致）' : '';
 const src = b.source ? ` ← ${b.source}` : '';
 addLog(`✅ Xbox 容器已写入 ${b.name}${src} (${b.exists && b.sizeOk ? '成功' : b.exists ? '大小不符' : '缺失'})${hashNote}`, 'success');
 });
 (v.skippedContainers || []).forEach((s: any) => {
 addLog(`⏭️ 跳过容器 ${s.container}：${s.reason}`, 'info');
 });
 if (v.unusedSteamFiles && v.unusedSteamFiles.length > 0) {
 addLog(`⚠️ 以下 Steam 存档在 Xbox 结构中没有对应存档位，未被移植：${v.unusedSteamFiles.join('、')}`, 'warning');
 }
 if (v.note) {
 addLog(`[请确认] ${v.note}`, 'warning');
 }
 }, [addLog]);

 const showConfirm = useCallback((config: ConfirmDialogConfig): Promise<boolean> => {
 return new Promise(resolve => {
 setConfirmConfig(config);
 setConfirmResolve(() => resolve);
 });
 }, []);

 const handleConfirm = () => {
 setConfirmConfig(null);
 confirmResolve?.(true);
 setConfirmResolve(null);
 };

 const handleCancelConfirm = () => {
 setConfirmConfig(null);
 confirmResolve?.(false);
 setConfirmResolve(null);
 };

  const loadGames = async () => {
    setLoadingGames(true);
    addLog('正在扫描全盘已安装的 Steam 与 Xbox PC Game Pass 存档路径...', 'info');
    try {
      const data = await fetchGames();
      setGames(data.games);
      const bothCount = data.games.filter(g => g.isSteamDetected && g.isXboxDetected).length;
      addLog(`检索完成！已找到 ${data.games.length} 款游戏，其中 ${bothCount} 款存在双端存档。`, 'success');
    } catch (err: any) {
      addLog(`扫描失败: ${err.message}`, 'error');
      toast(`扫描失败: ${err.message}`, 'error');
    } finally {
      setLoadingGames(false);
    }
  };

  /** 加载 Xbox 游戏库（默认走缓存，进入程序即渲染）。force=true 时忽略缓存重扫。 */
  const loadLibrary = useCallback(async (force = false) => {
    setLibraryScanning(true);
    try {
      const data = await fetchXboxLibrary(force);
      setLibraryGames(data.games);
      setLibraryScanned(true);
      if (force) {
        const gameCount = data.games.filter(g => g.isGame).length;
        addLog(`Xbox 游戏库已刷新：${gameCount} 款游戏 / 共 ${data.games.length} 个应用`, 'success');
      }
    } catch (err: any) {
      addLog(`Xbox 游戏库读取失败：${err.message}`, 'error');
    } finally {
      setLibraryScanning(false);
    }
  }, [addLog]);

  /** 左下的全局扫描：一次同时刷新存档与游戏库。 */
  const performGlobalScan = useCallback(async () => {
    await Promise.all([loadGames(), loadLibrary(true)]);
  }, [loadLibrary]);

  const loadEnv = useCallback(async () => {
    try {
      const { env: info } = await fetchEnv();
      setEnv(info);
    } catch {
      // 环境自检失败不阻塞主流程
    }
  }, []);

  // 侧栏需要备份条数做徽标；失败不影响主流程
  const loadBackupCount = useCallback(async () => {
    try {
      const list = await fetchBackups();
      setBackupCount(Array.isArray(list) ? list.length : 0);
    } catch {
      setBackupCount(0);
    }
  }, []);

  // 启动：先按缓存上色（避免闪白），再从服务端同步权威外观
  useEffect(() => {
    const cached = applyCachedTheme();
    setThemeMode(cached.theme);
    setAccent(cached.accent);
    // 布局同理：先用 localStorage 渲染，服务器值随后校正
    loadCachedLayout();
    let cancelled = false;
    fetchSettings()
      .then(({ settings }) => {
        if (cancelled) return;
        if (settings.appearance) {
          setThemeMode(settings.appearance.theme);
          setAccent(settings.appearance.accent);
          applyTheme(settings.appearance);
          cacheTheme(settings.appearance);
        }
        if (settings.layout) applyServerLayout(settings.layout);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // 主题/色彩变化立即生效
  useEffect(() => {
    applyTheme({ theme: themeMode, accent });
  }, [themeMode, accent]);

  // 系统主题变化时，仅在「跟随系统」模式下重绘
  useEffect(() => {
    const stop = watchSystemTheme(() => themeMode, () => applyTheme({ theme: themeMode, accent }));
    return stop;
  }, [themeMode, accent]);

  useEffect(() => {
    loadGames();
    loadEnv();
    loadBackupCount();
    // 游戏库走磁盘缓存，进入程序立即有内容（不触发 PowerShell 枚举）
    loadLibrary(false);
    // AI 会话数用于侧边栏角标（列表本身在 AI 页加载）
    fetchAiHistory().then(({ history }) => setAiSessionCount(history.length)).catch(() => {});
  }, []);

  // Ctrl+K 打开搜索（AI 诊断页自己接管这个键，聚焦会话搜索框）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        if (activeTab === 'ai') return;
        e.preventDefault();
        setSearchOpen(v => !v);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [activeTab]);

  // 搜索跳转：切页 + 记录定位目标，页面消费后 2s 清空
  const handleSearchJump = useCallback((result: SearchResult) => {
    setSearchOpen(false);
    setActiveTab(result.tab);
    setSearchTarget({ tab: result.tab, key: result.targetKey });
  }, []);

  useEffect(() => {
    if (!searchTarget) return;
    const t = setTimeout(() => setSearchTarget(null), 4000);
    return () => clearTimeout(t);
  }, [searchTarget]);

 // Shared migration confirm — unified across all three migration entry points.
 const confirmMigrate = useCallback(async (info: {
 dirText: string;
 gameName?: string;
 direction: 'xbox_to_steam' | 'steam_to_xbox';
 }): Promise<boolean> => {
 const against = false; // (manual panel has no recommendation to compare against)
 const target = info.gameName ? `《${info.gameName}》` : '所选存档';
 const message = `即将为 ${target} 执行 ${info.dirText} 存档移植。\n\n系统将在覆盖前自动创建 ZIP 压缩备份。${against ? '\n\n⚠️ 您选择的移植方向与推荐相反，可能导致较新的存档被覆盖！' : ''}`;
 return showConfirm({
 title: `确认${info.dirText}存档移植`,
 message,
 confirmLabel: '确认移植',
 variant: 'warning',
 });
 }, [showConfirm]);

 // Quick migrate with pre-inspection: fetch recommendation, show comparison info in confirm dialog,
 // and warn if user is going against the recommended direction.
 const handleQuickMigrate = async (game: GameItem, direction: 'xbox_to_steam' | 'steam_to_xbox') => {
 const dirText = direction === 'xbox_to_steam' ? 'Xbox ➔ Steam' : 'Steam ➔ Xbox';

 // Pre-inspect to get recommendation and comparison info
 let recommendation = 'none';
 let recommendationReason = '';
 try {
 const inspection = await inspectSave(game.id);
 recommendation = inspection.recommendation;
 recommendationReason = inspection.recommendationReason;
 } catch (err: any) {
 addLog(`无法获取《${game.name}》推荐方向: ${err.message}，将按所选方向直接执行`, 'warning');
 }

 const isAgainstRecommendation =
 (recommendation === 'xbox_to_steam' && direction === 'steam_to_xbox') ||
 (recommendation === 'steam_to_xbox' && direction === 'xbox_to_steam');

 const confirmMessage = `即将为《${game.name}》执行 ${dirText} 存档移植。\n\n${recommendationReason || '未检测到推荐方向。'}\n\n系统将在覆盖前自动创建 ZIP 压缩备份。${isAgainstRecommendation ? '\n\n⚠️ 警告：您选择的移植方向与智能推荐相反，可能导致较新的存档被较旧的存档覆盖！' : ''}`;

 const confirmed = await showConfirm({
 title: `确认${dirText}存档移植`,
 message: confirmMessage,
 confirmLabel: '确认移植',
 variant: isAgainstRecommendation ? 'danger' : 'warning',
 });
 if (!confirmed) return;

 beginMigrating();
 addLog(`开始执行《${game.name}》${dirText} 存档移植...`, 'info');

 try {
 const result = await migrateSave({ gameId: game.id, direction });

 if (result.backup) {
 addLog(`[安全备份] 已自动生成 Zip 压缩归档: ${result.backup.backupFileName}`, 'success');
 }

 // Grade by the audit report, not by the HTTP success flag.
 const outcome = migrationOutcome(result.verify, null);
 if (outcome === 'success') {
 addLog(`[移植成功] ${result.message}`, 'success');
 toast(outcomeText(outcome, game.name, result.verify), 'success');
 } else if (outcome === 'needs-review') {
 addLog(`[移植完成·需确认] ${result.message}`, 'warning');
 toast(outcomeText(outcome, game.name, result.verify), 'warning');
 } else {
 addLog(`[移植校验失败] ${result.message}`, 'error');
 toast(outcomeText(outcome, game.name, result.verify), 'error');
 setFailureHeadline(outcomeText(outcome, game.name, result.verify));
 setFailureContext(buildFailureContext(result, {
 game, direction, stage: 'POST /api/migrate', warnings: result.warnings,
 }));
 }
 reportVerify(result);

 // Show cloud sync warnings
 if (result.warnings && result.warnings.length > 0) {
 result.warnings.forEach((w: string) => {
 addLog(`[安全提醒] ${w}`, 'warning');
 toast(w, 'warning');
 });
 }

 loadGames();
 } catch (err: any) {
 addLog(`[移植失败] ${err.message}`, 'error');
 toast(`移植失败: ${err.message}`, 'error');
 setFailureHeadline(`移植失败：${err.message}`);
 setFailureContext(buildFailureContext({ error: err }, {
 game, direction, stage: 'POST /api/migrate',
 }));
 } finally {
 endMigrating();
 }
 };

 const handleModalMigrate = async (
 gameId: string,
 direction: 'xbox_to_steam' | 'steam_to_xbox',
 customSteamPath?: string,
 customXboxPath?: string
 ) => {
 const game = games.find(g => g.id === gameId);
 const dirText = direction === 'xbox_to_steam' ? 'Xbox ➔ Steam' : 'Steam ➔ Xbox';

 // Confirm before executing, consistent with the quick-migrate path.
 const confirmed = await confirmMigrate({ dirText, gameName: game?.name, direction });
 if (!confirmed) return;

 beginMigrating();
 addLog(`正在执行《${game?.name || gameId}》的 ${dirText} 存档移植...`, 'info');

 try {
 const result = await migrateSave({
 gameId,
 direction,
 customSteamPath,
 customXboxPath
 });

 if (result.backup) {
 addLog(`[安全备份] 已自动生成 Zip 压缩归档: ${result.backup.backupFileName}`, 'success');
 }

 // Grade by the audit report, not by the HTTP success flag.
 const outcome = migrationOutcome(result.verify, null);
 if (outcome === 'success') {
 addLog(`[移植成功] ${result.message}`, 'success');
 toast(outcomeText(outcome, game?.name, result.verify), 'success');
 } else if (outcome === 'needs-review') {
 addLog(`[移植完成·需确认] ${result.message}`, 'warning');
 toast(outcomeText(outcome, game?.name, result.verify), 'warning');
 } else {
 addLog(`[移植校验失败] ${result.message}`, 'error');
 toast(outcomeText(outcome, game?.name, result.verify), 'error');
 setFailureHeadline(outcomeText(outcome, game?.name, result.verify));
 setFailureContext(buildFailureContext(result, {
 game, direction, stage: 'POST /api/migrate', warnings: result.warnings,
 }));
 }
 reportVerify(result);

 if (result.warnings && result.warnings.length > 0) {
 result.warnings.forEach((w: string) => {
 addLog(`[安全提醒] ${w}`, 'warning');
 toast(w, 'warning');
 });
 }

 setSelectedGame(null);
 loadGames();
 } catch (err: any) {
 addLog(`[移植失败] ${err.message}`, 'error');
 toast(`移植失败: ${err.message}`, 'error');
 setFailureHeadline(`移植失败：${err.message}`);
 setFailureContext(buildFailureContext({ error: err }, {
 game, direction, stage: 'POST /api/migrate',
 }));
 } finally {
 endMigrating();
 }
 };

 const detectedBothCount = games.filter(g => g.isSteamDetected && g.isXboxDetected).length;

  return (
    <div className="min-h-screen flex">
      {showWelcome && <WelcomeScreen onDismiss={() => { dismissWelcome(); setShowWelcome(false); }} />}

      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onScan={performGlobalScan}
        isScanning={loadingGames || libraryScanning}
        detectedBothCount={detectedBothCount}
        gameCount={games.length}
        libraryCount={libraryGames.filter(g => g.isGame).length}
        backupCount={backupCount}
        aiCount={aiSessionCount}
        onOpenSearch={() => setSearchOpen(true)}
        themeMode={themeMode}
        onCycleTheme={() => {
          const next: ThemeMode = themeMode === 'system' ? 'light' : themeMode === 'light' ? 'dark' : 'system';
          setThemeMode(next);
          applyTheme({ theme: next, accent });
          cacheTheme({ theme: next, accent });
          saveSettings({ appearance: { theme: next, accent } }).catch(() => {});
        }}
      />

      <div className="flex-1 min-w-0 flex flex-col h-screen overflow-hidden">
      <TopBar
        activeTab={activeTab}
        onRefresh={loadGames}
        isRefreshing={loadingGames}
        onOpenLog={() => setLogVisible(true)}
        logCount={logs.length}
      />
      <main className="flex-1 min-w-0 overflow-y-auto pb-32">
      <div
        className="relative max-w-[1100px] mx-auto w-full pt-10 pb-24"
        style={{ paddingLeft: contentPadding, paddingRight: contentPadding }}
        title="拖拽正文左右边缘调整留白"
      >
        {/* 正文左右留白：拖左右边缘即可调（手柄本体在边缘，命中区扩到 ~22px） */}
        <DragHandle layoutKey="contentPadding" edge="left" label="拖动调整正文左边距" />
        <DragHandle layoutKey="contentPadding" edge="right" label="拖动调整正文右边距" />
        {/* Notion 页面标题：大字号 + 一行说明，位于正文顶部 */}
        <div className="mb-8">
          <h1 className="t-page-title">{PAGE_META[activeTab].title}</h1>
          <p className="t-meta mt-1.5">{PAGE_META[activeTab].desc}</p>
        </div>
        {env && !envDismissed && (
          <EnvBanner
            env={env}
            onDismiss={() => setEnvDismissed(true)}
            onFixSteam={async () => {
              const folder = await pickFolder({ title: '选择 Steam 安装目录' });
              if (!folder) return;
              try {
                await saveSettings({ paths: { steamRoot: folder } });
                toast('已保存 Steam 目录，正在重新扫描', 'success');
                await loadEnv();
                await loadGames();
              } catch (e: any) {
                toast(`保存失败：${e.message}`, 'error');
              }
            }}
            onFixXbox={async () => {
              const folder = await pickFolder({ title: '选择 Xbox Packages 目录' });
              if (!folder) return;
              try {
                await saveSettings({ paths: { xboxPackagesRoot: folder } });
                toast('已保存 Xbox 目录，正在重新扫描', 'success');
                await loadEnv();
                await loadGames();
              } catch (e: any) {
                toast(`保存失败：${e.message}`, 'error');
              }
            }}
          />
        )}

 {activeTab === 'games' ? (
 <>
        {/* 页面级快捷入口：常驻在正文顶部，不再藏在页尾 */}
        {activeTab === 'games' && (
          <div className="flex flex-wrap items-center gap-2 mb-5">
            <button
              onClick={() => setShowCustomGameModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-[13px] btn-ghost"
              title="注册数据库里没有的游戏"
            >
              <Plus className="w-4 h-4" />
              添加自定义游戏
            </button>
            <button
              onClick={() => setAdvancedOpen(!advancedOpen)}
              className="flex items-center gap-1.5 px-3 py-2 text-[13px] btn-ghost"
              title="手动指定 WGS 目录进行解包/打包"
            >
              <Wrench className="w-4 h-4" />
              高级 WGS 工具
              {advancedOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={performGlobalScan}
              disabled={loadingGames || libraryScanning}
              className="flex items-center gap-1.5 px-3 py-2 text-[13px] btn-primary disabled:opacity-50"
              title="重新扫描本机存档与 Xbox 游戏库"
            >
              <RefreshCw className={`w-4 h-4 ${loadingGames || libraryScanning ? 'animate-spin' : ''}`} />
              {loadingGames || libraryScanning ? '扫描中…' : '重新扫描'}
            </button>
          </div>
        )}

        {/* 高级 WGS 工具内容：紧跟入口按钮展开，避免被推到页面末尾导致"点了没反应" */}
        {advancedOpen && (
          <div className="mb-5">
            <ManualConverter onAddLog={addLog} />
          </div>
        )}

        {/* Primary entry: pick a save folder → identify → one-click migrate */}
        <IdentifyMigratePanel
 onAddLog={addLog}
 onMigrated={loadGames}
 isMigrating={isMigrating}
 onConfirmMigrate={confirmMigrate}
 onMigratingChange={setIsMigrating}
          onPreviewGame={(gameId) => {
            const g = games.find(x => x.id === gameId);
            if (g) setTestGame(g);
          }}
          onFailure={(f) => {
            const ctx = f.error
              ? buildFailureContext({ error: f.error }, {
                  direction: f.direction,
                  stage: 'POST /api/manual/migrate',
                  code: f.code || null,
                  gameName: f.gameName || null,
                })
              : buildFailureContext({ verify: f.verify as any, message: f.message }, {
                  direction: f.direction,
                  stage: 'POST /api/manual/migrate',
                  code: f.code || null,
                  gameName: f.gameName || null,
                });
            setFailureHeadline(f.message || (f.error instanceof Error ? `移植失败：${f.error.message}` : '移植未成功'));
            setFailureContext(ctx);
          }}
        />

 {/* Discovered saves on this PC */}
 <div className="mt-6">
          <GameGrid
            games={games}
            onSelectGame={setSelectedGame}
            onQuickMigrate={handleQuickMigrate}
            onTestGame={setTestGame}
            isMigrating={isMigrating}
            highlightKey={searchTarget?.tab === 'games' ? searchTarget.key : null}
          />
 </div>

        </>
      ) : activeTab === 'backups' ? (
 <BackupManager onAddLog={addLog} />
 ) : activeTab === 'xbox' ? (
          <XboxLibraryPanel
            onAddLog={addLog}
            games={libraryGames}
            scanning={libraryScanning}
            hasScanned={libraryScanned}
            onForceRefresh={() => loadLibrary(true)}
            highlightKey={searchTarget?.tab === 'xbox' ? searchTarget.key : null}
          />
        ) : activeTab === 'ai' ? (
          <AiPanel
            pendingSession={aiPending}
            onPendingConsumed={() => setAiPending(null)}
            onCountChange={setAiSessionCount}
          />
        ) : (
          <SettingsPanel
            onAddLog={addLog}
            themeMode={themeMode}
            accent={accent}
            onThemeChange={(mode) => {
              setThemeMode(mode);
              applyTheme({ theme: mode, accent });
              cacheTheme({ theme: mode, accent });
            }}
            onAccentChange={(next) => {
              setAccent(next);
              applyTheme({ theme: themeMode, accent: next });
              cacheTheme({ theme: themeMode, accent: next });
            }}
          />
        )}
      </div>
      </main>
      </div>

 <SaveComparisonModal
 game={selectedGame}
 onClose={() => setSelectedGame(null)}
 onMigrate={handleModalMigrate}
 isMigrating={isMigrating}
 />

 <PortabilityModal
 game={testGame}
 onClose={() => setTestGame(null)}
 />

 <CustomGameModal
 visible={showCustomGameModal}
 onClose={() => setShowCustomGameModal(false)}
 onSaved={() => {
 setShowCustomGameModal(false);
 loadGames();
 }}
 onAddLog={addLog}
 />

      {failureContext && (
        <FailureAssistantModal
          context={failureContext}
          headline={failureHeadline}
          recentLogs={logs.slice(0, 30).map(l => ({ type: l.type, message: l.message }))}
          onClose={() => setFailureContext(null)}
          onGotoSettings={() => { setFailureContext(null); setActiveTab('settings'); }}
          onGotoBackups={() => { setFailureContext(null); setActiveTab('backups'); }}
          onContinueInPanel={(payload) => {
            setAiPending(payload);
            setActiveTab('ai');
            setFailureContext(null);
          }}
        />
      )}

      <SearchPalette
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        games={games}
        libraryGames={libraryGames}
        onJump={handleSearchJump}
      />

      {confirmConfig && (
        <ConfirmDialog
          {...confirmConfig}
          onConfirm={handleConfirm}
          onCancel={handleCancelConfirm}
        />
      )}

 {logVisible && (
 <LogConsole logs={logs} onClear={() => setLogs([])} onClose={() => setLogVisible(false)} />
 )}

 {!logVisible && (
 <button
 onClick={() => setLogVisible(true)}
 className="fixed bottom-4 right-4 z-40 px-3 py-2 text-[12px] font-semibold rounded-card glass-panel text-ink-text hover:text-ink-text transition-colors flex items-center gap-1.5"
 title="打开运行日志"
 >
 <Terminal className="w-3.5 h-3.5" />
 <span>日志 ({logs.length})</span>
 </button>
 )}
 </div>
 );
};

export default App;