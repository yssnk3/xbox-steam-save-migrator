import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { getDataFilePath } from './dataDir.js';
import { readSettings } from './settingsStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Steam Locator — robust discovery of Steam install paths, library folders,
 * and logged-in users: DiscoverSteamInstallPaths / ParseSteamUsers /
 * libraryfolders.vdf parsing, to close the scan-coverage gap.
 */

// Read a single string value from the Windows registry via `reg query`.
function readRegistryValue(keyPath, valueName) {
  try {
    const cmd = `reg query "${keyPath}" /v ${valueName}`;
    const out = execSync(cmd, { encoding: 'utf8', timeout: 5000 });
    // Output lines look like: "    SteamPath    REG_SZ    C:\Program Files (x86)\Steam"
    const m = out.match(/REG_SZ\s+(.+)/i);
    if (m) return m[1].trim();
  } catch {
    // Key missing or reg unavailable — fall through to other discovery methods.
  }
  return null;
}

/**
 * Discover all Steam installation directories.
 * Order of authority: registry (HKCU SteamPath, HKLM InstallPath) → fixed-drive
 * common locations → custom_paths.txt. Returns deduplicated, existence-checked paths.
 */
export function discoverSteamInstallPaths() {
  const rawPaths = [];

  // 0. 用户手动指定的根目录优先（设置页写入）——自动探测失败时的兜底
  try {
    const override = readSettings().paths?.steamRoot;
    if (override) rawPaths.push(override);
  } catch {
    // settings unavailable — keep probing
  }

  // 1. Registry HKCU\Software\Valve\Steam → SteamPath (most authoritative)
  const hkcu = readRegistryValue('HKCU\\Software\\Valve\\Steam', 'SteamPath');
  if (hkcu) rawPaths.push(hkcu);

  // 2. Registry HKLM\SOFTWARE\WOW6432Node\Valve\Steam → InstallPath
  const hklm = readRegistryValue('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath');
  if (hklm) rawPaths.push(hklm);

  // 3. Fixed-drive common locations (covers non-default installs the registry may miss)
  for (const drive of getFixedDrives()) {
    rawPaths.push(path.join(drive, 'Steam'));
    rawPaths.push(path.join(drive, 'Program Files (x86)', 'Steam'));
    rawPaths.push(path.join(drive, 'Program Files', 'Steam'));
    rawPaths.push(path.join(drive, 'Games', 'Steam'));
  }

  // 4. Legacy hardcoded candidates (preserves prior behaviour as a last resort)
  rawPaths.push('C:\\Program Files (x86)\\Steam');
  rawPaths.push('C:\\Program Files\\Steam');

  // 5. User-supplied custom paths from custom_paths.txt
  for (const p of loadCustomPaths()) rawPaths.push(p);

  // Deduplicate by normalized path, keeping only existing directories.
  const seen = new Set();
  const result = [];
  for (const p of rawPaths) {
    if (!p) continue;
    const norm = path.resolve(p).toLowerCase();
    if (seen.has(norm)) continue;
    try {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        seen.add(norm);
        result.push(path.resolve(p));
      }
    } catch {
      // ignore inaccessible paths
    }
  }
  return result;
}

// List ready fixed drive roots ("C:\\", "D:\\", …) on Windows.
function getFixedDrives() {
  const drives = [];
  if (process.platform !== 'win32') return drives;
  // Probe A–Z drive roots via fs.existsSync (reliable, no external dependency).
  // wmic is deprecated on modern Windows; this avoids the dependency entirely.
  for (let c = 67; c <= 90; c++) { // C..Z
    const root = `${String.fromCharCode(c)}:\\`;
    try { if (fs.existsSync(root)) drives.push(root); } catch {}
  }
  return drives;
}

/**
 * Collect all `steamapps` directories across Steam installs and library folders.
 * Parses `libraryfolders.vdf` for multi-drive libraries, plus a fixed-drive
 * fallback for `SteamLibrary\steamapps`.
 */
export function discoverSteamappsDirs(steamDirs) {
  const steamappsDirs = [];
  const seen = new Set();

  const add = (p) => {
    const norm = path.resolve(p).toLowerCase();
    if (seen.has(norm)) return;
    try {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        seen.add(norm);
        steamappsDirs.push(path.resolve(p));
      }
    } catch {}
  };

  for (const s of steamDirs) {
    add(path.join(s, 'steamapps'));

    // Parse libraryfolders.vdf
    let libVdf = path.join(s, 'steamapps', 'libraryfolders.vdf');
    if (!fs.existsSync(libVdf)) libVdf = path.join(s, 'config', 'libraryfolders.vdf');
    if (fs.existsSync(libVdf)) {
      try {
        const content = fs.readFileSync(libVdf, 'utf8');
        // Match all "path" "..." entries
        for (const m of content.matchAll(/"path"\s*"([^"]+)"/gi)) {
          const libPath = m[1].replace(/\\\\/g, '\\');
          add(path.join(libPath, 'steamapps'));
        }
      } catch {}
    }
  }

  // Fallback: fixed-drive SteamLibrary\steamapps
  for (const drive of getFixedDrives()) {
    add(path.join(drive, 'SteamLibrary', 'steamapps'));
  }

  return steamappsDirs;
}

