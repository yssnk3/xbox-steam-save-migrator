/**
 * Save-path identifier: given an arbitrary user-selected path (a Steam save
 * folder, an Xbox WGS folder, or a SINGLE save file), figure out which game it
 * belongs to by matching against the preset database + custom games via
 * multiple signals:
 *
 *  - xbox_package_folder : path contains Packages\<PackageFamilyName> matching xboxPackageName wildcard  (high)
 *  - containers_index    : binary package name inside containers.index matches exactly                   (high)
 *  - steam_userdata_appid: path contains userdata\<account>\<appid> matching steamAppId                   (high)
 *  - known_folder        : path matches the game's expanded steamSaveRelPath                            (medium)
 *  - file_pattern        : files inside the folder match the game's saveFilePattern (non-generic)        (medium)
 *  - install_dir         : path sits inside steamapps\common\<dir> whose name matches the game name     (low)
 *  - file_convention     : single file's base name matches a known save-file naming convention (high)   [file only]
 *  - format_fingerprint  : file content byte/first-KB signature matches a known save format + game (high) [file only]
 *  - content_keyword     : file header contains a distinct game keyword (medium)                        [file only]
 *  - path_keyword        : the picked path string contains a game keyword                                 (low)
 *
 * When a lone save file cannot be pinned to a specific game, the result
 * carries `formatHint` (e.g. "Unreal GVAS 存档" / "Team Cherry Unity 存档")
 * instead of silently failing, so the UI can tell the user what it found.
 */
import fs from 'fs';
import path from 'path';
import { GAME_DATABASE, IDENTIFY_ONLY_GAMES } from './gameDatabase.js';
import { getCustomGames } from './customGamesStore.js';
import { findSteamSaveFolder, findXboxWgsFolder } from './gameDetector.js';
import { getSteamEnvironment } from './steamLocator.js';

function expandEnv(p) {
  if (!p) return '';
  return p
    .replace(/%APPDATA%/gi, process.env.APPDATA || '')
    .replace(/%LOCALAPPDATA%/gi, process.env.LOCALAPPDATA || '')
    .replace(/%USERPROFILE%/gi, process.env.USERPROFILE || '')
    .replace(/%PROGRAMDATA%/gi, process.env.PROGRAMDATA || 'C:\\ProgramData')
    .replace(/%STEAM_USERDATA%/gi, '\u0000STEAM_USERDATA\u0000'); // sentinel: unmatched later
}

function wildcardMatch(pattern, text) {
  if (!pattern || !text) return false;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  try {
    return new RegExp('^' + escaped + '$', 'i').test(text);
  } catch {
    return false;
  }
}

