import fs from 'fs';
import path from 'path';
import { execSync, execFileSync } from 'child_process';
import { GAME_DATABASE } from './gameDatabase.js';
import { getCustomGames } from './customGamesStore.js';
import { getSteamEnvironment } from './steamLocator.js';

/**
 * Game Detector Service
 * Locates Steam userdata, AppData save folders, and Xbox Package WGS folders on Windows.
 * Rewritten to align with Program.cs: registry/VDF discovery, multi-user, recursive
 * save scanning, multi-XUID latest-selection, and LocalCache fallback.
 */

const KNOWN_TITLE_MAP = {
  '77536c3fe941': 'Dead Island 2 (死岛2)',
  'deepsilver.77536c3fe941': 'Dead Island 2 (死岛2)',
  'poncle.vampirecrawlers': 'Vampire Crawlers (吸血鬼爬行者)',
  'vampirecrawlers': 'Vampire Crawlers (吸血鬼爬行者)',
  'poncle.vampiresurvivors': 'Vampire Survivors (吸血鬼幸存者)',
  'doboroggames.clonedroneinthedangerzone': 'Clone Drone in the Danger Zone (克隆机器人大乱斗)',
  'clonedroneinthedangerzone': 'Clone Drone in the Danger Zone (克隆机器人大乱斗)',
  'pocketpairinc.palworld': 'Palworld (幻兽帕鲁)',
  'bethesdasoftworks.projectgold': 'Starfield (星空)',
  'neowiz.liesofp': 'Lies of P (匹诺曹的谎言)',
  'coffeestainpublishing.deeprockgalactic': 'Deep Rock Galactic (深岩银河)',
  'microsoft.624f8b84b80': 'Forza Horizon 5 (极限竞速：地平线5)',
  'capcom.monsterhunterrise': 'Monster Hunter Rise (怪物猎人：崛起)',
  'segaofamericainc.f0cda2eb77': 'Persona 5 Royal (女神异闻录5 皇家版)',
  'hellogames.nomanssky': "No Man's Sky (无人深空)",
  'microsoft.seaofthieves': 'Sea of Thieves (盗贼之海)',
  'segaofamericainc.yakuzalikeadragon': 'Yakuza 7 (如龙7)',
  'motiontwin.deadcells': 'Dead Cells (死亡细胞)',
  'microsoft.hades': 'Hades (哈迪斯)',
  'teamcherry.hollowknight': 'Hollow Knight (空洞骑士)',
  'studiomdhr.cuphead': 'Cuphead (茶杯头)',
  'bethesdasoftworks.hifirush': 'Hi-Fi Rush (完美音浪)',
  'microsoft.grounded': 'Grounded (禁闭求生)',
  'concernedape.stardewvalley': 'Stardew Valley (星露谷物语)',
  'segaofamerica.persona4golden': 'Persona 4 Golden (女神异闻录4 黄金版)',
  'segaofamerica.persona3reload': 'Persona 3 Reload (女神异闻录3 重装版)',
  'capcom.re2': 'Resident Evil 2 (生化危机2 重制版)',
  'capcom.re3': 'Resident Evil 3 (生化危机3 重制版)',
  'microsoft.citiesskylines': 'Cities: Skylines (城市：天际线)',
  'squareenix.octopathtraveler': 'Octopath Traveler (八方旅人)',
  'erabitstudio.brotato': 'Brotato (土豆兄弟)',
  'brotato': 'Brotato (土豆兄弟)',
  'namcobandaigamesinc.littlenightmareshancededitio': 'Little Nightmares Enhanced Edition (小小梦魇精选版)',
};

function resolveFriendlyTitle(pkgName) {
  const cleanBase = pkgName.split('_')[0].toLowerCase();
  if (KNOWN_TITLE_MAP[cleanBase]) return KNOWN_TITLE_MAP[cleanBase];
  if (KNOWN_TITLE_MAP[pkgName.toLowerCase()]) return KNOWN_TITLE_MAP[pkgName.toLowerCase()];

  const parts = cleanBase.split('.');
  for (const part of parts) {
    if (KNOWN_TITLE_MAP[part]) return KNOWN_TITLE_MAP[part];
  }

  const raw = parts[parts.length - 1];
  const formatted = raw.replace(/([a-z])([A-Z])/g, '$1 $2');
  return `《${formatted}》`;
}

