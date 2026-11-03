import { GameItem, BackupItem, VerifyReport, IdentifiedInfo, PortabilityReport, XboxInstalledGame, XboxCloudSyncStopResult } from '../types';

const API_BASE = typeof window !== 'undefined' && window.location.protocol === 'file:'
  ? 'http://localhost:3001'
  : '';

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, options);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Request failed');
  return data;
}

export async function fetchGames(): Promise<{ steamDetected: boolean; steamDirs?: string[]; steamUserCount?: number; games: GameItem[] }> {
  return apiFetch('/api/games');
}

export async function openFolder(folderPath: string) {
  return apiFetch('/api/open-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderPath }),
  });
}

export async function inspectSave(gameId: string) {
  return apiFetch('/api/inspect-save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId }),
  });
}

// Resolve both platform save paths for an identified game (auto-fill the
// counterpart side of a manual migration).
export async function resolveCounterpart(gameId: string) {
  return apiFetch('/api/resolve-counterpart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId }),
  });
}

// One-shot: identify a source path, auto-fill the counterpart, and migrate.
export async function identifyAndMigrate(params: {
  sourcePath: string;
  direction: 'xbox_to_steam' | 'steam_to_xbox';
}): Promise<{
  success: boolean;
  message: string;
  identified?: IdentifiedInfo;
  warnings?: string[];
  backup?: { backupFileName: string } | null;
  verify?: VerifyReport;
  result?: any;
}> {
  return apiFetch('/api/identify-and-migrate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export async function migrateSave(params: {
  gameId: string;
  direction: 'xbox_to_steam' | 'steam_to_xbox';
  customSteamPath?: string;
  customXboxPath?: string;
}): Promise<{
  success: boolean;
  message: string;
  warnings?: string[];
  backup?: { backupFileName: string } | null;
  verify?: VerifyReport;
  result?: any;
}> {
  return apiFetch('/api/migrate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export async function fetchBackups(): Promise<BackupItem[]> {
  const data = await apiFetch('/api/backups');
  return data.backups;
}

export async function restoreBackupApi(backupPath: string, targetFolderPath: string) {
  return apiFetch('/api/backups/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backupPath, targetFolderPath }),
  });
}

export async function deleteBackupApi(backupPath: string) {
  return apiFetch('/api/backups', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backupPath }),
  });
}

export async function openBackupFolder(backupPath: string) {
  return apiFetch('/api/backups/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backupPath }),
  });
}

export async function manualExtractWgs(wgsFolderPath: string, outputFolderPath: string) {
  return apiFetch('/api/manual/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wgsFolderPath, outputFolderPath }),
  });
}

export async function manualPackWgs(inputFolderPath: string, targetWgsFolderPath: string, packageName?: string) {
  return apiFetch('/api/manual/pack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputFolderPath, targetWgsFolderPath, packageName }),
  });
}

export async function manualMigrateSave(params: {
  steamPath: string;
  xboxPath: string;
  direction: 'xbox_to_steam' | 'steam_to_xbox';
}): Promise<{
  success: boolean;
  message: string;
  warnings?: string[];
  backup?: { backupFileName: string } | null;
  verify?: VerifyReport;
  result?: any;
}> {
  return apiFetch('/api/manual/migrate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

// Side-agnostic copy: source and target each carry their own side, so the
// same endpoint covers all four cross-platform cases incl. same-side copies
// (multi-account / multi-instance / cross-machine restore).
export async function copySave(params: {
  sourcePath: string;
  sourceSide: 'xbox' | 'steam';
  targetPath: string;
  targetSide: 'xbox' | 'steam';
  targetSteamAppId?: string;
}): Promise<{
  success: boolean;
  message: string;
  warnings?: string[];
  backup?: { backupFileName: string } | null;
  verify?: VerifyReport;
  result?: any;
}> {
  return apiFetch('/api/copy-save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export async function identifySave(savePath: string) {
  return apiFetch('/api/identify-save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ savePath }),
  });
}

// Read-only portability prediction ("移植测试/预演"): dry-runs the real
// writer for both directions and reports what would land where without
// writing anything. Safe to call repeatedly.
export async function portabilityReport(params: {
  gameId: string;
  customSteamPath?: string;
  customXboxPath?: string;
}): Promise<PortabilityReport> {
  const data = await apiFetch('/api/portability-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return data as unknown as PortabilityReport;
}

// Native dialogs: in the Electron build the renderer calls window.zcode
// (preload bridge → main process → dialog.showOpenDialog). That path shows
// the Windows folder/file picker in under 100ms, vs ~1s for the PowerShell +
// .NET Forms path the API fallback uses. The browser-mode fallback is kept
// so the dev server / non-Electron users still get a working picker.
declare global {
  interface Window { zcode?: { pickFolder: (opts?: any) => Promise<{ canceled: boolean; path?: string }>; pickFile: (opts?: any) => Promise<{ canceled: boolean; path?: string }>; openFolder: (p: string) => Promise<boolean>; isElectron: boolean } }
}

export async function pickFolder(opts: { title?: string; defaultPath?: string } = {}): Promise<string> {
  if (typeof window !== 'undefined' && window.zcode?.pickFolder) {
    const r = await window.zcode.pickFolder(opts);
    if (r.canceled || !r.path) throw new Error('已取消');
    return r.path;
  }
  const data = await apiFetch('/api/pick-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  return data.path;
}

export async function pickFile(opts: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] } = {}): Promise<string> {
  if (typeof window !== 'undefined' && window.zcode?.pickFile) {
    const r = await window.zcode.pickFile(opts);
    if (r.canceled || !r.path) throw new Error('已取消');
    return r.path;
  }
  const data = await apiFetch('/api/pick-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  return data.path;
}

export async function fetchCustomGames() {
  return apiFetch('/api/custom-games');
}

export async function addCustomGameApi(game: {
  name: string;
  steamSaveRelPath?: string;
  xboxPackageName?: string;
  steamAppId?: string;
  saveFilePattern?: string;
  notes?: string;
  processNames?: string[];
}) {
  return apiFetch('/api/custom-games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(game),
  });
}

export async function deleteCustomGameApi(id: string) {
  return apiFetch(`/api/custom-games/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ===== Xbox 游戏库：扫描 / AUMID 直启 / 运行检测 / 云存档同步控制 =====

export async function fetchXboxLibrary(refresh = false): Promise<{ games: XboxInstalledGame[] }> {
  return apiFetch(`/api/xbox/library${refresh ? '?refresh=1' : ''}`);
}

export async function launchXboxGame(aumid: string): Promise<{ launched: boolean }> {
  return apiFetch('/api/xbox/launch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aumid }),
  });
}

export async function checkXboxGameRunning(installLocation: string): Promise<{ running: boolean; matchedNames: string[] }> {
  return apiFetch('/api/xbox/check-running', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ installLocation }),
  });
}

export async function stopXboxCloudSync(): Promise<XboxCloudSyncStopResult> {
  return apiFetch('/api/xbox/stop-cloud-sync', { method: 'POST' });
}
