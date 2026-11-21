import React, { useEffect, useState } from 'react';
import { BackupItem } from '../types';
import { fetchBackups, restoreBackupApi, restoreBackupAutoApi, deleteBackupApi, openBackupFolder, pickFolder } from '../services/api';
import { useToast } from './Toast';
import { ConfirmDialog, ConfirmDialogConfig } from './ConfirmDialog';
import { ShieldCheck, RefreshCw, FileArchive, RotateCcw, Trash2, Folder, CornerDownLeft } from 'lucide-react';

interface BackupManagerProps {
  onAddLog: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/** Which side the backup protects — shown so users know what restoring will overwrite. */
const PLATFORM_LABEL: Record<string, string> = { steam: 'Steam', xbox: 'Xbox' };

const DIRECTION_LABEL: Record<string, string> = {
  xbox_to_steam: 'Xbox → Steam',
  steam_to_xbox: 'Steam → Xbox',
  xbox_to_xbox: 'Xbox 同端复制',
  steam_to_steam: 'Steam 同端复制',
  pack: '手动打包',
};

interface VersionGroup {
  key: string;
  title: string;
  subtitle: string;
  items: BackupItem[];
}

/** Group backups by game (or by origin for legacy/unknown ones), newest first = version list. */
function groupBackups(backups: BackupItem[]): VersionGroup[] {
  const groups = new Map<string, VersionGroup>();
  for (const b of backups) {
    const key = b.gameId || '__unknown__';
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        title: b.gameName || (b.gameId && b.gameId !== 'identify' ? b.gameId : '未识别来源'),
        subtitle: b.meta ? '含元数据，可一键还原' : '旧版备份（无元数据）',
        items: [],
      });
    }
    groups.get(key)!.items.push(b);
  }
  // Newest group first, and versions within a group are already newest-first.
  return [...groups.values()].sort(
    (a, b) => new Date(b.items[0].createdAt).getTime() - new Date(a.items[0].createdAt).getTime(),
  );
}