function expandEnvPath(filePath) {
  if (!filePath) return '';
  return filePath.replace(/%([^%]+)%/g, (_, n) => {
    const val = process.env[n];
    if (val === undefined) {
      console.warn(`[gameDetector] 环境变量 %${n}% 未设置，路径可能不完整`);
    }
    return val || '';
  });
}

// --- Appx manifest resolution: real display names + logo paths for UWP games ---
// WindowsApps cannot be enumerated by a normal user, but direct paths are
// readable, so we resolve InstallLocation via one batched PowerShell query and
// then read each package's AppxManifest.xml with plain fs.

let appxCache = null;
let appxCacheTime = 0;
const APPX_CACHE_TTL = 5 * 60 * 1000;

export function getWindowsAppsDir() {
  return 'C:\\Program Files\\WindowsApps';
}

/**
 * Resolve { displayName, installLocation } for the given PackageFamilyNames.
 * @param {string[]} familyNames e.g. ['DeepSilver.77536C3FE941_hmv7qcest37me']
 * @returns {Map<string, {displayName: string|null, installLocation: string|null}>}
 */
export function resolveAppxInfos(familyNames) {
  const now = Date.now();
  if (!appxCache || now - appxCacheTime > APPX_CACHE_TTL) {
    appxCache = queryAppxLocations();
    appxCacheTime = now;
  }

  const out = new Map();
  for (const fam of familyNames) {
    const loc = appxCache.get(fam.toLowerCase()) || null;
    let displayName = null;
    if (loc) displayName = readAppxDisplayName(loc);
    out.set(fam, { displayName, installLocation: loc });
  }
  return out;
}

/** One PowerShell pass mapping every installed package family → install location. */
function queryAppxLocations() {
  const map = new Map();
  if (process.platform !== 'win32') return map;
  try {
    const script =
      "Get-AppxPackage | ForEach-Object { '{0}|{1}' -f $_.PackageFamilyName.ToLower(), $_.InstallLocation }";
    const out = execSync(`powershell -NoProfile -Command "${script}"`, {
      encoding: 'utf8',
      timeout: 20000,
      windowsHide: true,
    });
    for (const line of out.split(/\r?\n/)) {
      const idx = line.indexOf('|');
      if (idx <= 0) continue;
      const fam = line.slice(0, idx).trim();
      const loc = line.slice(idx + 1).trim();
      if (fam && loc && fs.existsSync(loc)) map.set(fam, loc);
    }
  } catch {}
  return map;
}

