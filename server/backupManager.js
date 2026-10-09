import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { execFile } from 'child_process';

const BACKUP_ROOT = path.join(process.cwd(), 'Backups');

if (!fs.existsSync(BACKUP_ROOT)) {
  fs.mkdirSync(BACKUP_ROOT, { recursive: true });
}

/**
 * Creates a timestamped ZIP backup of a folder (Steam or Xbox WGS).
 * @param {string} sourceFolderPath Folder to backup
 * @param {string} gameId Identifier of the game
 * @param {'steam' | 'xbox'} platform Platform source
 */
export function createBackup(sourceFolderPath, gameId, platform) {
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
      resolve({
        backupFileName: zipName,
        backupPath: zipPath,
        size: archive.pointer(),
        timestamp: new Date().toISOString()
      });
    });

    archive.on('error', (err) => reject(err));

    archive.pipe(output);
    archive.directory(sourceFolderPath, false);
    archive.finalize();
  });
}

/**
 * Lists all existing backups in the Backups folder.
 */
export function listBackups() {
  if (!fs.existsSync(BACKUP_ROOT)) return [];

  const files = fs.readdirSync(BACKUP_ROOT).filter(f => f.endsWith('.zip'));
  return files.map(file => {
    const fullPath = path.join(BACKUP_ROOT, file);
    const stats = fs.statSync(fullPath);
    return {
      fileName: file,
      filePath: fullPath,
      size: stats.size,
      createdAt: stats.birthtime || stats.mtime
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

/** Restore a ZIP backup into a target directory using Windows Expand-Archive. */
export function restoreBackup(backupFilePath, targetFolderPath) {
  const zipPath = assertBackupPath(backupFilePath);
  if (!targetFolderPath) throw new Error('未指定恢复目标目录');
  const target = path.resolve(targetFolderPath);
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });

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

export function deleteBackup(filePath) {
  const zipPath = assertBackupPath(filePath);
  fs.unlinkSync(zipPath);
  return { filePath: zipPath };
}