// Normalize a path for comparison: lowercase, forward slashes -> backslashes.
function normForCompare(p) {
  return String(p || '').toLowerCase().replace(/\//g, '\\').replace(/\\+/g, '\\').replace(/\\+$/, '');
}

// Read the embedded Package Family Name from a containers.index header.
function readIndexPackageName(indexPath) {
  try {
    const buf = fs.readFileSync(indexPath);
    if (buf.length < 12) return '';
    // version(4) + count(4), then UTF-16LE string: int32 charCount + chars.
    // v14 (real Xbox) adds a 4-byte unknown field before the package name.
    const version = buf.readInt32LE(0);
    let offset = 8;
    if (version >= 14) offset += 4;
    const charLength = buf.readInt32LE(offset);
    offset += 4;
    if (charLength <= 0 || offset + charLength * 2 > buf.length) return '';
    return buf.toString('utf16le', offset, offset + charLength * 2).replace(/\0/g, '');
  } catch {
    return '';
  }
}

// A saveFilePattern is "specific" when it constrains the base name, not just
// the extension (e.g. "SaveData*.sav" is specific, "*.sav" is not).
function isSpecificPattern(pattern) {
  if (!pattern) return false;
  const base = pattern.replace(/\.[^.]*$/, ''); // strip extension
  return /[\w\u4e00-\u9fff]/.test(base.replace(/\*/g, ''));
}

const CONFIDENCE_ORDER = { high: 0, medium: 1, low: 2 };

// ---- Known save-file base-name conventions, mapped to game IDs. ----
// Used to identify single files that sit outside any recognizable folder
// context. Mirrors the C# reference's ProbeSingleFileSignature filename rules.
const FILE_NAME_CONVENTIONS = [
  { id: 'hollow-knight-silksong', re: /^(user[123]|shared)\.dat$/i, pattern: 'user1.dat / user2.dat / user3.dat / shared.dat' },
  // Hollow Knight uses the same user*.dat naming as Silksong; without content
  // fingerprinting the two are ambiguous, so HK's convention ranks medium.
  { id: 'hollow-knight', re: /^user[1-4]\.dat$/i, pattern: 'user1.dat ~ user4.dat (Hollow Knight)', confidence: 'medium' },
  { id: 'hollow-knight', re: /^customknight\.save$/i, pattern: 'CustomKnight.save' },
  { id: 'palworld', re: /^(level\.sav|localdata\.sav|players\.sav)$/i, pattern: 'level.sav / localdata.sav / players.sav' },
  { id: 'brotato', re: /^(save\.json|save_v)/i, pattern: 'save.json / save_v*' },
  { id: 'stardew-valley', re: /^(savegameinfo|StartupPreferences)/i, pattern: 'SaveGameInfo / StartupPreferences' },
  { id: 'stardew-valley', re: /^[^\\/]+_\d+$/i, pattern: '农场名_数字 (Stardew 存档文件夹)', confidence: 'low' },
  { id: 'hades', re: /^profile.+\.(sav|sjson)$/i, pattern: 'Profile*.sav / Profile*.sjson' },
  { id: 'monster-hunter-rise', re: /^data001Slot\.bin$/i, pattern: 'data001Slot.bin' },
  { id: 'no-mans-sky', re: /^(save|meta)\d*\.hg$/i, pattern: 'save*.hg' },
  { id: 'dead-cells', re: /^cells\.sav$/i, pattern: 'cells.sav' },
  { id: 'terraria', re: /\.(wld|plr)$/i, pattern: '*.wld / *.plr (Terraria)' },
  { id: 'terraria', re: /^player\d+\.plr$/i, pattern: 'player1.plr (Terraria)' },
  { id: 'cyberpunk', re: /^savethumb\b|^metadata\.\d+\.json$/i, pattern: 'savethumb*.png / metadata.*.json (Cyberpunk)' },
  { id: 'subnautica', re: /^slot\d*$/i, pattern: 'slot0000 (Subnautica)' },
  { id: 'subnautica', re: /^gameinfo\.json$/i, pattern: 'gameinfo.json (Subnautica)' },
  { id: 'ori-will-of-wisps', re: /oriwispsave/i, pattern: 'oriwispsave*' },
  { id: 'cult-of-the-lamb', re: /^meta_slot_/i, pattern: 'meta_slot_*' },
  { id: 'cult-of-the-lamb', re: /^meta_slot_\d+_meta\.json$/i, pattern: 'meta_slot_*_meta.json' },
  // LNEE 加强版的 Steam/WGS 逻辑文件名都带 LNEE 前缀（LNEESaveSlot*、
  // LNEEUserMeta*），必须精确归位到加强版，不能被原版系列的宽松词抢走
  // （lnee 是 Little Nightmares ENHANCED 的缩写，原版 I/II 不产生该前缀）。
  { id: 'little-nightmares-enhanced-edition', re: /lnee/i, pattern: 'LNEESaveSlot* / LNEEUserMeta*（LNEE 加强版）' },
  { id: 'little-nightmares', re: /littlenightmares/i, pattern: '*littlenightmares*（原版小小梦魇）' },
  { id: 'little-nightmares-2', re: /ln2|littlenightmares2/i, pattern: 'ln2* / *littlenightmares2*' },
  { id: 'atomic-heart', re: /^slot\d+\.dat$|^save_\d+\.dat$/i, pattern: 'slot*.dat / save_*.dat (Atomic Heart)' },
  { id: 'remnant-2', re: /^save\d+_\d+\.sav$/i, pattern: 'save*.sav (Remnant 2)' },
  { id: 'persona-4-golden', re: /^data\d{4}\.bin$/i, pattern: 'DATA*.BIN' },
  { id: 'persona-5-royal', re: /^data\d{4}\.dat$/i, pattern: 'DATA*.DAT' },
  { id: 'cities-skylines', re: /^save\.csk$/i, pattern: 'Save.csk' },
  { id: 'octopath-traveler', re: /^sav\d+\.dat$/i, pattern: 'sav*.dat' },
  { id: 'sea-of-thieves', re: /\.gsv$/i, pattern: '*.gsv' },
  { id: 'resident-evil-2', re: /^data\d+\.bin$/i, pattern: 'data*.bin (RE2)' },
  { id: 'resident-evil-3', re: /^data\d+\.bin$/i, pattern: 'data*.bin (RE3)' },
  { id: 'forza-horizon-5', re: /^user_\d+/i, pattern: 'User_*' },
  { id: 'cuphead', re: /^(save|slot)\d*\.save$/i, pattern: 'save*.save' },
  { id: 'hi-fi-rush', re: /^chiffrerush_save/i, pattern: 'chiffrerush_save*' },
  { id: 'yakuza-7', re: /^savedata\d{4,}\.sav$/i, pattern: 'savedataXXXX.sav (Yakuza)' },
  { id: 'clone-drone', re: /^level_?data/i, pattern: 'leveldata*' },
  { id: 'dead-island-2', re: /^savegame\d+$/i, pattern: 'SaveGame*' },
  { id: 'vampire-survivors', re: /^SaveData_\d+\.sav$/i, pattern: 'SaveData_1.sav / SaveData_2.sav' },
  { id: 'starfield', re: /^save(_backup)?_?\d+\.sfs$/i, pattern: 'save*.sfs' },
  { id: 'lies-of-p', re: /^SaveData\d\.sav$/i, pattern: 'SaveData0.sav / SaveData1.sav (Lies of P)', confidence: 'medium' },
  { id: 'deep-rock-galactic', re: /^(client_save|player|team|save)_?\d*\.sav$/i, pattern: 'client_save*.sav / team*.sav (DRG)' },
  { id: 'persona-3-reload', re: /^SaveData\d+\.sav$/i, pattern: 'SaveData*.sav (P3R)', confidence: 'medium' },
  { id: 'grounded', re: /^save_?\d+$/i, pattern: 'Save* (Grounded)' },
];

// ---- Content format fingerprints. ----
// Each entry describes a recognizable save-file container format. `match`
// is called with the first 4KB buffer + lowercased latin1 text; returning a
// truthy string means the file IS this format. `games` lists which games use
// it; if a game has `keywords`, matching one of them within the sample pins
// the file to that game (HIGH). Otherwise the format alone yields a formatHint.
const CONTENT_FORMATS = [
  {
    // 00 01 00 00 00 FF FF FF FF is the .NET BinaryFormatter stream header, not
    // a Team Cherry marker — Ori and other Unity/.NET games emit it too. Report
    // the engine honestly and let the keyword scan pin the actual game.
    name: '.NET 序列化存档（Unity）',
    match: (buf, text) =>
      buf.length >= 8 &&
      buf[0] === 0x00 && buf[1] === 0x01 &&
      buf[2] === 0x00 && buf[3] === 0x00 &&
      buf[4] === 0x00 && buf[5] === 0xff &&
      buf[6] === 0xff && buf[7] === 0xff,
    games: [
      { id: 'hollow-knight-silksong', keywords: ['silksong', 'team cherry', 'hollowknight', 'tfeirtz'] },
      { id: 'hollow-knight', keywords: ['hollow knight'] },
      { id: 'ori-will-of-wisps', keywords: ['ori', 'moon studios', 'uberstate'] },
    ],
    hint: '.NET BinaryFormatter 序列化存档（Unity 引擎，如 Hollow Knight 系列 / Ori）',
  },
  {
    name: 'Unreal Engine GVAS 存档',
    match: (buf, text) => text.startsWith('gvas') || (buf.length >= 4 && buf[0] === 0x47 && buf[1] === 0x56 && buf[2] === 0x41 && buf[3] === 0x53),
    games: [
      { id: 'palworld', keywords: ['palworld', 'pocketpair'] },
      { id: 'lies-of-p', keywords: ['liesofp', 'lies of p', 'neowiz'] },
      { id: 'deep-rock-galactic', keywords: ['deeprock', 'fsd', 'coffee stain'] },
      { id: 'starfield', keywords: ['starfield', 'sfs'] },
      { id: 'dead-island-2', keywords: ['deadisland', 'deadsland'] },
      { id: 'grounded', keywords: ['grounded', 'maine', 'obsidian'] },
      { id: 'hi-fi-rush', keywords: ['hifirush', 'hi-fi rush', 'tango'] },
      { id: 'resident-evil-2', keywords: ['re2', 'resident evil 2'] },
      { id: 'resident-evil-3', keywords: ['re3', 'resident evil 3'] },
      { id: 'persona-3-reload', keywords: ['persona3', 'p3reload', 'persona 3'] },
    ],
    hint: 'Unreal Engine GVAS 存档 (Palworld / Lies of P / DRG / Starfield / Grounded 等)',
  },
  {
    // Container magics come before the loose text checks below so a compressed
    // or archived save is never mislabelled as JSON/Unity.
    name: 'GZip 压缩存档',
    match: (buf) => buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b,
    games: [],
    hint: 'GZip 压缩存档（需解压后才能判断内部结构）',
  },
  {
    name: 'Zlib 压缩存档',
    match: (buf) => buf.length >= 2 && buf[0] === 0x78 && [0x01, 0x5e, 0x9c, 0xda].includes(buf[1]),
    games: [],
    hint: 'Zlib 压缩存档（需解压后才能判断内部结构）',
  },
  {
    name: 'ZIP 打包存档',
    match: (buf) => buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07),
    games: [
      { id: 'terraria', keywords: ['terraria', 'world', 'player'] },
    ],
    hint: 'ZIP 打包存档（Terraria 等）',
  },
  {
    name: 'PNG 缩略图存档',
    match: (buf) => buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47,
    games: [
      { id: 'cyberpunk', keywords: ['cyberpunk', 'cdprojekt'] },
    ],
    hint: 'PNG 图像（存档缩略图，真实存档在同目录的数据文件中）',
  },
  {
    name: 'Valve KeyValues/VDF 存档',
    match: (buf, text) => /^\s*"[^"\n]{1,64}"\s*\r?\n?\s*\{/.test(text),
    games: [],
    hint: 'Valve KeyValues (VDF) 文本配置/存档',
  },
  {
    name: 'JSON 文本存档',
    match: (buf, text) => {
      const t = text.trimStart();
      return t.startsWith('{') || t.startsWith('[');
    },
    games: [
      { id: 'brotato', keywords: ['brotato', 'run_v3', 'mod_loader_cache', 'difficulty', 'character'] },
      { id: 'vampire-survivors', keywords: ['vampiresurvivors', 'vampire_survivors', 'meta_upgrades'] },
      { id: 'stardew-valley', keywords: ['stardewvalley', '<farmer>', 'savegameinfo'] },
      { id: 'sea-of-thieves', keywords: ['seaofthieves', 'pirate'] },
      { id: 'cities-skylines', keywords: ['citiesskylines', 'colossal order', 'cityName', 'gameTime'] },
    ],
    hint: 'JSON 文本存档',
  },
  {
    name: 'XML 文本存档',
    match: (buf, text) => {
      const t = text.trimStart();
      return t.startsWith('<?xml') || t.startsWith('<SaveGame') || t.startsWith('<Player');
    },
    games: [
      { id: 'stardew-valley', keywords: ['stardewvalley', '<farmer>', 'savegameinfo', 'farmhand'] },
    ],
    hint: 'XML 文本存档',
  },
  {
    name: 'SQLite 数据库存档',
    // "SQLite format 3\0" magic at offset 0
    match: (buf, text) =>
      buf.length >= 16 &&
      buf[0] === 0x53 && buf[1] === 0x51 && buf[2] === 0x4c && buf[3] === 0x69 &&
      buf[4] === 0x74 && buf[5] === 0x65 && buf[6] === 0x20 && buf[7] === 0x66 &&
      buf[8] === 0x6f && buf[9] === 0x72 && buf[10] === 0x6d && buf[11] === 0x61 &&
      buf[12] === 0x74 && buf[13] === 0x20 && buf[14] === 0x33 && buf[15] === 0x00,
    games: [
      { id: 'octopath-traveler', keywords: ['octopath', 'sav'] },
    ],
    hint: 'SQLite 数据库存档',
  },
  {
    name: 'Unity 序列化存档',
    // Unity .NET serialization: 0-3 bytes "Unity" or begins with 14-zero GameManager header
    match: (buf, text) => {
      if (buf.length >= 6 && buf[0] === 0x55 && buf[1] === 0x6e && buf[2] === 0x69 && buf[3] === 0x74 && buf[4] === 0x79) return true;
      // Unity binary serialization usually starts with long runs of zeros
      return text.startsWith('\u0000\u0000\u0000') || text.startsWith('UnityFS');
    },
    games: [
      { id: 'cuphead', keywords: ['cuphead', 'studiomdhr', 'mdhr'] },
      { id: 'clone-drone', keywords: ['clone drone', 'doborog'] },
      { id: 'hollow-knight', keywords: [] },
    ],
    hint: 'Unity 引擎序列化存档',
  },
  {
    name: 'Stardew Valley 专属存档',
    match: (buf, text) => /<farmer>|<savegameinfo>|stardewvalley/i.test(text),
    games: [{ id: 'stardew-valley', keywords: [] }],
    hint: 'Stardew Valley (星露谷物语) 存档',
  },
  {
    name: 'Brotato 专属存档',
    match: (buf, text) => /brotato|mod_loader_cache|run_v3/i.test(text),
    games: [{ id: 'brotato', keywords: [] }],
    hint: 'Brotato (土豆兄弟) 存档',
  },
  {
    name: 'Hades 二进制存档',
    match: (buf, text) => /hades|zagreus|supergiant/i.test(text),
    games: [{ id: 'hades', keywords: [] }],
    hint: 'Hades (哈迪斯) 存档',
  },
  {
    name: 'Vampire Survivors 存档',
    match: (buf, text) => /vampiresurvivors|vampire_survivors/i.test(text),
    games: [{ id: 'vampire-survivors', keywords: [] }],
    hint: 'Vampire Survivors (吸血鬼幸存者) 存档',
  },
];