/**
 * Parse installed Steam games from `appmanifest_*.acf` files across all
 * steamapps directories. Returns a map keyed by appId.
 */
export function parseInstalledSteamGames(steamDirs) {
  const games = {};
  const steamappsDirs = discoverSteamappsDirs(steamDirs);

  for (const saDir of steamappsDirs) {
    let manifests = [];
    try {
      manifests = fs.readdirSync(saDir).filter(f => /^appmanifest_.*\.acf$/i.test(f));
    } catch { continue; }

    for (const mf of manifests) {
      try {
        const content = fs.readFileSync(path.join(saDir, mf), 'utf8');
        const appMatch = content.match(/"appid"\s*"(\d+)"/i);
        const nameMatch = content.match(/"name"\s*"([^"]+)"/i);
        const dirMatch = content.match(/"installdir"\s*"([^"]+)"/i);
        if (!appMatch || !nameMatch) continue;

        const appId = appMatch[1];
        const rawName = nameMatch[1];
        const installDir = dirMatch ? dirMatch[1] : '';

        // Skip Steamworks redistributables / SteamVR
        if (['228980', '250820'].includes(appId)) continue;
        if (/^(Steamworks|Proton)/i.test(rawName)) continue;

        games[appId] = { appId, name: rawName, installDir, steamappsPath: saDir };
      } catch {}
    }
  }

  return games;
}

/**
 * Parse `loginusers.vdf` to map 32-bit account IDs → persona names.
 * userdata directories are named by the 32-bit account ID (SteamID64 − 76561197960265728).
 */
export function parseSteamUsers(steamDir) {
  const userMap = {};
  const loginUsersFile = path.join(steamDir, 'config', 'loginusers.vdf');
  if (!fs.existsSync(loginUsersFile)) return userMap;

  try {
    const content = fs.readFileSync(loginUsersFile, 'utf8');
    // "76561198xxxxxxxxx" { ... "PersonaName" "Name" ... }
    for (const m of content.matchAll(/"(\d{17})"\s*\{[^}]*?"PersonaName"\s*"([^"]+)"/gs)) {
      const steamId64 = BigInt(m[1]);
      const accountId32 = steamId64 - 76561197960265728n;
      userMap[accountId32.toString()] = m[2];
    }
  } catch {}

  return userMap;
}

/**
 * Full Steam environment summary: all install dirs, userdata dir, all user IDs,
 * user name map, and installed-game map.
 */
export function getSteamEnvironment() {
  const steamDirs = discoverSteamInstallPaths();

  // Collect userdata roots from EVERY install dir that has one — not just the
  // first. Saves can live under a later Steam library on another drive, so a
  // single hardcoded userDataDir would miss them.
  let primarySteamDir = '';
  let userDataDir = '';
  const userdataDirs = [];
  const steamUsers = [];
  const userMap = {};

  for (const s of steamDirs) {
    const ud = path.join(s, 'userdata');
    if (fs.existsSync(ud)) {
      if (!primarySteamDir) primarySteamDir = s;
      if (!userDataDir) userDataDir = ud;
      if (!userdataDirs.includes(ud)) userdataDirs.push(ud);

      // Merge users from every install that has userdata.
      try {
        const users = fs.readdirSync(ud).filter(f => /^\d+$/.test(f));
        for (const u of users) {
          if (!steamUsers.includes(u)) steamUsers.push(u);
        }
      } catch {}

      // Merge persona-name map.
      Object.assign(userMap, parseSteamUsers(s));
    }
  }

  const installedGames = parseInstalledSteamGames(steamDirs);

  return {
    steamDirs,
    steamDir: primarySteamDir,
    userDataDir,
    userdataDirs,
    steamUsers,
    userMap,
    installedGames,
    steamDetected: steamDirs.length > 0,
  };
}

// Read user-supplied extra Steam root directories from custom_paths.txt.
export function loadCustomPaths() {
  const paths = [];
  const configPath = getDataFilePath('custom_paths.txt');
  if (!fs.existsSync(configPath)) return paths;
  try {
    const lines = fs.readFileSync(configPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !paths.includes(trimmed)) paths.push(trimmed);
    }
  } catch {}
  return paths;
}

// Append a new Steam root directory to custom_paths.txt (deduped).
export function saveCustomPath(newPath) {
  if (!newPath) return false;
  try {
    if (!fs.existsSync(newPath)) return false;
    const paths = loadCustomPaths();
    const norm = path.resolve(newPath).toLowerCase();
    const exists = paths.some(p => path.resolve(p).toLowerCase() === norm);
    if (!exists) {
      paths.push(newPath);
      const configPath = getDataFilePath('custom_paths.txt');
      fs.writeFileSync(configPath, paths.join('\n') + '\n', 'utf8');
    }
    return true;
  } catch {
    return false;
  }
}
