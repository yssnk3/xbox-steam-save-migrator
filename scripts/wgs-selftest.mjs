/**
 * Regression test for the structure-preserving Steam -> Xbox writer.
 *
 * Copies a REAL Xbox WGS folder from this machine into a temp directory (the
 * original is only ever read) and runs updateWgsInPlace against the copy, then
 * asserts the UNIVERSAL migration contract — zero per-game configuration:
 *   1. the game-visible structure survives byte-for-byte (container names,
 *      GUIDs, blob GUIDs, manifests, index length, seq/size fields);
 *   2. a blob is written iff its logical file name derives from a Steam file
 *      (exact name, or a version-suffix slot fed by the bare save) — rollback
 *      containers participate, because the game keeps those slots in sync with
 *      the live save;
 *   3. slots with no name-derived source are NEVER written — this is the
 *      black-screen regression guard: hand-mapped cross-name writes once put
 *      Steam bytes into Silksong's sharedData container and killed the game.
 *
 * Run: node scripts/wgs-selftest.mjs
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import {
  parseContainersIndex,
  parseContainersIndexDetailed,
  parseContainerFolderFiles,
  updateWgsInPlace,
  hasExistingWgsStructure,
} from '../server/wgsEngine.js';

const LOCAL = process.env.LOCALAPPDATA || 'C:\\Users\\Default\\AppData\\Local';
const CASES = [
  {
    name: 'Hollow Knight: Silksong',
    pkg: 'TeamCherry.HollowKnightSilksong_y4jvztpgccj42',
    steamFiles: { 'user1.dat': 4096, 'shared.dat': 512, 'user2.dat': 2048 },
    // shared.dat must stay unused: Xbox's sharedData.dat has no same-name
    // Steam source, and cross-name guessing is exactly what black-screened
    // the game. Containers whose every slot has no source stay untouched.
    expectUnused: ['shared.dat'],
    expectNoWriteContainers: ['sharedData'],
    expectNoWriteSlots: ['restore1/NODELrestoreData1.dat', 'restore2/NODELrestoreData1.dat'],
  },
  {
    name: 'Little Nightmares Enhanced Edition',
    pkg: 'NAMCOBANDAIGamesInc.LittleNightmaresEnhancedEditio_gdy2aq6ez762w',
    steamFiles: {
      '1483014080_LNEESaveSlot1.sav': 5184,
      '1483014080_LNEEUserMeta.sav': 1383,
    },
    expectUnused: [],
    expectNoWriteContainers: [],
    expectNoWriteSlots: [],
  },
];

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`);
    failures++;
  }
};

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src)) {
    const s = path.join(src, e);
    const d = path.join(dest, e);
    const st = fs.statSync(s);
    if (st.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function findWgsRoot(pkg) {
  const base = path.join(LOCAL, 'Packages', pkg, 'SystemAppData', 'wgs');
  if (!fs.existsSync(base)) return null;
  for (const sub of fs.readdirSync(base)) {
    const p = path.join(base, sub);
    try {
      if (fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'containers.index'))) return p;
    } catch {}
  }
  return null;
}

/** Snapshot the structure a game depends on. */
function snapshot(wgs) {
  const idx = parseContainersIndexDetailed(path.join(wgs, 'containers.index'));
  return {
    formatVersion: idx.formatVersion,
    pkg: idx.mainPackageName,
    indexBytes: idx.buffer.length,
    containers: idx.containers.map(c => ({
      name: c.containerName,
      cloud: c.cloudName,
      guid: c.guidHex,
      seq: c.seqIndex,
      size: c.size,
      files: parseContainerFolderFiles(path.join(wgs, c.guidHex)).map(f => ({
        logical: f.logicalFileName,
        blobGuid: f.blobGuid,
        md5: f.blobPath && fs.existsSync(f.blobPath)
          ? crypto.createHash('md5').update(fs.readFileSync(f.blobPath)).digest('hex')
          : null,
      })),
    })),
  };
}

const tmpRoot = path.join(os.tmpdir(), 'wgs-selftest-' + Date.now());