// ---- Game-level keyword fingerprints (content probe). ----
// Ordered shortest-first is not required; keep distinct keywords per game.
const CONTENT_KEYWORDS = [
  { id: 'hollow-knight-silksong', keywords: ['silksong', 'tfeirtz', 'hollowknight silksong'] },
  { id: 'hollow-knight', keywords: ['hollow knight'] },
  { id: 'palworld', keywords: ['palworld', 'pocketpair'] },
  { id: 'lies-of-p', keywords: ['liesofp', 'lies of p'] },
  { id: 'deep-rock-galactic', keywords: ['deeprock', 'fsd'] },
  { id: 'starfield', keywords: ['starfield'] },
  { id: 'grounded', keywords: ['grounded', 'obsidian'] },
  { id: 'dead-island-2', keywords: ['deadisland', 'dead island'] },
  { id: 'brotato', keywords: ['brotato', 'run_v3', 'mod_loader_cache'] },
  { id: 'stardew-valley', keywords: ['stardewvalley', '<farmer>', 'savegameinfo'] },
  { id: 'vampire-survivors', keywords: ['vampiresurvivors', 'vampire_survivors'] },
  { id: 'hades', keywords: ['hades', 'zagreus'] },
  { id: 'monster-hunter-rise', keywords: ['monster hunter', 'mhrise'] },
  { id: 'no-mans-sky', keywords: ['nomanssky', 'no man\'s sky'] },
  { id: 'sea-of-thieves', keywords: ['seaofthieves', 'sea of thieves'] },
  { id: 'yakuza-7', keywords: ['yakuza', 'like a dragon'] },
  { id: 'persona-3-reload', keywords: ['persona3', 'p3reload'] },
  { id: 'persona-4-golden', keywords: ['persona4', 'p4g'] },
  { id: 'persona-5-royal', keywords: ['persona5', 'p5r'] },
  { id: 'dead-cells', keywords: ['deadcells', 'motion twin', 'motiontwin'] },
  { id: 'clone-drone', keywords: ['clone drone', 'leveldata', 'doborog'] },
  { id: 'cuphead', keywords: ['cuphead', 'studiomdhr', 'inkwell'] },
  { id: 'forza-horizon-5', keywords: ['forza', 'fh5', 'playground games'] },
  { id: 'cities-skylines', keywords: ['citiesskylines', 'colossal order', 'cityName'] },
  { id: 'octopath-traveler', keywords: ['octopath', 'sqex', 'sav0000'] },
  { id: 'terraria', keywords: ['terraria', 're-logic', 'world'] },
  { id: 'cyberpunk', keywords: ['cyberpunk', 'cdprojekt'] },
  { id: 'subnautica', keywords: ['subnautica', 'unknown worlds'] },
  { id: 'ori-will-of-wisps', keywords: ['oriwispsave', 'moon studios'] },
  { id: 'cult-of-the-lamb', keywords: ['cultofthelamb', 'massive monster'] },
  { id: 'atomic-heart', keywords: ['atomicheart', 'atomic heart', 'mundfish'] },
  { id: 'remnant-2', keywords: ['remnant', 'gunfire games'] },
  { id: 'high-on-life', keywords: ['highonlife', 'high on life', 'squanch'] },
  { id: 'little-nightmares', keywords: ['littlenightmares', 'lnee', 'tarsier'] },
  { id: 'little-nightmares-2', keywords: ['littlenightmares2', 'ln2'] },
];