/** Read DisplayName (+ logo attribute path) from an install location's AppxManifest.xml. */
export function readAppxManifestInfo(installLocation) {
  try {
    const xml = fs.readFileSync(path.join(installLocation, 'AppxManifest.xml'), 'utf8');
    // Prefer the visual-level DisplayName (real product name) over Properties.
    let dm = /<(?:[A-Za-z0-9]+:)?VisualElements[^>]*DisplayName="([^"]+)"/.exec(xml)
      || /<Properties>[\s\S]*?<DisplayName>([^<]+)<\/DisplayName>/i.exec(xml);
    let displayName = dm ? dm[1] : null;
    if (displayName && (displayName.startsWith('ms-resource') || !displayName.trim())) displayName = null;

    const logoMatch = /<(?:[A-Za-z0-9]+:)?VisualElements[^>]*\bLogo="([^"]+)"/.exec(xml)
      || /<Properties>[\s\S]*?<Logo>([^<]+)<\/Logo>/i.exec(xml);
    const logoRel = logoMatch ? logoMatch[1].replace(/^ms-appx:\/*/,'') : null;
    return { displayName, logoRel };
  } catch {
    return { displayName: null, logoRel: null };
  }
}

function readAppxDisplayName(installLocation) {
  return readAppxManifestInfo(installLocation).displayName;
}

// Recursively scan a directory for all files, returning { files, totalSize, fileCount }.
function scanDirectoryRecursive(dirPath) {
  const files = [];
  let totalSize = 0;
  let fileCount = 0;

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch { return; }
    for (const entry of entries) {
      const fp = path.join(dir, entry);
      try {
        const stat = fs.statSync(fp);
        if (stat.isDirectory()) {
          walk(fp);
        } else if (stat.isFile()) {
          files.push({ name: entry, path: fp, size: stat.size });
          totalSize += stat.size;
          fileCount++;
        }
      } catch {
        // skip inaccessible files
      }
    }
  }

  walk(dirPath);
  return { files, totalSize, fileCount };
}

// Resolve relative segments like .. in paths (e.g. %APPDATA%\..\LocalLow\...)
function resolveSafe(dirPath) {
  try {
    return path.resolve(dirPath);
  } catch {
    return dirPath;
  }
}

// Normalize a Windows path for dedup comparison.
function normPath(p) {
  return path.resolve(p).toLowerCase();
}

// Small glob matcher (supports * only) — used to pick a save-containing
// sub-directory when resolving `<...>` wildcard paths.
function wildcardMatch(pattern, text) {
  if (!pattern || !text) return false;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  try {
    return new RegExp('^' + escaped + '$', 'i').test(text);
  } catch {
    return false;
  }
}

export function findXboxWgsFolder(packageNamePattern) {
  const localAppData = process.env.LOCALAPPDATA || 'C:\\Users\\Default\\AppData\\Local';
  const packagesDir = path.join(localAppData, 'Packages');

  if (!fs.existsSync(packagesDir)) return null;

  try {
    const allPackages = fs.readdirSync(packagesDir);
    // Escape regex special chars in the pattern, then replace escaped \* with .*
    const escapedPattern = packageNamePattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const regPattern = new RegExp('^' + escapedPattern + '$', 'i');

    // Collect ALL matching packages (not just the first).
    const matchedPkgs = allPackages.filter(pkgName => regPattern.test(pkgName));
    if (matchedPkgs.length === 0) return null;

    // For each matching package, find the most recently modified WGS sub-directory.
    let bestResult = null;
    let bestTime = 0;

    for (const matchedPkg of matchedPkgs) {
      const wgsBaseDir = path.join(packagesDir, matchedPkg, 'SystemAppData', 'wgs');
      if (!fs.existsSync(wgsBaseDir)) continue;

      const entries = fs.readdirSync(wgsBaseDir);
      for (const entry of entries) {
        const fullPath = path.join(wgsBaseDir, entry);
        const indexPath = path.join(fullPath, 'containers.index');
        try {
          if (fs.statSync(fullPath).isDirectory() && fs.existsSync(indexPath) && fs.statSync(indexPath).size > 16) {
            const mtime = fs.statSync(indexPath).mtime.getTime();
            if (mtime > bestTime) {
              bestTime = mtime;
              bestResult = { packageFolder: matchedPkg, wgsFolderPath: fullPath };
            }
          }
        } catch {}
      }

      // Fallback: LocalCache\Roaming for games like Stardew Valley
      const localCacheRoot = path.join(packagesDir, matchedPkg, 'LocalCache', 'Roaming');
      if (fs.existsSync(localCacheRoot)) {
        try {
          for (const sub of fs.readdirSync(localCacheRoot)) {
            const subPath = path.join(localCacheRoot, sub, 'Saves');
            if (fs.existsSync(subPath) && fs.statSync(subPath).isDirectory()) {
              const mtime = fs.statSync(subPath).mtime.getTime();
              if (mtime > bestTime) {
                bestTime = mtime;
                bestResult = { packageFolder: matchedPkg, wgsFolderPath: subPath, isLocalCache: true };
              }
            }
          }
        } catch {}
      }
    }

    return bestResult;
  } catch (err) {
    console.warn(`Error scanning Xbox package ${packageNamePattern}:`, err.message);
  }

  return null;
}

export function findSteamSaveFolder(game, steamEnv) {
  let relPath = game.steamSaveRelPath;
  if (!relPath) return null;
  // Handle %STEAM_USERDATA% before generic environment expansion — it is our
  // own placeholder, not an OS environment variable.
  if (relPath.includes('%STEAM_USERDATA%')) {
    // Try every userdata root × every account, so saves on a second Steam
    // library/drive still resolve. Fall back to the legacy single userDataDir.
    const roots = (steamEnv.userdataDirs && steamEnv.userdataDirs.length)
      ? steamEnv.userdataDirs
      : (steamEnv.userDataDir ? [steamEnv.userDataDir] : []);
    const users = steamEnv.steamUsers || [];

    if (roots.length === 0 || users.length === 0) return null;
    for (const ud of roots) {
      for (const userId of users) {
        const candidate = relPath.replace('%STEAM_USERDATA%', path.join(ud, userId));
        const resolved = resolveSafe(candidate);
        if (fs.existsSync(resolved)) {
          return resolved;
        }
      }
    }
    // None of the userdata×user combinations had this exact path.
    return null;
  }

  relPath = expandEnvPath(relPath);

  // Handle <...> wildcard — preserve the suffix after '>' and match across all sub-directories.
  if (relPath.includes('<') && relPath.includes('>')) {
    const ltIdx = relPath.indexOf('<');
    const gtIdx = relPath.indexOf('>');
    const baseDir = resolveSafe(relPath.substring(0, ltIdx));
    const suffix = relPath.substring(gtIdx + 1);

    if (fs.existsSync(baseDir)) {
      try {
        const subDirs = fs.readdirSync(baseDir).filter(f => {
          try { return fs.statSync(path.join(baseDir, f)).isDirectory(); } catch { return false; }
        });
        // Prefer a sub-directory that actually contains save files matching the
        // game's saveFilePattern — otherwise a wildcard like
        // %APPDATA%\Brotato\<...> may resolve to a `logs`/`user` folder.
        if (game.saveFilePattern) {
          const pattern = game.saveFilePattern.toLowerCase();
          for (const sub of subDirs) {
            const candidate = resolveSafe(path.join(baseDir, sub, suffix));
            if (!fs.existsSync(candidate)) continue;
            try {
              const hasSave = fs.readdirSync(candidate)
                .some(f => wildcardMatch(pattern, f.toLowerCase()));
              if (hasSave) return candidate;
            } catch {}
          }
        }
        // Fallback: any existing suffix path.
        for (const sub of subDirs) {
          const candidate = resolveSafe(path.join(baseDir, sub, suffix));
          if (fs.existsSync(candidate)) {
            return candidate;
          }
        }
      } catch {}
    }
    // Wildcard not matched — fall through to direct check below.
    return null;
  }

  // Direct path (possibly with .. segments).
  const resolved = resolveSafe(relPath);
  if (fs.existsSync(resolved)) {
    return resolved;
  }

  // OneDrive Documents redirection fallback: Windows often redirects
  // %USERPROFILE%\Documents to OneDrive\Documents, which breaks apps that use
  // "%USERPROFILE%\Documents\..." — try the OneDrive variant too.
  const userProfile = process.env.USERPROFILE || '';
  if (userProfile && relPath.replace(/\//g, '\\').toLowerCase().startsWith(userProfile.toLowerCase() + '\\documents\\')) {
    const oneDriveRel = relPath.substring(userProfile.length);
    const oneDriveDoc = path.join(userProfile, 'OneDrive', oneDriveRel);
    const odResolved = resolveSafe(oneDriveDoc);
    if (fs.existsSync(odResolved)) {
      return odResolved;
    }
  }

  return null;
}

export function scanInstalledGames() {
  const steamEnv = getSteamEnvironment();
  // Merge preset database + user custom games.
  const allGames = [...GAME_DATABASE, ...getCustomGames()];

  const results = allGames.map(game => {
    const steamSavePath = findSteamSaveFolder(game, steamEnv);

    let steamLastModified = null;
    let steamSaveSize = 0;
    let steamFileCount = 0;

    if (steamSavePath && fs.existsSync(steamSavePath)) {
      try {
        const dirStat = fs.statSync(steamSavePath);
        steamLastModified = dirStat.mtime;

        // Recursive scan — picks up saves in sub-directories (e.g. Palworld Players/).
        const scanResult = scanDirectoryRecursive(steamSavePath);
        steamSaveSize = scanResult.totalSize;
        steamFileCount = scanResult.fileCount;
      } catch {}
    }

    // Detect Steam: directory exists AND has at least one save file (avoids
    // counting empty directories as "detected" for the priority-sort).
    const isSteamDetected = Boolean(steamSavePath && fs.existsSync(steamSavePath) && steamFileCount > 0);

    // Wildcard-confidence: when the game's relPath uses <...>, the resolved path
    // may be a best-guess; mark it so the UI can prioritize exact-match games.
    const hasWildcard = (game.steamSaveRelPath || '').includes('<') && (game.steamSaveRelPath || '').includes('>');
    const steamPathConfidence = hasWildcard && isSteamDetected ? 'wildcard' : 'exact';

    const xboxInfo = findXboxWgsFolder(game.xboxPackageName);

    let xboxLastModified = null;
    let xboxSaveSize = 0;
    const isXboxInstalled = Boolean(xboxInfo && xboxInfo.wgsFolderPath);

    if (isXboxInstalled) {
      try {
        const indexPath = path.join(xboxInfo.wgsFolderPath, 'containers.index');
        const checkPath = fs.existsSync(indexPath) ? indexPath : xboxInfo.wgsFolderPath;
        const stats = fs.statSync(checkPath);
        xboxLastModified = stats.mtime;
        xboxSaveSize = stats.size;
      } catch {}
    }

    return {
      ...game,
      isSteamDetected,
      steamSavePath: isSteamDetected ? steamSavePath : '未检测到（可手动指定）',
      steamLastModified: isSteamDetected ? steamLastModified : null,
      steamSaveSize,
      steamFileCount,
      steamPathConfidence,
      isXboxDetected: isXboxInstalled,
      xboxWgsPath: xboxInfo ? xboxInfo.wgsFolderPath : '未检测到（可手动指定）',
      xboxPackageFolder: xboxInfo ? xboxInfo.packageFolder : null,
      xboxLastModified,
      xboxSaveSize,
      canSync: isSteamDetected || isXboxInstalled
    };
  });

  // Deep scan Packages for unlisted Xbox games (covers installed Game Pass games
  // not in GAME_DATABASE or custom games).
  const localAppData = process.env.LOCALAPPDATA || 'C:\\Users\\Default\\AppData\\Local';
  const packagesDir = path.join(localAppData, 'Packages');

  if (fs.existsSync(packagesDir)) {
    // Dedup by package NAME (case-insensitive), not by filesystem path: results
    // carry their Xbox package folder name, and that's what we compare against
    // the deep-scan pkgName. Comparing full tree paths (wgs subdir vs pkg dir)
    // never matches → duplicate entries for every detected Xbox game.
    const knownXboxPackages = new Set(
      results
        .filter(r => r.isXboxDetected && (r.xboxPackageFolder || r.xboxPackageName))
        .map(r => String(r.xboxPackageFolder || r.xboxPackageName || '').toLowerCase())
        .filter(Boolean)
    );

    try {
      const allPkgs = fs.readdirSync(packagesDir);
      for (const pkgName of allPkgs) {
        const wgsDir = path.join(packagesDir, pkgName, 'SystemAppData', 'wgs');
        if (!fs.existsSync(wgsDir)) continue;

        // Skip packages already covered by the main library (same package name)
        // — avoids the same game appearing twice.
        if (knownXboxPackages.has(pkgName.toLowerCase())) continue;

        const subEntries = fs.readdirSync(wgsDir);

        // Collect ALL qualifying wgs sub-directories (multi-account), pick the latest.
        let bestSub = null;
        let bestTime = 0;
        for (const sub of subEntries) {
          const subP = path.join(wgsDir, sub);
          const idxP = path.join(subP, 'containers.index');
          try {
            if (fs.statSync(subP).isDirectory() && fs.existsSync(idxP) && fs.statSync(idxP).size > 16) {
              const t = fs.statSync(idxP).mtime.getTime();
              if (t > bestTime) { bestTime = t; bestSub = subP; }
            }
          } catch {}
        }

        if (bestSub) {
          // Prefer the package's real Appx display name over the static map /
          // camelCase fallback, and expose its store logo via /api/xbox-icon.
          const appx = resolveAppxInfos([pkgName]).get(pkgName);
          const friendlyName = (appx && appx.displayName) || resolveFriendlyTitle(pkgName);
          const stats = fs.statSync(path.join(bestSub, 'containers.index'));
          results.push({
            id: pkgName.split('_')[0].toLowerCase(),
            name: friendlyName,
            steamAppId: '',
            steamSaveRelPath: '',
            xboxPackageName: pkgName,
            category: 'A',
            saveFilePattern: '*.sav',
            iconUrl: `/api/xbox-icon/${encodeURIComponent(pkgName)}`,
            processNames: [],
            notes: '自动全盘深度扫检找到的 Xbox 容器存档。',
            isSteamDetected: false,
            steamSavePath: '未检测到（可手动指定）',
            steamLastModified: null,
            steamSaveSize: 0,
            steamFileCount: 0,
            isXboxDetected: true,
            xboxWgsPath: bestSub,
            xboxPackageFolder: pkgName,
            xboxLastModified: stats.mtime,
            xboxSaveSize: stats.size,
            canSync: true
          });
        }
      }
    } catch {}
  }

  // Discoverive Steam backfill: `installedGames` (all installed Steam titles
  // parsed from appmanifest .acf) has sat unused. For any database game that
  // failed the path-template lookup but IS installed, probe the standard
  // userdata\<uid>\<appid>\remote\ layout and mark it detected. This closes the
  // gap where a library game's save lives in a non-default location.
  const installed = steamEnv.installedGames || {};
  const appIdToResult = new Map();
  for (const r of results) {
    const a = r.steamAppId ? String(r.steamAppId) : '';
    if (a && !appIdToResult.has(a)) appIdToResult.set(a, r);
  }

  for (const appId of Object.keys(installed)) {
    const r = appIdToResult.get(appId);
    if (!r || r.isSteamDetected) continue; // only backfill games we failed to locate

    const udRoots = (steamEnv.userdataDirs && steamEnv.userdataDirs.length)
      ? steamEnv.userdataDirs
      : (steamEnv.userDataDir ? [steamEnv.userDataDir] : []);
    const users = steamEnv.steamUsers || [];

    let foundPath = null;
    for (const ud of udRoots) {
      for (const user of users) {
        // Steam cloud saves live under userdata/<uid>/<appid>/remote/
        const candidate = path.join(ud, user, appId, 'remote');
        try {
          if (fs.existsSync(candidate)) { foundPath = candidate; break; }
        } catch {}
        // Some games store directly under userdata/<uid>/<appid>/
        const candidate2 = path.join(ud, user, appId);
        try {
          if (foundPath === null && fs.existsSync(candidate2) && fs.statSync(candidate2).isDirectory()) {
            foundPath = candidate2;
          }
        } catch {}
      }
      if (foundPath) break;
    }

    if (foundPath) {
      r.isSteamDetected = true;
      r.steamSavePath = foundPath;
      try {
        const stats = fs.statSync(foundPath);
        r.steamLastModified = stats.mtime;
        const scanResult = scanDirectoryRecursive(foundPath);
        r.steamSaveSize = scanResult.totalSize;
        r.steamFileCount = scanResult.fileCount;
      } catch {}
      r.canSync = r.isSteamDetected || r.isXboxDetected;
    }
  }

  // Discoverive full-sweep Steam scan — symmetric to the Xbox Packages sweep
  // above. Any appid with a real save dir under userdata gets surfaced, even if
  // the game isn't in GAME_DATABASE. This is what makes the scan "comprehensive":
  // off-library Steam games with saves would otherwise never appear.
  const SKIP_STEAM_APPS = new Set(['7', '550', '760', '322330']); // system/index dirs
  // Steam-internal cloud "apps" that leave userdata dirs but are not games:
  // 241100 = client personalization (personalization.vdf), 2371090 = cloud
  // notes feature (notes_<appid>). Surfacing them as games is pure noise.
  const SKIP_STEAM_APPS_SYSTEM = new Set(['241100', '2371090']);
  const foundByAppId = new Map(); // appId -> { remotePath, nonRemotePath }
  const knownSteamAppIds = new Set(
    allGames.map(g => g.steamAppId ? String(g.steamAppId) : '')
  );

  for (const ud of (steamEnv.userdataDirs && steamEnv.userdataDirs.length
    ? steamEnv.userdataDirs
    : (steamEnv.userDataDir ? [steamEnv.userDataDir] : []))) {
    for (const user of steamEnv.steamUsers || []) {
      let appDirs = [];
      try {
        appDirs = fs.readdirSync(path.join(ud, user)).filter(f => /^\d+$/.test(f));
      } catch { continue; }
      for (const app of appDirs) {
        if (SKIP_STEAM_APPS.has(app)) continue;
        if (SKIP_STEAM_APPS_SYSTEM.has(app)) continue;
        const base = path.join(ud, user, app);
        const remote = path.join(base, 'remote');
        const existing = foundByAppId.get(app) || {};
        if (fs.existsSync(remote) && fs.statSync(remote).isDirectory()) {
          existing.remotePath = existing.remotePath || remote;
        } else {
          // non-remote app dir may hold saves (e.g. games not using cloud export)
          try {
            const hasRealFiles = fs.readdirSync(base)
              .some(f => !/^(remotecache\.vdf|config)$/i.test(f));
            if (hasRealFiles && !existing.remotePath) existing.remotePath = base;
          } catch {}
        }
        if (existing.remotePath) foundByAppId.set(app, existing);
      }
    }
  }

  /** Look up an app's display name in the local Steam client registry
 *  (HKCU\Software\Valve\Steam\apps\<appid> → Name). Covers uninstalled games
 *  whose leftover userdata saves have no appmanifest to read. */
function steamAppNameFromRegistry(appId) {
  if (process.platform !== 'win32') return null;
  try {
    const key = ['HKCU', 'Software', 'Valve', 'Steam', 'apps', String(appId)].join('\\');
    const out = execFileSync('reg', ['query', key, '/v', 'Name'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    const m = /Name\s+REG_SZ\s+(.+)/.exec(out);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

// Surface off-library apps as new findings; already-in-library apps were
  // handled above (path template / installedGames backfill).
  for (const [appId, loc] of foundByAppId) {
    if (knownSteamAppIds.has(appId)) continue; // in library, already processed
    if (results.some(r => r.id === 'steam-' + appId)) continue;

    const installed = steamEnv.installedGames || {};
    // Real title chain: appmanifest → Steam client registry → AppID label.
    // Icon always comes from the Steam CDN, which serves header art by appid
    // regardless of install state.
    const title = (installed[appId] && installed[appId].name)
      || steamAppNameFromRegistry(appId)
      || `Steam 游戏 (AppID ${appId})`;
    let lastMod = null, size = 0, count = 0;
    try {
      const st = fs.statSync(loc.remotePath);
      lastMod = st.mtime;
      const scan = scanDirectoryRecursive(loc.remotePath);
      size = scan.totalSize;
      count = scan.fileCount;
    } catch {}

    results.push({
      id: 'steam-' + appId,
      name: title,
      steamAppId: appId,
      steamSaveRelPath: '',
      xboxPackageName: '',
      category: 'C',
      saveFilePattern: '',
      iconUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
      processNames: [],
      notes: '全盘扫描发现的 Steam 存档（未在预设库中）。Xbox 端可手动指定 WGS 目录。',
      isSteamDetected: true,
      steamSavePath: loc.remotePath,
      steamLastModified: lastMod,
      steamSaveSize: size,
      steamFileCount: count,
      isXboxDetected: false,
      xboxWgsPath: '未检测到（可手动指定）',
      xboxPackageFolder: null,
      xboxLastModified: null,
      xboxSaveSize: 0,
      canSync: true
    });
  }

  return {
    steamDetected: steamEnv.steamDetected,
    steamDirs: steamEnv.steamDirs,
    steamUserCount: steamEnv.steamUsers.length,
    steamUsers: steamEnv.steamUsers,
    steamUserMap: steamEnv.userMap,
    games: results
  };
}
