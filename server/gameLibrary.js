import { scanInstalledGames } from './gameDetector.js';
import { scanXboxLibrary } from './xboxLibrary.js';

/**
 * 把「Xbox 游戏库」里已安装的 Game Pass 游戏并入主扫描结果。
 *
 * 为什么需要：主扫描只认"已经存在存档"的游戏——新装但从未启动过的
 * Game Pass 游戏不会出现在列表里，用户会以为工具没扫到它。合并后这类
 * 游戏也会列出（Xbox 侧显示"未检测到"，并提示先启动一次生成结构）。
 *
 * 放在独立模块是为了避免 gameDetector ↔ xboxLibrary 的循环依赖
 * （xboxLibrary 已经 import 了 gameDetector 的 manifest 解析）。
 */

function normalizeName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
}

function patternToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + escaped + '$');
}

/**
 * @returns 与 scanInstalledGames() 同结构，额外带 `xboxLibraryCount`
 */
export function scanGamesWithXboxLibrary({ libraryOverride = null, baseOverride = null } = {}) {
  const base = baseOverride || scanInstalledGames();

  let libraryGames = [];
  if (Array.isArray(libraryOverride)) {
    libraryGames = libraryOverride;
  } else {
    try {
      // scanXboxLibrary 内部有 60s 缓存，且会过滤掉系统/框架包
      libraryGames = scanXboxLibrary().games.filter(g => g.isGame);
    } catch {
      return { ...base, xboxLibraryCount: 0 };
    }
  }

  // 已存在的游戏：按包名、包名通配模式、显示名三重去重，避免同一款游戏出现两次
  const knownPfn = new Set();
  const patterns = [];
  const knownNames = new Set();
  for (const g of base.games) {
    if (g.xboxPackageFolder) knownPfn.add(String(g.xboxPackageFolder).toLowerCase());
    if (g.xboxPackageName) patterns.push(String(g.xboxPackageName).toLowerCase());
    if (g.name) knownNames.add(normalizeName(g.name));
  }
  const compiled = patterns.map(patternToRegex);
  const matchesPattern = pfn => compiled.some(re => re.test(pfn));

  const added = [];
  for (const lib of libraryGames) {
    const pfn = String(lib.pfn || '').toLowerCase();
    if (!pfn) continue;
    if (knownPfn.has(pfn) || matchesPattern(pfn)) continue;
    if (knownNames.has(normalizeName(lib.displayName))) continue;

    added.push({
      id: `xbox-${pfn}`,
      name: lib.displayName || pfn,
      steamAppId: null,
      steamSaveRelPath: '',
      xboxPackageName: lib.pfn,
      category: 'A',
      saveFilePattern: '*.sav',
      iconUrl: `/api/xbox-icon/${encodeURIComponent(lib.pfn)}`,
      processNames: lib.processNames || [],
      notes: '来自已安装的 Game Pass 游戏库；尚未检测到存档，先在 Xbox 端启动一次游戏生成存档结构',
      isSteamDetected: false,
      steamSavePath: '未检测到（可手动指定）',
      steamLastModified: null,
      steamSaveSize: 0,
      steamFileCount: 0,
      isXboxDetected: false,
      xboxWgsPath: '未检测到（可手动指定）',
      xboxPackageFolder: lib.pfn,
      xboxLastModified: null,
      xboxSaveSize: 0,
      canSync: false,
      // 前端据此区分"已安装但还没存档"与"完全没检测到"
      isXboxInstalled: true,
      aumid: lib.aumid || null,
    });
  }

  return {
    ...base,
    games: [...base.games, ...added],
    xboxLibraryCount: added.length,
  };
}