// Keywords found anywhere in a picked path string.
const PATH_KEYWORDS = [
  { id: 'hollow-knight-silksong', words: ['silksong'] },
  { id: 'hollow-knight', words: ['hollowknight', 'hollow knight'] },
  { id: 'stardew-valley', words: ['stardewvalley', 'stardew valley'] },
  { id: 'brotato', words: ['brotato'] },
  { id: 'dead-island-2', words: ['deadisland2', 'dead island 2'] },
  { id: 'palworld', words: ['palworld', 'pocketpair'] },
  { id: 'cyberpunk', words: ['cyberpunk'] },
  { id: 'terraria', words: ['terraria'] },
  { id: 'hades', words: ['hades'] },
  { id: 'sea-of-thieves', words: ['seaofthieves', 'sea of thieves'] },
  { id: 'grounded', words: ['grounded'] },
  { id: 'vampire-survivors', words: ['vampiresurvivors', 'vampire_survivors'] },
  { id: 'monster-hunter-rise', words: ['monsterhunterrise', 'monster hunter rise'] },
  { id: 'no-mans-sky', words: ['nomanssky', 'no mans sky'] },
  { id: 'persona-3-reload', words: ['persona3reload', 'persona 3 reload'] },
  { id: 'persona-4-golden', words: ['persona4golden', 'persona 4 golden'] },
  { id: 'persona-5-royal', words: ['persona5royal', 'persona 5 royal'] },
  { id: 'hi-fi-rush', words: ['hifirush', 'hi-fi rush'] },
  { id: 'octopath-traveler', words: ['octopathtraveler', 'octopath traveler'] },
  { id: 'cities-skylines', words: ['citiesskylines', 'cities skylines'] },
  { id: 'dead-cells', words: ['deadcells', 'dead cells'] },
  { id: 'cuphead', words: ['cuphead'] },
  { id: 'clone-drone', words: ['clonedrone', 'clone drone'] },
  { id: 'forza-horizon-5', words: ['forzahorizon5', 'forza horizon 5'] },
  { id: 'resident-evil-2', words: ['residentevil2', 'resident evil 2'] },
  { id: 'resident-evil-3', words: ['residentevil3', 'resident evil 3'] },
  { id: 'cities-skylines', words: ['citiesskylines', 'cities skylines'] },
  { id: 'yakuza-7', words: ['yakuza', 'likeadragon', 'like a dragon'] },
  { id: 'hi-fi-rush', words: ['hifirush'] },
];

// Extensions we're willing to content-probe. Logs, configs, and text dumps
// reference arbitrary game paths and must never drive a verdict.
const SAVE_EXT_RE = /\.(dat|sav|sfs|bin|save|gsv|hg|csk|wld|plr|sjson|json|sol|slot|lua|zsav|sd|zip|celeste)$/i;

function readHeadBytes(filePath, maxLen = 4096) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const chunk = Buffer.alloc(maxLen);
    const read = fs.readSync(fd, chunk, 0, maxLen, 0);
    fs.closeSync(fd);
    return chunk.subarray(0, read);
  } catch {
    return null;
  }
}

