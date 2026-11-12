import { execSync, execFileSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { GAME_DATABASE } from './gameDatabase.js';
import { readAppxManifestInfo } from './gameDetector.js';
import { checkGameRunning, closePlatformClient } from './processCheck.js';
import { getDataFilePath } from './dataDir.js';

/**
 * Xbox Game Pass 游戏库 — 扫描已安装的打包游戏、AUMID 直启、云存档同步控制。
 *
 * 启动原理（已在 Win11 实测）：explorer.exe "shell:appsFolder\<PFN>!<AppId>"
 * 走系统的 ApplicationActivationManager，不经过 Xbox 客户端 UI。
 * AUMID 中的 !AppId 来自包内 AppxManifest.xml 的 <Application Id>。
 */

// 明显非游戏的系统/框架包前缀，避免"全部应用"视图被噪音淹没。
const NON_GAME_PREFIXES = [
  'microsoft.net', 'microsoft.vclibs', 'microsoft.ui.xaml', 'microsoft.winappruntime',
  'microsoft.services.store', 'microsoft.xboxspeech', 'microsoft.directx', 'microsoft.heif',
  'microsoft.vp9', 'microsoft.webmedia', 'microsoft.webpimage', 'microsoft.rawimage',
  'microsoft.hevc', 'microsoft.avcencoder', 'microsoft.computenetwork', 'microsoft.mpeg2',
  'microsoft.winget', 'microsoft.windowsspeech', 'microsoftlanguage',
  'microsoft.advertising', 'microsoft.apprep', 'microsoft.aad', 'microsoft.accountscontrol',
  'microsoft.credialoghost', 'microsoft.ecp', 'microsoft.lockapp', 'microsoft.microsoftedge',
  'microsoft.onecoresync', 'microsoft.parentalcontrols', 'microsoft.people',
  'microsoft.print3d', 'microsoft.applicationcompatibilityenhancements',
];

let scanCache = null;
let scanCacheTime = 0;
// 内存缓存只做短时去抖；真正的"进入程序立即有内容"靠磁盘缓存。
const SCAN_CACHE_TTL = 10 * 60 * 1000;
// 磁盘缓存过期后仍可先返回旧结果（stale-while-revalidate），避免首屏空白。
const DISK_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const CACHE_FILE = getDataFilePath('xbox-library-cache.json');

/** 读取磁盘缓存；过期返回 null。 */
function readDiskCache(maxAgeMs) {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.games)) return null;
    const age = Date.now() - new Date(parsed.savedAt || 0).getTime();
    if (!Number.isFinite(age) || age > maxAgeMs) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 原子写磁盘缓存，失败不影响主流程。 */