export const BackupManager: React.FC<BackupManagerProps> = ({ onAddLog }) => {
  const toast = useToast();
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<ConfirmDialogConfig | null>(null);
  const [confirmAction, setConfirmAction] = useState<(() => Promise<void>) | null>(null);

  const loadBackups = async () => {
    setLoading(true);
    try {
      const data = await fetchBackups();
      setBackups(data);
    } catch (err) {
      toast(`加载备份列表失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBackups();
  }, []);

  /** One-click rollback to the recorded target directory. */
  const handleAutoRestore = async (item: BackupItem) => {
    setConfirmConfig({
      title: '还原到原位置',
      message: `即将把 ${item.fileName} 解压回它备份时的目录：\n\n${item.restoreTargetPath}\n\n这会覆盖该目录中的同名文件，等同于撤销那一次移植。\n\n⚠️ 还原后若游戏自动同步云端旧档，可能立刻再次覆盖；首次启动遇到云冲突请选择「使用本地存档」。是否继续？`,
      confirmLabel: '还原',
      variant: 'warning',
    });
    setConfirmAction(async () => {
      try {
        await restoreBackupAutoApi(item.filePath);
        onAddLog(`已还原到原位置：${item.fileName} → ${item.restoreTargetPath}`, 'success');
        toast('还原成功，存档已回到移植前状态', 'success');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        onAddLog(`还原失败: ${msg}`, 'error');
        toast(`还原失败: ${msg}`, 'error');
      }
    });
  };

  /** Legacy path: no sidecar, so the user picks the destination. */
  const handleManualRestore = async (item: BackupItem) => {
    try {
      const targetPath = await pickFolder();
      if (!targetPath) return;

      setConfirmConfig({
        title: '选择目录还原',
        message: `该备份没有记录原目标路径。\n\n即将把 ${item.fileName} 解压到：\n${targetPath}\n\n这会覆盖目标目录中的同名文件。是否继续？`,
        confirmLabel: '还原',
        variant: 'warning',
      });
      setConfirmAction(async () => {
        try {
          await restoreBackupApi(item.filePath, targetPath);
          onAddLog(`备份已还原：${item.fileName} → ${targetPath}`, 'success');
          toast('备份还原成功', 'success');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          onAddLog(`还原失败: ${msg}`, 'error');
          toast(`还原失败: ${msg}`, 'error');
        }
      });
    } catch (err) {
      toast(`无法选择目录: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const handleDelete = async (item: BackupItem) => {
    setConfirmConfig({
      title: '确认删除备份',
      message: `即将永久删除备份文件 ${item.fileName}。\n此操作不可撤销，删除后无法再还原到该版本。是否继续？`,
      confirmLabel: '删除',
      variant: 'danger',
    });
    setConfirmAction(async () => {
      try {
        await deleteBackupApi(item.filePath);
        onAddLog(`备份已删除：${item.fileName}`, 'info');
        toast('备份已删除', 'success');
        loadBackups();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        onAddLog(`删除备份失败: ${msg}`, 'error');
        toast(`删除失败: ${msg}`, 'error');
      }
    });
  };

  const handleOpenFolder = async (item: BackupItem) => {
    try {
      await openBackupFolder(item.filePath);
    } catch (err) {
      toast(`无法打开目录: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const handleConfirm = async () => {
    setConfirmConfig(null);
    if (confirmAction) await confirmAction();
    setConfirmAction(null);
  };

  const groups = groupBackups(backups);

  return (
    <div className="space-y-4">

      {/* 工具行：页面标题在上方，这里只留操作 */}
      <div className="flex items-center justify-between gap-4">
        <span className="t-meta">共 {backups.length} 个备份版本</span>
        <button
          onClick={loadBackups}
          disabled={loading}
          className="btn-ghost px-2.5 py-1.5 text-[13px] flex items-center gap-1.5 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {backups.length === 0 ? (
        <div className="panel px-4 py-14 text-center">
          <FileArchive className="w-7 h-7 text-ink-faint mx-auto mb-3" />
          <p className="text-[14px] text-ink-muted">暂无备份</p>
          <p className="t-meta mt-1">执行一次存档移植后，原文件会自动备份到此处</p>
        </div>
      ) : (
        groups.map(group => (
          <section key={group.key} className="panel overflow-hidden">
            {/* Group header */}
            <header className="px-4 py-3 border-b border-ink-borderSoft flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[14px] font-medium text-ink-text truncate">{group.title}</h3>
                <p className="t-meta mt-0.5">
                  {group.subtitle} · 共 {group.items.length} 个版本
                </p>
              </div>
            </header>

            <ul className="divide-y divide-ink-borderSoft">
              {group.items.map((item, idx) => (
                <li key={item.filePath} className="px-4 py-2.5 flex items-center gap-3 hover:bg-ink-hover transition-colors">
                  {/* Version tag */}
                  <span className="badge bg-ink-elevated text-ink-muted font-mono shrink-0">
                    v{group.items.length - idx}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[12px] text-ink-text truncate max-w-[30ch]">
                        {item.fileName}
                      </span>
                      <span className="t-meta">
                        {[
                          item.platform ? (PLATFORM_LABEL[item.platform] || item.platform) : null,
                          item.direction ? DIRECTION_LABEL[item.direction] : null,
                        ].filter(Boolean).join(' · ')}
                      </span>
                      {item.canAutoRestore && (
                        <span className="badge bg-ink-success-soft text-ink-success">可还原</span>
                      )}
                    </div>
                    <div className="t-meta mt-0.5 truncate">
                      {new Date(item.createdAt).toLocaleString('zh-CN')} · {formatBytes(item.size)}
                      {item.restoreTargetPath ? ` · ${item.restoreTargetPath}` : ''}
                    </div>
                    
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {item.canAutoRestore ? (
                      <button
                        onClick={() => handleAutoRestore(item)}
                        className="btn-ghost px-2.5 py-1 text-[12px] flex items-center gap-1.5"
                        title="还原到备份时记录的目录（撤销那次移植）"
                      >
                        <CornerDownLeft className="w-3 h-3" />
                        还原
                      </button>
                    ) : (
                      <button
                        onClick={() => handleManualRestore(item)}
                        className="btn-ghost px-2.5 py-1 text-[12px] flex items-center gap-1.5"
                        title="该备份无元数据，需手动选择目标目录"
                      >
                        <RotateCcw className="w-3 h-3" />
                        选择目录还原
                      </button>
                    )}
                    <button
                      onClick={() => handleOpenFolder(item)}
                      className="p-1.5 rounded-btn text-ink-faint hover:text-ink-text hover:bg-ink-hover transition-colors"
                      title="在资源管理器中显示"
                    >
                      <Folder className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(item)}
                      className="p-1.5 rounded-btn text-ink-faint hover:text-ink-danger hover:bg-ink-hover transition-colors"
                      title="删除该版本"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {confirmConfig && (
        <ConfirmDialog
          {...confirmConfig}
          onConfirm={handleConfirm}
          onCancel={() => { setConfirmConfig(null); setConfirmAction(null); }}
        />
      )}

    </div>
  );
};