// Specificity ranking for reporting. Several signatures can match the same
// bytes (a Stardew save is XML *and* Stardew-specific); the most specific name
// is the useful answer, and a loose text shape must never outrank an engine or
// game signature. Probing multiple files previously let the LAST file overwrite
// the reported format, which mislabelled folders.
const FORMAT_RANK = {
  'Stardew Valley 专属存档': 5,
  'Brotato 专属存档': 5,
  'Hades 二进制存档': 5,
  'Vampire Survivors 存档': 5,
  '.NET 序列化存档（Unity）': 4,
  'Unreal Engine GVAS 存档': 4,
  'Unity 序列化存档': 4,
  'SQLite 数据库存档': 4,
  'ZIP 打包存档': 4,
  'GZip 压缩存档': 4,
  'Zlib 压缩存档': 4,
  'PNG 缩略图存档': 4,
  'XML 文本存档': 2,
  'JSON 文本存档': 2,
  'Valve KeyValues/VDF 存档': 1,
};
const formatRank = (name) => (name in FORMAT_RANK ? FORMAT_RANK[name] : 3);

/**
 * Coarse structural class for a file no signature matched. Reporting "二进制/
 * 文本存档（结构未知）" is more useful than reporting nothing — the user asked
 * what class of save this is, and "we can read it but don't recognize the
 * layout" is an honest answer.
 */
function coarseFormatName(buf) {
  if (!buf || buf.length === 0) return null;
  let nul = 0;
  let ctrl = 0;
  const n = Math.min(buf.length, 512);
  for (let i = 0; i < n; i++) {
    const b = buf[i];
    if (b === 0) nul++;
    else if (b < 0x09 || (b > 0x0d && b < 0x20)) ctrl++;
  }
  const binaryish = (nul + ctrl) / n > 0.05;
  return binaryish ? '二进制存档（结构未知）' : '文本存档（结构未知）';
}