for (const c of CASES) {
  console.log(`\n=== ${c.name} ===`);
  const real = findWgsRoot(c.pkg);
  if (!real) {
    console.log('  SKIP  本机未找到该游戏的 Xbox 存档，跳过');
    continue;
  }

  const work = path.join(tmpRoot, c.pkg);
  copyDir(real, work);
  const before = snapshot(work);
  check('目标被识别为已有 WGS 结构', hasExistingWgsStructure(work));

  // Build fake Steam-side saves with recognizable bytes.
  const steamDir = path.join(tmpRoot, c.pkg + '-steam');
  fs.mkdirSync(steamDir, { recursive: true });
  const inputFiles = [];
  const srcMd5 = {};
  let fill = 0x40;
  for (const [name, size] of Object.entries(c.steamFiles)) {
    const p = path.join(steamDir, name);
    const bytes = Buffer.alloc(size, fill++);
    fs.writeFileSync(p, bytes);
    srcMd5[name] = crypto.createHash('md5').update(bytes).digest('hex');
    inputFiles.push({ fileName: name, filePath: p });
  }
  // Junk that must never be packed.
  fs.writeFileSync(path.join(steamDir, 'steam_autocloud.vdf'), 'junk');
  inputFiles.push({ fileName: 'steam_autocloud.vdf', filePath: path.join(steamDir, 'steam_autocloud.vdf') });

  const result = updateWgsInPlace(inputFiles, work);
  const after = snapshot(work);

  // --- Structure must be byte-identical where the game looks ---
  check(
    '容器名集合未变',
    JSON.stringify(before.containers.map(x => x.name)) === JSON.stringify(after.containers.map(x => x.name)),
    JSON.stringify(after.containers.map(x => x.name)),
  );
  check(
    '容器 GUID 未变',
    JSON.stringify(before.containers.map(x => x.guid)) === JSON.stringify(after.containers.map(x => x.guid)),
  );
  check(
    'cloudName 未变',
    JSON.stringify(before.containers.map(x => x.cloud)) === JSON.stringify(after.containers.map(x => x.cloud)),
  );
  check(
    'seq / size 字段未被改写',
    JSON.stringify(before.containers.map(x => [x.seq, x.size])) ===
      JSON.stringify(after.containers.map(x => [x.seq, x.size])),
  );
  check(
    'blob GUID 与逻辑文件名未变',
    JSON.stringify(before.containers.map(x => x.files.map(f => [f.logical, f.blobGuid]))) ===
      JSON.stringify(after.containers.map(x => x.files.map(f => [f.logical, f.blobGuid]))),
  );
  check('containers.index 长度未变', before.indexBytes === after.indexBytes);
  check('containers.index 仍可被旧解析器读取', parseContainersIndex(path.join(work, 'containers.index')).containers.length === before.containers.length);

  // --- Universal slot matching: written iff name-derived (exact or version
  //     suffix, plus the container-name/core-name channel for games that name
  //     slots by CONTAINER while blobs are generically "Data", e.g. LNEE),
  //     across ALL containers — rollback containers included ---
  const steamLower = new Set(Object.keys(c.steamFiles).map(s => s.toLowerCase()));
  const steamCores = new Set(Object.keys(c.steamFiles).map(s =>
    s.toLowerCase().replace(/\.[^.]+$/, '').replace(/^\d+_/, '')));
  const resolvesToSteam = (logical, containerName) => {
    const lower = String(logical).toLowerCase();
    if (steamLower.has(lower)) return true;
    const m = /^(.+?)_\d+(?:\.\d+)*(\.[^.]+)$/.exec(lower);
    if (m && steamLower.has(m[1] + m[2])) return true;
    const core = lower.replace(/\.[^.]+$/, '').replace(/^\d+_/, '');
    if (core && steamCores.has(core)) return true;
    // Container name as slot identity (blobs all named "Data").
    const ccore = String(containerName || '').toLowerCase().replace(/\.[^.]+$/, '').replace(/^\d+_/, '');
    return Boolean(ccore && steamCores.has(ccore));
  };
  const updatedContainers = [...new Set(result.updated.map(u => u.container))].sort();
  const expectedUpdated = before.containers
    .filter(x => x.files.some(f => resolvesToSteam(f.logical, x.name)))
    .map(x => x.name)
    .sort();
  check(
    `所有名字可派生的容器均已更新（含回滚容器）${JSON.stringify(expectedUpdated)}`,
    expectedUpdated.length > 0 &&
      expectedUpdated.every(n => updatedContainers.includes(n)) &&
      updatedContainers.every(n => expectedUpdated.includes(n)),
    JSON.stringify(updatedContainers),
  );
  for (const u of result.updated) {
    const onDisk = crypto.createHash('md5').update(fs.readFileSync(u.blobPath)).digest('hex');
    check(
      `blob 字节等于来源 ${u.sourceFileName} -> ${u.container}/${u.logicalFileName}`,
      onDisk === srcMd5[u.sourceFileName],
    );
  }

  // --- Slots with no name-derived source must be untouched ---
  for (const name of c.expectNoWriteContainers) {
    const b = before.containers.find(x => x.name === name);
    const a = after.containers.find(x => x.name === name);
    check(
      `无来源容器 ${name} 字节未动（跨名猜测写入=黑屏回归）`,
      b && a && JSON.stringify(b.files.map(f => f.md5)) === JSON.stringify(a.files.map(f => f.md5)),
    );
    check(`无来源容器 ${name} 出现在跳过列表`, result.skippedContainers.some(s => s.container === name));
  }
  for (const slot of c.expectNoWriteSlots) {
    const [cname, lname] = slot.split('/');
    const b = before.containers.find(x => x.name === cname)?.files.find(f => f.logical === lname);
    const a = after.containers.find(x => x.name === cname)?.files.find(f => f.logical === lname);
    check(`无来源槽位未动 ${slot}`, b && a && b.md5 === a.md5);
  }

  const unusedAll = [...result.unusedSteamFiles, ...result.historyBackups];
  check(
    `预期未使用的 Steam 文件 ${JSON.stringify(c.expectUnused)}`,
    c.expectUnused.every(n => unusedAll.includes(n)) &&
      result.updated.every(u => Object.keys(c.steamFiles).includes(u.sourceFileName)),
    JSON.stringify(unusedAll),
  );
  check('垃圾文件未被使用', !result.updated.some(u => /steam_autocloud/i.test(u.sourceFileName)));
  console.log(
    `  info  已更新 ${result.updated.length} 个文件 / 跳过容器 ${result.skippedContainers.length} 个 / 未使用的 Steam 文件 ${JSON.stringify(result.unusedSteamFiles)}`,
  );
}

fs.rmSync(tmpRoot, { recursive: true, force: true });
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
