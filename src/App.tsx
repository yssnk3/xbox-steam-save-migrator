import React, { useEffect, useState, useCallback, useRef } from 'react';
import { GameItem, LogEntry } from './types';
import { fetchGames, migrateSave, inspectSave } from './services/api';
import { migrationOutcome, outcomeText } from './utils/migrationOutcome';
import { Header } from './components/Header';
import { GameGrid } from './components/GameGrid';
import { SaveComparisonModal } from './components/SaveComparisonModal';
import { PortabilityModal } from './components/PortabilityModal';
import { BackupManager } from './components/BackupManager';
import XboxLibraryPanel from './components/XboxLibraryPanel';
import { ManualConverter } from './components/ManualConverter';
import { IdentifyMigratePanel } from './components/IdentifyMigratePanel';
import { LogConsole } from './components/LogConsole';
import { CustomGameModal } from './components/CustomGameModal';
import { ConfirmDialog, ConfirmDialogConfig } from './components/ConfirmDialog';
import { WelcomeScreen, isWelcomeDismissed, dismissWelcome } from './components/WelcomeScreen';
import { useToast } from './components/Toast';
import { Plus, Wrench, ChevronDown, ChevronUp, Terminal } from 'lucide-react';

export const App: React.FC = () => {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<'games' | 'backups' | 'xbox'>('games');
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

  useEffect(() => {
    loadGames();
  }, []);

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
    } finally {
      endMigrating();
    }
  };

  const detectedBothCount = games.filter(g => g.isSteamDetected && g.isXboxDetected).length;

  return (
    <div className="min-h-screen flex flex-col">
      {showWelcome && <WelcomeScreen onDismiss={() => { dismissWelcome(); setShowWelcome(false); }} />}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onRefresh={loadGames}
        isRefreshing={loadingGames}
        detectedBothCount={detectedBothCount}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto p-6 pb-32">
        {activeTab === 'games' ? (
          <>
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
            />

            {/* Discovered saves on this PC */}
            <div className="mt-6">
              <GameGrid
                games={games}
                onSelectGame={setSelectedGame}
                onQuickMigrate={handleQuickMigrate}
                onTestGame={setTestGame}
                isMigrating={isMigrating}
              />
            </div>

            {/* Add-custom-game + advanced WGS tools */}
            <div className="flex flex-col gap-3 mt-6">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <button
                  onClick={() => setShowCustomGameModal(true)}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl bg-ink-surface/[0.04] hover:bg-ink-surface/[0.08] border border-white/[0.08] text-zinc-300 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>添加自定义游戏</span>
                </button>

                <button
                  onClick={() => setAdvancedOpen(!advancedOpen)}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl bg-ink-surface/[0.04] hover:bg-ink-surface/[0.08] border border-white/[0.08] text-zinc-300 transition-colors"
                >
                  <Wrench className="w-4 h-4" />
                  <span>高级 WGS 工具</span>
                  {advancedOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
              </div>

              {advancedOpen && (
                <div>
                  <ManualConverter onAddLog={addLog} />
                </div>
              )}
            </div>
          </>
        ) : activeTab === 'backups' ? (
          <BackupManager onAddLog={addLog} />
        ) : (
          <XboxLibraryPanel onAddLog={addLog} />
        )}
      </main>

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
          className="fixed bottom-4 right-4 z-40 px-3 py-2 text-xs font-semibold rounded-card glass-panel text-zinc-300 hover:text-white transition-colors flex items-center gap-1.5"
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