export function identifySavePath(inputPath) {
  const raw = String(inputPath || '').trim();
  const result = { side: 'unknown', matches: [] };

  if (!raw) {
    result.error = '路径为空';
    return result;
  }
  if (!fs.existsSync(raw)) {
    result.error = '路径不存在：' + raw;
    return result;
  }

  const allGames = [
    ...GAME_DATABASE,
    // Identify-only games contribute to recognition but never appear in the
    // migration scan (gameDetector.js ignores IDENTIFY_ONLY_GAMES).
    ...IDENTIFY_ONLY_GAMES.map(g => ({ ...g, category: g.category || 'C' })),
    ...getCustomGames().map(c => ({ ...c, category: c.category || 'A' })),
  ];
  const gamesById = new Map(allGames.map(g => [g.id, g]));

  const lower = normForCompare(raw);
  const baseName = path.basename(raw);
  const baseLower = baseName.toLowerCase();
  const byId = new Map(); // gameId -> match entry (merge evidence across signals)
  // Structural class recorded when no signature matched, used as the last-resort
  // answer to "这是什么类的存档" instead of reporting nothing.
  let coarseFormat = null;
  let bestFormatRank = -1;

  const addMatch = (game, confidence, matchType, evidence) => {
    if (!game || !game.id) return;
    const existing = byId.get(game.id);
    if (existing) {
      existing.evidence.push(evidence);
      if (!existing.matchTypes.includes(matchType)) existing.matchTypes.push(matchType);
      // Upgrade confidence if a stronger signal fires for the same game.
      if (CONFIDENCE_ORDER[confidence] < CONFIDENCE_ORDER[existing.confidence]) {
        existing.confidence = confidence;
      }
      return;
    }
    byId.set(game.id, {
      id: game.id,
      name: game.name,
      iconUrl: game.iconUrl || null,
      category: game.category || 'A',
      notes: game.notes || null,
      steamXboxByteIncompatible: Boolean(game.steamXboxByteIncompatible),
      needsConversionTool: game.needsConversionTool || null,
      accountBound: Boolean(game.accountBound),
      steamAppId: game.steamAppId || null,
      xboxPackageName: game.xboxPackageName || null,
      confidence,
      matchTypes: [matchType],
      evidence: [evidence],
    });
  };

  // Content-based probe of a single save file: detect its container format
  // (Team Cherry / UE GVAS / JSON / XML / Stardew / Brotato / Hades / VS) and,
  // if a specific game can be pinned within that format, record it as a
  // HIGH-confidence fingerprint. This is the core "works even without the game
  // installed" signal — it needs no path context. Recognized-but-unpinned
  // formats set `formatHint` for an honest report.
  const probeFileContent = (filePath, srcLabel) => {
    const headBuf = readHeadBytes(filePath);
    if (!headBuf || headBuf.length === 0) return;
    let headText = headBuf.toString('latin1');
    // Strip a UTF-8 BOM before text matching: Stardew's XML saves start with
    // EF BB BF, which is not whitespace, so `<?xml` checks silently failed.
    if (headBuf.length >= 3 && headBuf[0] === 0xef && headBuf[1] === 0xbb && headBuf[2] === 0xbf) {
      headText = headText.slice(3);
    }
    const headLower = headText.toLowerCase();
    // Evaluate ALL matching signatures and keep the most specific one; array
    // order alone would report "XML 文本存档" for a Stardew save.
    const hits = CONTENT_FORMATS.filter(fmt => fmt.match(headBuf, headLower));
    const fmtHit = hits.length
      ? hits.reduce((best, f) => (formatRank(f.name) > formatRank(best.name) ? f : best))
      : null;
    let formatPinned = false;

    if (fmtHit) {
      for (const g of fmtHit.games) {
        if (!g.keywords || g.keywords.length === 0) continue;
        const kw = g.keywords.find(k => headLower.includes(k));
        if (kw) {
          const game = gamesById.get(g.id);
          if (game) {
            formatPinned = true;
            addMatch(
              game, 'high', 'format_fingerprint',
              `${srcLabel ? srcLabel + ' ' : ''}文件头为 ${fmtHit.name}，并包含专属标识 "${kw}"`
            );
          }
        }
      }
      // Report the most specific format seen across every probed file. A format
      // that also pinned a game always wins over one that only matched bytes.
      const rank = formatRank(fmtHit.name) + (formatPinned ? 10 : 0);
      if (rank > bestFormatRank) {
        bestFormatRank = rank;
        result.formatDetected = fmtHit.name;
      }
      if (!formatPinned && !result.formatHint) {
        result.formatHint = fmtHit.hint;
      }
    } else {
      // No known format magic; bare keyword scan as a fallback.
      for (const ck of CONTENT_KEYWORDS) {
        const kw = ck.keywords.find(k => headLower.includes(k));
        if (kw) {
          const game = gamesById.get(ck.id);
          if (game) {
            addMatch(game, 'medium', 'content_keyword', `${srcLabel ? srcLabel + ' ' : ''}文件内容包含关键词 "${kw}"`);
          }
        }
      }
      // Keep a coarse structural class so the report is never blank.
      if (!coarseFormat) coarseFormat = coarseFormatName(headBuf);
    }
  };

  // For directory input, probe save files inside it so a picked folder still
  // resolves even when the game isn't installed. Save-extension files are
  // preferred, but extension-less saves (Stardew's XML, WGS blobs, Steam
  // userdata files) must be probed too — the whole point of a content
  // fingerprint is that it does not depend on the file name.
  const probeDirectoryContent = (dirPath) => {
    // Platform bookkeeping files are not saves. Reading them made a folder whose
    // only top-level file is steam_autocloud.vdf report "VDF 存档".
    const SYSTEM_FILE_RE = /^(steam_autocloud\.vdf|remotecache\.vdf|sharedconfig\.vdf|screenshots\.vdf|localconfig\.vdf|thumbs\.db|desktop\.ini|containers?\.index)$/i;

    const listProbable = (dir) => {
      let names = [];
      try { names = fs.readdirSync(dir); } catch { return { files: [], subDirs: [] }; }
      const files = [];
      const subDirs = [];
      for (const n of names) {
        let st;
        try { st = fs.statSync(path.join(dir, n)); } catch { continue; }
        if (st.isDirectory()) subDirs.push(n);
        else if (st.isFile() && !SYSTEM_FILE_RE.test(n) && st.size > 0) files.push(n);
      }
      // Save-extension files first, then anything else (extension-less saves).
      files.sort((a, b) => (SAVE_EXT_RE.test(b) ? 1 : 0) - (SAVE_EXT_RE.test(a) ? 1 : 0));
      return { files, subDirs };
    };

    const top = listProbable(dirPath);
    for (const f of top.files.slice(0, 6)) {
      probeFileContent(path.join(dirPath, f), `目录内文件 "${f}"`);
    }

    // Many real layouts bury the saves several levels down: Stardew keeps a
    // folder per farm, and Steam Cloud's "ac" mirror nests as
    // ac\WinSavedGames\<Publisher>\<Game>\... Walk down (bounded) until a real
    // save file is found, otherwise those folders report no format at all.
    if (top.files.length === 0) {
      const MAX_DEPTH = 6; // Steam Cloud "ac" mirrors nest ~5 levels deep
      const MAX_FILES = 10;
      const MAX_LISTINGS = 60; // hard bound so a huge tree can't stall the scan
      let probed = 0;
      let listings = 0;
      const descend = (dir, relLabel, depth) => {
        if (depth > MAX_DEPTH || probed >= MAX_FILES || listings >= MAX_LISTINGS) return;
        // An engine/game-level signature is a good enough answer; stop digging.
        if (bestFormatRank >= 4) return;
        listings++;
        const here = listProbable(dir);
        for (const f of here.files.slice(0, 4)) {
          if (probed >= MAX_FILES) return;
          probed++;
          probeFileContent(path.join(dir, f), `子目录 "${relLabel}" 内文件 "${f}"`);
        }
        if (here.files.length > 0) return; // found data at this level
        for (const sub of here.subDirs.slice(0, 3)) {
          descend(path.join(dir, sub), relLabel ? `${relLabel}/${sub}` : sub, depth + 1);
        }
      };
      for (const sub of top.subDirs.slice(0, 3)) {
        descend(path.join(dirPath, sub), sub, 1);
      }
    }
  };

  /**
   * An Xbox WGS folder holds only containers.index plus 32-hex container
   * directories; the real save bytes are extension-less blob files one level
   * down. Without descending, every Xbox save reported an empty format.
   */
  const probeWgsContainers = (wgsPath) => {
    let entries = [];
    try { entries = fs.readdirSync(wgsPath); } catch { return; }
    const containerDirs = entries.filter(e => {
      if (!/^[0-9A-Fa-f]{32}$/.test(e)) return false;
      try { return fs.statSync(path.join(wgsPath, e)).isDirectory(); } catch { return false; }
    }).slice(0, 4);
    for (const dir of containerDirs) {
      const full = path.join(wgsPath, dir);
      let blobs = [];
      try { blobs = fs.readdirSync(full); } catch { continue; }
      const blobFiles = blobs.filter(b => {
        if (/^container\.\d+$/i.test(b)) return false; // manifest, not save data
        try { return fs.statSync(path.join(full, b)).isFile(); } catch { return false; }
      }).slice(0, 3);
      for (const b of blobFiles) {
        probeFileContent(path.join(full, b), `Xbox 容器内存档 "${b.slice(0, 8)}…"`);
      }
    }
  };

  // ---- Side detection ----
  const hasContainersIndex = fs.existsSync(path.join(raw, 'containers.index'));
  const inPackagesDir = /[\\/]packages[\\/][^\\/]+/.test(lower);
  if (hasContainersIndex || (inPackagesDir && /(wgs|localcache)/.test(lower))) {
    result.side = 'xbox';
  } else if (/[\\/]userdata[\\/]\d+[\\/]/.test(lower)) {
    result.side = 'steam';
  }

  // ---- Signal 1: Xbox package folder name in path (high) ----
  const pkgFolderMatch = lower.match(/[\\/]packages[\\/]([^\\/]+)/);
  if (pkgFolderMatch) {
    const folderName = pkgFolderMatch[1];
    for (const g of allGames) {
      if (g.xboxPackageName && wildcardMatch(g.xboxPackageName.toLowerCase(), folderName)) {
        addMatch(g, 'high', 'xbox_package_folder', `Xbox 包目录 "${folderName}" 匹配模式 ${g.xboxPackageName}`);
      }
    }
    if (result.side === 'unknown') result.side = 'xbox';
  }

  // ---- Signal 2: embedded package name in containers.index (high) ----
  if (hasContainersIndex) {
    const pkg = readIndexPackageName(path.join(raw, 'containers.index'));
    if (pkg) {
      result.indexPackageName = pkg;
      for (const g of allGames) {
        if (g.xboxPackageName && wildcardMatch(g.xboxPackageName.toLowerCase(), pkg.toLowerCase())) {
          addMatch(g, 'high', 'containers_index', `containers.index 内嵌包名 "${pkg}" 精确匹配 ${g.xboxPackageName}`);
        }
      }
    }
    if (result.side === 'unknown') result.side = 'xbox';
  }

  // ---- Signal 3: Steam userdata appid (high) ----
  const udMatch = lower.match(/[\\/]userdata[\\/](\d+)[\\/](\d+)/);
  if (udMatch) {
    const appid = udMatch[2];
    for (const g of allGames) {
      if (g.steamAppId && String(g.steamAppId) === appid) {
        addMatch(g, 'high', 'steam_userdata_appid', `Steam userdata AppID ${appid} 精确匹配`);
      }
    }
    result.side = 'steam';
  }

  // ---- Signal 4: known save folder pattern (medium) ----
  const stats = (() => { try { return fs.statSync(raw); } catch { return null; } })();
  if (stats && stats.isDirectory()) {
    for (const g of allGames) {
      if (!g.steamSaveRelPath) continue;
      const expanded = normForCompare(expandEnv(g.steamSaveRelPath));
      if (!expanded || expanded.includes('\u0000')) continue; // %STEAM_USERDATA% sentinel — covered by appid signal
      const target = lower;
      if (
        target.startsWith(expanded + '\\') ||
        expanded.startsWith(target + '\\') ||
        target === expanded
      ) {
        addMatch(g, 'medium', 'known_folder', `路径匹配已知存档目录模式 ${g.steamSaveRelPath}`);
      }
    }
  }

  // ---- Signal 5: file name pattern inside the folder (medium) ----
  // Skipped for WGS folders: their contents are GUID blobs + system files
  // (containers.index, container.N) that carry no game-identifying names.
  if (stats && stats.isDirectory() && !hasContainersIndex) {
    let files = [];
    try {
      files = fs.readdirSync(raw).filter(f => {
        try {
          if (!fs.statSync(path.join(raw, f)).isFile()) return false;
        } catch { return false; }
        // Skip Xbox/system artifacts that leak into normal folders too
        if (/^containers?\.index$/i.test(f)) return false;
        if (/^container\.\d+$/i.test(f)) return false;
        if (/^[0-9a-f]{32}$/i.test(f)) return false;
        return true;
      });
    } catch { /* ignore */ }

    if (files.length > 0 && files.length <= 200) {
      // Directory-level joint verdict: count how many files per game match a
      // *specific* saveFilePattern. Two or more distinct filenames agreeing on
      // one game is strong evidence and upgrades the verdict to high. Shared
      // conventions (e.g. user1.dat used by both Hollow Knight games) are
      // deliberately excluded here so ambiguous names can't inflate a verdict.
      const gameFileHits = new Map(); // gameId -> Set of matched filenames

      for (const g of allGames) {
        if (!g.saveFilePattern) continue;
        // Only specific patterns vote here. Generic ones (*.dat, *.sav, and
        // especially the bare "*" used by Stardew Valley) match almost any
        // file, so they'd wrongly flag arbitrary folders as that game.
        if (!isSpecificPattern(g.saveFilePattern)) continue;
        const hits = files.filter(f => wildcardMatch(g.saveFilePattern.toLowerCase(), f.toLowerCase()));
        if (hits.length > 0) {
          const set = gameFileHits.get(g.id) || new Set();
          hits.forEach(h => set.add(h));
          gameFileHits.set(g.id, set);
          addMatch(
            g,
            'medium',
            'file_pattern',
            `目录内文件 "${hits[0]}" 匹配专属存档文件名模式 ${g.saveFilePattern}`
          );
        }
      }

      // Naming conventions still vote per-file in a directory (e.g. a folder
      // full of user1.dat/user2.dat/shared.dat is clearly Silksong), but they
      // do NOT count toward the joint ≥2 upgrade — ambiguous names shared by
      // multiple games must not inflate a verdict.
      for (const g of allGames) {
        for (const conv of FILE_NAME_CONVENTIONS) {
          if (conv.id !== g.id) continue;
          const hit = files.find(f => conv.re.test(f));
          if (hit) {
            addMatch(g, conv.confidence || 'high', 'file_convention', `目录内文件 "${hit}" 符合已知存档命名约定：${conv.pattern}`);
          }
        }
      }

      // ≥2 distinct filenames pointing to the same game => high confidence.
      for (const [gid, set] of gameFileHits) {
        if (set.size >= 2) {
          const game = gamesById.get(gid);
          if (game) {
            addMatch(game, 'high', 'file_pattern', `目录内 ${set.size} 个文件（${[...set].slice(0, 3).join('、')}）共同指向该游戏`);
          }
        }
      }
    }

    // Content probe inside the directory — resolves picked folders even when
    // the game isn't installed (only path-type signals would otherwise fail).
    probeDirectoryContent(raw);
  }

  // Xbox WGS content probe. This must sit OUTSIDE the Signal-5 block above:
  // that block is gated on `!hasContainersIndex`, so a WGS folder skipped the
  // content probe entirely and always reported an empty save format.
  if (stats && stats.isDirectory() && hasContainersIndex) {
    probeWgsContainers(raw);
  }

  // ---- Signal 5b: single FILE identification ----
  // Directory signals can't fire for a lone picked file; probe base name
  // conventions, content format fingerprints, keywords, and path text.
  // When the file is inside a WGS container folder, its parent paths already
  // carry the package name, so Signal 1/2 have usually resolved it already.
  if (stats && stats.isFile()) {
    // 5b-1: filename convention (high confidence unless overridden)
    for (const conv of FILE_NAME_CONVENTIONS) {
      if (conv.re.test(baseName)) {
        const game = gamesById.get(conv.id);
        if (game) {
          addMatch(game, conv.confidence || 'high', 'file_convention', `文件名 "${baseName}" 符合已知存档命名约定：${conv.pattern}`);
        }
      }
    }

    // 5b-2: saveFilePattern direct match (single file) — only specific
    // patterns count here; generic ones (*.dat, *.sav) would fire on almost
    // any file and just add noise to the single-file verdict.
    for (const g of allGames) {
      if (!g.saveFilePattern) continue;
      if (!isSpecificPattern(g.saveFilePattern)) continue;
      if (wildcardMatch(g.saveFilePattern.toLowerCase(), baseLower)) {
        addMatch(g, 'high', 'file_convention', `文件名 "${baseName}" 精确匹配存档模式 ${g.saveFilePattern}`);
      }
    }

    // 5b-3: content probe (format fingerprint then game keywords)
    probeFileContent(raw);

    // 5b-4: path keyword scan (low confidence)
    for (const pk of PATH_KEYWORDS) {
      const hitWord = pk.words.find(w => lower.includes(w));
      if (hitWord) {
        const game = gamesById.get(pk.id);
        if (game) {
          addMatch(game, 'low', 'path_keyword', `路径包含关键词 "${hitWord}"`);
        }
      }
    }
  }

  // ---- Signal 6: steamapps\common install dir (low) ----
  const commonMatch = lower.match(/[\\/]steamapps[\\/]common[\\/]([^\\/]+)/);
  if (commonMatch) {
    const dirName = commonMatch[1];
    for (const g of allGames) {
      // Match the ASCII portion of the game name (before the CJK part in parens)
      const nameEn = String(g.name || '').split('(')[0].trim().toLowerCase();
      if (nameEn.length >= 4 && (dirName.includes(nameEn) || nameEn.includes(dirName))) {
        addMatch(g, 'low', 'install_dir', `位于 steamapps\\common\\${dirName}，与游戏名 "${g.name}" 相近`);
      }
    }
    if (result.side === 'unknown') result.side = 'steam';
  }

  result.matches = [...byId.values()].sort((a, b) => {
    // 1) Confidence tier first.
    const c = CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence];
    if (c !== 0) return c;
    // 2) Content fingerprint evidence is decisive — beats pure name guessing.
    const aFp = a.matchTypes.includes('format_fingerprint') ? 1 : 0;
    const bFp = b.matchTypes.includes('format_fingerprint') ? 1 : 0;
    if (aFp !== bFp) return bFp - aFp;
    // 3) More evidence wins.
    return b.evidence.length - a.evidence.length;
  }).slice(0, 5);

  result.matches.forEach(m => { m.evidenceSummary = m.evidence.join('；'); });

  // Fall back to the coarse structural class so "这是什么类的存档" always has
  // an answer, even when no game-specific signature matched.
  if (!result.formatDetected && coarseFormat) {
    result.formatDetected = coarseFormat;
  }

  // Finalize the format class. An Xbox save is always structurally identifiable
  // (containers.index, or a Packages\...\SystemAppData\wgs path), so anything
  // else that holds real save files is by definition the plain-file layout the
  // Steam build reads. Leaving `side: 'unknown'` for an ordinary Steam save
  // folder made the UI unable to name the format and blocked direction choice.
  if (result.side === 'unknown') {
    const looksXbox = /[\\/]systemappdata[\\/]wgs([\\/]|$)/i.test(lower)
      || /[\\/]packages[\\/][^\\/]+[\\/]/i.test(lower)
      || fs.existsSync(path.join(raw, 'containers.index'));
    if (looksXbox) {
      result.side = 'xbox';
    } else {
      // Require actual evidence of a save before claiming a side.
      let hasSaveContent = false;
      try {
        const st = fs.statSync(raw);
        if (st.isFile()) {
          hasSaveContent = SAVE_EXT_RE.test(path.basename(raw));
        } else {
          hasSaveContent = fs.readdirSync(raw).some(f => {
            try {
              return fs.statSync(path.join(raw, f)).isFile() && SAVE_EXT_RE.test(f);
            } catch { return false; }
          });
        }
      } catch {}
      if (hasSaveContent || result.matches.length > 0) result.side = 'steam';
    }
  }

  return result;
}

