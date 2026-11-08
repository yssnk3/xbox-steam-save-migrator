/**
 * Xbox 游戏库合并自检。
 *
 * 验证 scanGamesWithXboxLibrary 的三条不变量：
 *  1) 库内已安装但主扫描没有的游戏，会被追加（isXboxInstalled + aumid）
 *  2) 已经存在（带存档）的游戏不会被重复追加
 *  3) 结果里没有重复 id
 *
 * 用注入的假数据跑，不依赖本机装了什么游戏。
 */
import { scanGamesWithXboxLibrary } from '../server/gameLibrary.js';

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const base = {
  steamDetected: true,
  steamDirs: [],
  games: [
    {
      id: 'hollow-knight-silksong',
      name: 'Hollow Knight: Silksong (空洞骑士：丝之歌)',
      xboxPackageName: 'teamcherry.hollowknightsilksong*',
      xboxPackageFolder: 'TeamCherry.HollowKnightSilksong_y4jvztpgccj42',
      isSteamDetected: true,
      isXboxDetected: true,
      category: 'B',
    },
  ],
};

const library = [
  // 已在主扫描里（同 PFN）→ 应被去重
  {
    pfn: 'teamcherry.hollowknightsilksong_y4jvztpgccj42',
    aumid: 'teamcherry.hollowknightsilksong_y4jvztpgccj42!Hollow.Knight.Silksong',
    displayName: 'Hollow Knight: Silksong',
    processNames: ['GameLaunchHelper'],
    isGame: true,
    hasWgs: true,
  },
  // 已安装但从未启动（没有存档）→ 应被追加
  {
    pfn: 'contoso.newsandboxgame_abc123',
    aumid: 'contoso.newsandboxgame_abc123!App',
    displayName: 'Contoso Sandbox Game',
    processNames: ['sandbox'],
    isGame: true,
    hasWgs: false,
  },
];

const result = scanGamesWithXboxLibrary({ baseOverride: base, libraryOverride: library });
const byId = result.games.map(g => g.id);
const added = result.games.filter(g => g.isXboxInstalled);

check('主扫描原有游戏保留', result.games.some(g => g.id === 'hollow-knight-silksong'));
check('库内新游戏被追加', added.length === 1, `实际 ${added.length}`);
check('追加项标记 isXboxInstalled', Boolean(added[0]?.isXboxInstalled));
check('追加项带 AUMID（可直启）', Boolean(added[0]?.aumid), String(added[0]?.aumid));
check('追加项带包名用于定位存档', Boolean(added[0]?.xboxPackageFolder));
check('追加项未误报有存档', added[0]?.isXboxDetected === false && added[0]?.isSteamDetected === false);
check('已存在游戏未被重复追加', !byId.includes('xbox-teamcherry.hollowknightsilksong_y4jvztpgccj42'));
check('结果无重复 id', new Set(byId).size === byId.length);
check('xboxLibraryCount 与实际一致', result.xboxLibraryCount === added.length);

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