function writeDiskCache(games) {
  try {
    const payload = JSON.stringify({ savedAt: new Date().toISOString(), games }, null, 2);
    const tmp = `${CACHE_FILE}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, payload, 'utf8');
    fs.renameSync(tmp, CACHE_FILE);
  } catch {
    // 缓存写不进去只是下次变慢，不报错
  }
}

/** One PowerShell pass mapping every installed package → {pfn, installLocation}. */
function queryAllPackages() {
  const out = [];
  if (process.platform !== 'win32') return out;
  const script =
    "Get-AppxPackage | ForEach-Object { '{0}|{1}' -f $_.PackageFamilyName.ToLower(), $_.InstallLocation }";
  const result = execSync(`powershell -NoProfile -Command "${script}"`, {
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true,
  });
  for (const line of result.split(/\r?\n/)) {
    const idx = line.indexOf('|');
    if (idx <= 0) continue;
    const pfn = line.slice(0, idx).trim();
    const installLocation = line.slice(idx + 1).trim();
    if (pfn && installLocation) out.push({ pfn, installLocation });
  }
  return out;
}

/** Extract Application Id + Executable from an AppxManifest.xml (first <Application> entry). */
function readManifestApplication(installLocation) {
  try {
    const xml = fs.readFileSync(path.join(installLocation, 'AppxManifest.xml'), 'utf8');
    const app = /<(?:[A-Za-z0-9]+:)?Application\b[^>]*\bId="([^"]+)"[^>]*\bExecutable="([^"]+)"/.exec(xml)
      || /<(?:[A-Za-z0-9]+:)?Application\b[^>]*\bExecutable="([^"]+)"[^>]*\bId="([^"]+)"/.exec(xml);
    if (!app) return null;
    // The two regexes capture Id/Executable in opposite orders — normalize.
    const id = /Id="([^"]+)"/.exec(app[0]);
    const exe = /Executable="([^"]+)"/.exec(app[0]);
    return {
      appId: id ? id[1] : null,
      executable: exe ? exe[1] : null,
      fullTrust: /EntryPoint="Windows\.FullTrustApplication"/i.test(app[0]),
    };
  } catch {
    return null;
  }
}

/** Does the PFN match any GAME_DATABASE xboxPackageName wildcard pattern? */
function matchesDatabasePattern(pfn) {
  for (const entry of GAME_DATABASE) {
    if (!entry.xboxPackageName) continue;
    const re = new RegExp('^' + entry.xboxPackageName.toLowerCase().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'));
    if (re.test(pfn)) return true;
  }
  return false;
}

/** Top-level .exe names in the install dir (for tasklist running checks). */
function listExecutableNames(installLocation) {
  try {
    return fs.readdirSync(installLocation)
      .filter(f => f.toLowerCase().endsWith('.exe') && !/crashhandler|uninstall/i.test(f))
      .map(f => f.replace(/\.exe$/i, ''));
  } catch {
    return [];
  }
}

function hasWgsData(pfn) {
  try {
    const base = path.join(process.env.LOCALAPPDATA || '', 'Packages', pfn, 'SystemAppData', 'wgs');
    return fs.existsSync(base);
  } catch {
    return false;
  }
}

function hasGameConfig(installLocation) {
  try {
    return fs.existsSync(path.join(installLocation, 'MicrosoftGame.config'));
  } catch {
    return false;
  }
}

/**
 * Scan every installed packaged app and flag games.
 * @returns {{ games: Array<{pfn, aumid, displayName, installLocation, processNames, isGame, hasWgs}> }}
 */
export function scanXboxLibrary({ refresh = false } = {}) {
  const now = Date.now();

  // 1. 内存缓存（10 分钟内直接返回，切 Tab 不重扫）
  if (!refresh && scanCache && now - scanCacheTime < SCAN_CACHE_TTL) {
    return { games: scanCache, cached: 'memory' };
  }

  // 2. 磁盘缓存（程序重启后首屏立即有内容）
  if (!refresh) {
    const disk = readDiskCache(DISK_CACHE_MAX_AGE);
    if (disk) {
      scanCache = disk.games;
      scanCacheTime = now;
      return { games: disk.games, cached: 'disk', savedAt: disk.savedAt };
    }
  }

  // 3. 真正扫描
  const packages = queryAllPackages();
  const games = [];
  for (const { pfn, installLocation } of packages) {
    const manifestApp = readManifestApplication(installLocation);
    if (!manifestApp || !manifestApp.appId) continue;

    const wgs = hasWgsData(pfn);
    const gameConfig = hasGameConfig(installLocation);
    const dbMatch = matchesDatabasePattern(pfn);
    const isGame = gameConfig || dbMatch || wgs;
    const looksSystem = NON_GAME_PREFIXES.some(p => pfn.startsWith(p));

    const exeNames = listExecutableNames(installLocation);
    const processNames = manifestApp.executable
      ? [...new Set([manifestApp.executable.replace(/\.exe$/i, ''), ...exeNames])]
      : exeNames;

    games.push({
      pfn,
      aumid: `${pfn}!${manifestApp.appId}`,
      displayName: readAppxManifestInfo(installLocation).displayName || pfn,
      installLocation,
      processNames,
      isGame: isGame && !looksSystem,
      hasWgs: wgs,
      fullTrust: manifestApp.fullTrust,
    });
  }

  // Games first, then the rest; each group alphabetical.
  games.sort((a, b) =>
    (b.isGame - a.isGame) || a.displayName.localeCompare(b.displayName, 'zh-Hans-CN'));

  scanCache = games;
  scanCacheTime = now;
  writeDiskCache(games);
  return { games, cached: 'fresh' };
}

/**
 * Launch a packaged app by AUMID via the shell activator — no Xbox client UI.
 * explorer.exe returns before the app spawns (and often exits non-zero), so the
 * return value only means "activation request was issued"; real verification is
 * checkXboxGameRunning().
 * @param {string} aumid e.g. 'TeamCherry.HollowKnightSilksong_y4jvztpgccj42!Hollow.Knight.Silksong'
 */
export function launchXboxGame(aumid) {
  if (!aumid || !/^[A-Za-z0-9.\-_]+_[A-Za-z0-9]+![\w.\-]+$/.test(aumid)) {
    throw new Error(`无效的 AUMID：${aumid}`);
  }
  if (process.platform !== 'win32') throw new Error('仅支持 Windows');
  const child = spawn('explorer.exe', [`shell:appsFolder\\${aumid}`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  return { launched: true, aumid };
}

/**
 * Is the packaged app running? Matches ANY top-level .exe of the install dir
 * (the manifest entry — e.g. GameLaunchHelper.exe — often just spawns the real
 * game exe, whose name only appears in the install folder).
 */
export function checkXboxGameRunning(installLocation, extraProcessNames = []) {
  const names = [...new Set([...listExecutableNames(installLocation), ...extraProcessNames])];
  if (names.length === 0) return { running: false, matchedNames: [] };
  return checkGameRunning(names);
}

/**
 * 尽力而为地切断云存档同步链路：
 * 1) 关闭 Xbox 应用全家桶（closePlatformClient，按 PID 多轮击杀）；
 * 2) 单独击杀 XboxPcAppFT.exe（它被 closePlatformClient 列为非阻断者，但用户
 *    明确要求"停止同步"时值得一杀——复活属预期，如实报告）；
 * 3) 尝试停止 GamingServices / GamingServicesNet 系统服务（需要管理员权限，
 *    失败归入 servicesFailed 并提示，不视为整体失败）。
 * @returns {{ xboxAppClosed: boolean, xboxAppStillRunning: string[], ftKilled: boolean,
 *             gamesRunning: string[], servicesStopped: string[], servicesFailed: string[], hints: string[] }}
 */
export function stopCloudSync() {
  const hints = [];

  const closed = closePlatformClient('xbox');

  // XboxPcAppFT.exe — closePlatformClient skips it; kill by image name instead.
  let ftKilled = false;
  try {
    execFileSync('taskkill', ['/F', '/IM', 'XboxPcAppFT.exe', '/T'], {
      encoding: 'utf8', timeout: 8000, windowsHide: true, stdio: 'pipe',
    });
    ftKilled = true;
    hints.push('XboxPcAppFT.exe 已击杀，但它由系统看护进程自动复活，属预期行为，不影响本次防护');
  } catch {
    // Not running, or access denied — either way nothing to report as failure.
  }

  // Known game processes from the database (informational — the user may have
  // a game open, in which case its own cloud session is still alive).
  const dbProcessNames = [...new Set(GAME_DATABASE.flatMap(g => g.processNames || []))];
  const gameCheck = checkGameRunning(dbProcessNames);

  const servicesStopped = [];
  const servicesFailed = [];
  for (const svc of ['GamingServicesNet', 'GamingServices']) {
    try {
      execSync(`net stop ${svc} /y`, { encoding: 'utf8', timeout: 15000, windowsHide: true });
      servicesStopped.push(svc);
    } catch (e) {
      servicesFailed.push(svc);
      const detail = String((e && (e.stderr || e.stdout || e.message)) || '');
      if (/拒绝访问|access is denied|denied/i.test(detail)) {
        hints.push(`停止 ${svc} 需要管理员权限——游戏未运行时同步本就不会发生，此步可跳过`);
      }
    }
  }

  return {
    xboxAppClosed: closed.attempted,
    xboxAppStillRunning: closed.stillRunning,
    ftKilled,
    gamesRunning: gameCheck.matchedNames,
    servicesStopped,
    servicesFailed,
    hints,
  };
}