/**
 * Look up the FULL game record (with per-game extras like steamFileRenameMap)
 * by id across the preset database, identify-only list, and custom games.
 * @param {string} gameId
 * @returns {object|null}
 */
export function findGameById(gameId) {
  const all = [
    ...GAME_DATABASE,
    ...IDENTIFY_ONLY_GAMES.map(g => ({ ...g, category: g.category || 'C' })),
    ...getCustomGames().map(c => ({ ...c, category: c.category || 'A' })),
  ];
  return all.find(g => g.id === gameId) || null;
}

/**
 * Given a game that has been identified, resolve BOTH platform save paths to
 * actual filesystem paths so the UI can auto-fill the counterpart side of a
 * manual migration (single identified path -> everything filled in).
 * @param {string} gameId
 * @returns {{ found: boolean, gameId?: string, name?: string,
 *             steamSavePath?: string|null, steamExists?: boolean,
 *             xboxWgsPath?: string|null, xboxExists?: boolean }}
 */
/** Directory stats used to describe (and rank) a side's local save. */
function describeSaveDir(dirPath, isXbox) {
  const out = { lastModified: null, size: 0, fileCount: 0 };
  if (!dirPath) return out;
  try {
    // Xbox freshness is carried by containers.index (what the cloud compares),
    // Steam freshness by the save directory itself.
    const stampPath = isXbox && fs.existsSync(path.join(dirPath, 'containers.index'))
      ? path.join(dirPath, 'containers.index')
      : dirPath;
    out.lastModified = fs.statSync(stampPath).mtime;
  } catch {}
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e);
      try {
        const st = fs.statSync(p);
        if (st.isDirectory()) walk(p);
        else { out.size += st.size; out.fileCount++; }
      } catch {}
    }
  };
  walk(dirPath);
  return out;
}

