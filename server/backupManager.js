import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { execFile } from 'child_process';
import { getBackupRoot } from './dataDir.js';

const BACKUP_ROOT = getBackupRoot();

if (!fs.existsSync(BACKUP_ROOT)) {
  fs.mkdirSync(BACKUP_ROOT, { recursive: true });
}

/** Sidecar next to each zip, carrying where it came from and where to restore. */
function sidecarPath(zipPath) {
  return zipPath.replace(/\.zip$/i, '.json');
}

/**
 * Creates a timestamped ZIP backup of a folder (Steam or Xbox WGS).
 *
 * A sibling .json sidecar records what the zip alone cannot express: which
 * game/direction produced it and — crucially — the directory it should be
 * restored into. Without that, "还原" would need the user to re-pick a folder
 * and could silently restore into the wrong place.
 *
 * @param {string} sourceFolderPath Folder to backup
 * @param {string} gameId Identifier of the game
 * @param {'steam' | 'xbox'} platform Platform whose files are being archived
 * @param {object} meta { restoreTargetPath, direction, gameName }
 */
export function createBackup(sourceFolderPath, gameId, platform, meta = {}) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(sourceFolderPath)) {
      return reject(new Error(`Source path does not exist for backup: ${sourceFolderPath}`));
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const zipName = `backup_${gameId}_${platform}_${timestamp}.zip`;
    const zipPath = path.join(BACKUP_ROOT, zipName);

    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      const info = {
        gameId,
        platform,
        sourcePath: sourceFolderPath,
        restoreTargetPath: meta.restoreTargetPath || sourceFolderPath,
        direction: meta.direction || null,
        gameName: meta.gameName || null,
        createdAt: new Date().toISOString(),
        size: archive.pointer(),
      };
      try {
        fs.writeFileSync(sidecarPath(zipPath), JSON.stringify(info, null, 2), 'utf8');
      } catch {
        // A missing sidecar only degrades the UI to manual-restore; never fail the backup.
      }
      resolve({
        backupFileName: zipName,
        backupPath: zipPath,
        size: archive.pointer(),
        timestamp: new Date().toISOString(),
        meta: info,
      });
    });

    archive.on('error', (err) => reject(err));

    archive.pipe(output);
    archive.directory(sourceFolderPath, false);
    archive.finalize();
  });
}

function readSidecar(zipPath) {
  try {
    const p = sidecarPath(zipPath);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Lists all existing backups in the Backups folder.
 * Backups written before sidecars existed come back with `meta: null` and the
 * UI falls back to the manual "pick a folder" restore flow.
 */
export function listBackups() {
  if (!fs.existsSync(BACKUP_ROOT)) return [];

  const files = fs.readdirSync(BACKUP_ROOT).filter(f => f.toLowerCase().endsWith('.zip'));
  return files.map(file => {
    const fullPath = path.join(BACKUP_ROOT, file);
    const stats = fs.statSync(fullPath);
    const meta = readSidecar(fullPath);
    return {
      fileName: file,
      filePath: fullPath,
      size: stats.size,
      createdAt: stats.birthtime || stats.mtime,
      meta,
      gameId: meta?.gameId || null,
      gameName: meta?.gameName || null,
      platform: meta?.platform || null,
      direction: meta?.direction || null,
      restoreTargetPath: meta?.restoreTargetPath || null,
      canAutoRestore: Boolean(meta?.restoreTargetPath),
    };
  }).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

function assertBackupPath(filePath) {
  const resolved = path.resolve(filePath || '');
  const root = path.resolve(BACKUP_ROOT) + path.sep;
  if (!resolved.startsWith(root) || !resolved.toLowerCase().endsWith('.zip')) {
    throw new Error('备份文件路径无效');
  }
  if (!fs.existsSync(resolved)) throw new Error('备份文件不存在');
  return resolved;
}

/** Expand a ZIP into a target directory (Windows Expand-Archive). */
function expandInto(zipPath, target) {
  if (process.platform !== 'win32') {
    throw new Error('备份恢复目前需要 Windows 系统的 Expand-Archive');
  }
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${target.replace(/'/g, "''")}' -Force`
    ], { windowsHide: true }, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr.trim() || error.message));
      resolve({ backupPath: zipPath, targetFolderPath: target });
    });
  });
}

/** Restore a ZIP backup into an explicitly chosen directory. */
export function restoreBackup(backupFilePath, targetFolderPath) {
  const zipPath = assertBackupPath(backupFilePath);
  if (!targetFolderPath) throw new Error('未指定恢复目标目录');
  const target = path.resolve(targetFolderPath);
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
  return expandInto(zipPath, target);
}

/**
 * Restore using the directory recorded in the sidecar — the "还原到原位置"
 * path. Throws when the sidecar is missing so the caller can fall back to
 * asking the user for a folder.
 */
export function restoreBackupAuto(backupFilePath) {
  const zipPath = assertBackupPath(backupFilePath);
  const meta = readSidecar(zipPath);
  if (!meta || !meta.restoreTargetPath) {
    throw new Error('该备份没有记录还原目标路径（旧版备份），请手动选择目标目录');
  }
  const target = path.resolve(meta.restoreTargetPath);
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
  return expandInto(zipPath, target).then(r => ({ ...r, auto: true, meta }));
}

export function deleteBackup(filePath) {
  const zipPath = assertBackupPath(filePath);
  fs.unlinkSync(zipPath);
  // Remove the sidecar too — a stray .json would resurrect a phantom entry.
  try {
    const p = sidecarPath(zipPath);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {}
  return { filePath: zipPath };
}

/**
 * Keep only the newest `keepCount` backups, deleting older ones (zip + sidecar).
 * @returns {{ deleted: string[], kept: number }}
 */
export function pruneBackups(keepCount) {
  const limit = Number(keepCount);
  if (!Number.isFinite(limit) || limit < 1) return { deleted: [], kept: listBackups().length };

  const all = listBackups();
  if (all.length <= limit) return { deleted: [], kept: all.length };

  const doomed = all.slice(limit);
  const deleted = [];
  for (const item of doomed) {
    try {
      deleteBackup(item.filePath);
      deleted.push(item.fileName);
    } catch {
      // Keep pruning the rest even if one file is locked.
    }
  }
  return { deleted, kept: all.length - deleted.length };
}
