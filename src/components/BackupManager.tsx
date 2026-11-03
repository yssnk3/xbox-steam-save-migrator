import React, { useEffect, useState } from 'react';
import { BackupItem } from '../types';
import { fetchBackups, restoreBackupApi, deleteBackupApi, openBackupFolder, pickFolder } from '../services/api';
import { useToast } from './Toast';
import { ConfirmDialog, ConfirmDialogConfig } from './ConfirmDialog';
import { ShieldCheck, RefreshCw, FileArchive, RotateCcw, Trash2, Folder } from 'lucide-react';

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
    } catch (err: any) {
      toast(`加载备份列表失败: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBackups();
  }, []);

  const handleRestore = async (item: BackupItem) => {
    try {
      const targetPath = await pickFolder();
      if (!targetPath) return;

      setConfirmConfig({
        title: '确认恢复备份',
        message: `即将把备份 ${item.fileName} 解压恢复到目录：\n${targetPath}\n\n这会覆盖目标目录中的同名文件。是否继续？`,
        confirmLabel: '恢复',
        variant: 'warning',
      });
      setConfirmAction(async () => {
        try {
          await restoreBackupApi(item.filePath, targetPath);
          onAddLog(`备份恢复成功：${item.fileName} → ${targetPath}`, 'success');
          toast('备份恢复成功！', 'success');
        } catch (err: any) {
          onAddLog(`备份恢复失败: ${err.message}`, 'error');
          toast(`恢复失败: ${err.message}`, 'error');
        }
      });
    } catch (err: any) {
      toast(`无法选择目录: ${err.message}`, 'error');
    }
  };

  const handleDelete = async (item: BackupItem) => {
    setConfirmConfig({
      title: '确认删除备份',
      message: `即将永久删除备份文件 ${item.fileName}。\n此操作不可撤销。是否继续？`,
      confirmLabel: '删除',
      variant: 'danger',
    });
    setConfirmAction(async () => {
      try {
        await deleteBackupApi(item.filePath);
        onAddLog(`备份已删除：${item.fileName}`, 'info');
        toast('备份已删除', 'success');
        loadBackups();
      } catch (err: any) {
        onAddLog(`删除备份失败: ${err.message}`, 'error');
        toast(`删除失败: ${err.message}`, 'error');
      }
    });
  };

  const handleOpenFolder = async (item: BackupItem) => {
    try {
      await openBackupFolder(item.filePath);
    } catch (err: any) {
      toast(`无法打开目录: ${err.message}`, 'error');
    }
  };

  const handleConfirm = async () => {
    setConfirmConfig(null);
    if (confirmAction) await confirmAction();
    setConfirmAction(null);
  };

  return (
    <div className="space-y-6">
      
      {/* Header Info */}
      <div className="glass-panel p-6 rounded-2xl border border-zinc-800 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-card bg-ink-surface/[0.06] border border-white/[0.1] flex items-center justify-center text-zinc-300">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-bold text-base text-white">安全备份管理中心</h2>
            <p className="text-xs text-zinc-400">
              每次执行存档移植前自动创建的 ZIP 压缩归档，可在此恢复或删除
            </p>
          </div>
        </div>

        <button
          onClick={loadBackups}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${loading ? 'animate-spin' : ''}`} />
          刷新备份列表
        </button>
      </div>

      {/* Backup List */}
      <div className="glass-panel rounded-2xl border border-zinc-800 overflow-hidden">
        {backups.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <FileArchive className="w-10 h-10 text-zinc-600 mx-auto" />
            <h3 className="text-sm font-semibold text-zinc-300">暂无备份文件</h3>
            <p className="text-xs text-zinc-500">
              当您在"游戏存档图鉴"中执行存档移植时，原目录文件将被自动安全备份至本地。
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/80">
            {backups.map((item, idx) => (
              <div key={idx} className="p-4 hover:bg-zinc-900/50 transition-colors flex items-center justify-between text-xs gap-4">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <FileArchive className="w-5 h-5 text-emerald-400 shrink-0" />
                  <div className="min-w-0">
                    <span className="font-mono font-medium text-zinc-200 block text-xs truncate">
                      {item.fileName}
                    </span>
                    <span className="text-[11px] text-zinc-500 font-mono block truncate">
                      {new Date(item.createdAt).toLocaleString('zh-CN')} · {formatBytes(item.size)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleRestore(item)}
                    className="p-2 rounded-card text-zinc-400 hover:text-white hover:bg-ink-surface/[0.06] transition-colors"
                    title="恢复备份到指定目录"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleOpenFolder(item)}
                    className="p-2 rounded-card text-zinc-400 hover:text-white hover:bg-ink-surface/[0.06] transition-colors"
                    title="在资源管理器中打开"
                  >
                    <Folder className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(item)}
                    className="p-2 rounded-card text-red-400 hover:bg-red-950/60 transition-colors"
                    title="删除备份"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

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