export function resolveCounterpartPath(gameId) {
  const game = findGameById(gameId);
  if (!game) return { found: false };

  const steamEnv = getSteamEnvironment();
  let steamSavePath = null;
  try { steamSavePath = findSteamSaveFolder(game, steamEnv); } catch {}
  let xboxWgsPath = null;
  let xboxPackageFolder = null;
  if (game.xboxPackageName) {
    try {
      const xi = findXboxWgsFolder(game.xboxPackageName);
      if (xi) { xboxWgsPath = xi.wgsFolderPath; xboxPackageFolder = xi.packageFolder; }
    } catch {}
  }

  // Per-side stats let the UI show what's actually on each end and recommend
  // the direction that carries the newer save.
  const steamStat = describeSaveDir(steamSavePath, false);
  const xboxStat = describeSaveDir(xboxWgsPath, true);

  return {
    found: true,
    gameId: game.id,
    name: game.name,
    category: game.category || null,
    notes: game.notes || null,
    steamSavePath: steamSavePath || null,
    steamExists: Boolean(steamSavePath),
    steamLastModified: steamStat.lastModified,
    steamSize: steamStat.size,
    steamFileCount: steamStat.fileCount,
    xboxWgsPath,
    xboxPackageFolder,
    xboxExists: Boolean(xboxWgsPath),
    xboxLastModified: xboxStat.lastModified,
    xboxSize: xboxStat.size,
    xboxFileCount: xboxStat.fileCount,
  };
}