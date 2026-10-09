/**
 * 全库可移植性测试 / 预演（只读预测 + 沙箱实写回归）
 *
 * 用法: node scripts/portability-test.mjs [--report-only]
 *
 * 两层：
 *  1. 预测层（纯只读，绝不写盘）：对 scanInstalledGames() 检出的每款游戏跑
 *     双向预测，输出 绿/黄/红 可移植性清单。黄/红 是业务结论，不算失败；
 *     只有预测器自身异常（error）才计数。
 *  2. 沙箱层（回归网）：把每个检测到的 Xbox WGS 目录【只读复制】到 temp，
 *     按真实 Steam 侧文件名（没有就用容器结构派生）实际执行 updateWgsInPlace，
 *     断言结构逐字节不变、目标 blob MD5 = 来源、无来源槽位不动。
 *     把原来写死 2 个用例的 wgs-selftest 泛化成覆盖本机全部 WGS 结构。
 *
 * 原始目录全程只读；任何断言失败 exit 1。
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
import { predictSteamToXbox, predictXboxToSteam } from '../server/portability.js';
import { scanInstalledGames } from '../server/gameDetector.js';

const reportOnly = process.argv.includes('--report-only');
let failures = 0;
const fail = (label, detail = '') => {
  console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`);
  failures++;
};
const ok = (label) => console.log(`  PASS  ${label}`);

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

function snapshot(wgs) {
  const idx = parseContainersIndexDetailed(path.join(wgs, 'containers.index'));
  return {
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

// The universal matching contract (exact / version-suffix / container core),
// re-derived here INDEPENDENTLY of the engine — same approach as wgs-selftest.
function steamCore(name) {
  return String(name).toLowerCase().replace(/\.[^.]+$/, '').replace(/^\d+_/, '');
}
function resolvesToSteam(logical, containerName, steamNames, steamCores) {
  const lower = String(logical).toLowerCase();
  if (steamNames.has(lower)) return true;
  const m = /^(.+?)_\d+(?:\.\d+)*(\.[^.]+)$/.exec(lower);
  if (m && steamNames.has(m[1] + m[2])) return true;
  const core = lower.replace(/\.[^.]+$/, '').replace(/^\d+_/, '');
  if (core && steamCores.has(core)) return true;
  const ccore = String(containerName || '').toLowerCase().replace(/\.[^.]+$/, '').replace(/^\d+_/, '');
  return Boolean(ccore && steamCores.has(ccore));
}

const games = scanInstalledGames().games;
const UNRESOLVED = '未检测到（可手动指定）';

// ---------- 1) 预测层：全库 绿/黄/红 清单 ----------
console.log('\n========== 可移植性预测（只读，不写盘） ==========');
const isReal = (p) => typeof p === 'string' && p.length > 0 && p !== UNRESOLVED && fs.existsSync(p);
for (const g of games) {
  if (!(isReal(g.steamSavePath) || isReal(g.xboxWgsPath))) {
    console.log(`  ·   ${g.id.padEnd(28)} 双端均未检测到，跳过`);
    continue;
  }
  const s2x = predictSteamToXbox(g, g.steamSavePath, g.xboxWgsPath);
  const x2s = predictXboxToSteam(g, g.steamSavePath, g.xboxWgsPath);
  const grade = (r) => {
    if (r.verdict === 'ok') return '绿';
    if (r.verdict === 'partial' || r.verdict === 'needs-launch' || r.verdict === 'empty' || r.verdict === 'no-source') return '黄';
    return '红'; // refused / error / unknown
  };
  const g1 = grade(s2x);
  const g2 = grade(x2s);
  if (s2x.verdict === 'error' || x2s.verdict === 'error') {
    fail(`预测器异常 ${g.id}`, `${s2x.reasons[0] || ''} ${x2s.reasons[0] || ''}`);
  }
  const detail = [
    s2x.verdict !== 'ok' ? `Steam→Xbox[${s2x.verdict}] ${s2x.reasons[0] || ''}` : `Steam→Xbox 写入${s2x.willWrite.length}槽`,
    x2s.verdict !== 'ok' ? `Xbox→Steam[${x2s.verdict}] ${x2s.reasons[0] || ''}` : `Xbox→Steam 提取${x2s.files.length}文件${x2s.mirrors.length ? `+同步${x2s.mirrors.length}镜像` : ''}`,
  ].join('；');
  console.log(`  ${g1 === '绿' && g2 === '绿' ? '绿' : g1 === '红' || g2 === '红' ? '红' : '黄'}  ${g.id.padEnd(28)} Steam→Xbox[${g1}] ${g.name.split('(')[0].trim().slice(0, 24).padEnd(24)} ${detail.slice(0, 120)}`);
}

if (reportOnly) {
  console.log(failures === 0 ? '\nALL PASS (report-only)' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

// ---------- 2) 沙箱层：每个真实 WGS 结构实写回归 ----------
console.log('\n========== 沙箱实写回归（只读复制→temp，结构断言） ==========');
const seenWgs = new Set();
const tmpRoot = path.join(os.tmpdir(), 'portability-sandbox-' + Date.now());

for (const g of games) {
  const wgsRoot = isReal(g.xboxWgsPath) ? g.xboxWgsPath : null;
  if (!wgsRoot) continue;
  if (!hasExistingWgsStructure(wgsRoot)) {
    console.log(`  SKIP  ${g.id}：目标无有效 WGS 结构，跳过沙箱`);
    continue;
  }
  if (seenWgs.has(wgsRoot)) continue; // 同一 WGS 可能被多个游戏引用
  seenWgs.add(wgsRoot);

  console.log(`\n=== 沙箱: ${g.name} (${path.basename(wgsRoot)}) ===`);
  let work;
  try {
    work = path.join(tmpRoot, g.id || 'wgs');
    copyDir(wgsRoot, work);
  } catch (e) {
    fail(`复制真实 WGS 到沙箱失败 ${g.id}`, e.message);
    continue;
  }

  // 来源文件：优先用真实 Steam 侧目录里的文件名；否则按容器结构派生
  const realSteamFiles = isReal(g.steamSavePath)
    ? fs.readdirSync(g.steamSavePath).filter(f => {
        try { return fs.statSync(path.join(g.steamSavePath, f)).isFile(); } catch { return false; }
      })
    : null;
  const before = snapshot(work);
  const structuralNames = before.containers.flatMap(c => c.files.map(f => f.logical));
  const synthNames = realSteamFiles ? [] : [...new Set(structuralNames)];
  const steamNames = realSteamFiles ? [...realSteamFiles] : synthNames;
  console.log(`  来源文件(${steamNames.length}): ${steamNames.slice(0, 6).join(', ')}${steamNames.length > 6 ? '…' : ''}${realSteamFiles ? '' : '（派生）'}`);

  // 在沙箱目录旁造来源文件（派生时用可辨识的字节）
  const srcDir = path.join(tmpRoot, (g.id || 'wgs') + '-src');
  fs.mkdirSync(srcDir, { recursive: true });
  const inputFiles = [];
  const srcMd5 = {};
  let fill = 0x40;
  for (const name of steamNames) {
    let p;
    if (realSteamFiles) {
      p = path.join(g.steamSavePath, name);
      if (!fs.existsSync(p)) continue;
    } else {
      p = path.join(srcDir, name);
      const bytes = Buffer.alloc(Math.max(64, name.length * 3), fill++);
      fs.writeFileSync(p, bytes);
    }
    srcMd5[name] = crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
    inputFiles.push({ fileName: name, filePath: p });
  }

  let r;
  try {
    r = updateWgsInPlace(inputFiles, work);
  } catch (e) {
    fail(`沙箱实写抛异常 ${g.id}`, e.message);
    continue;
  }
  const after = snapshot(work);

  // --- 结构逐字节不变（游戏读取的层面） ---
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  eq(before.containers.map(x => x.name), after.containers.map(x => x.name))
    ? ok('容器名集合未变') : fail('容器名集合被改动');
  eq(before.containers.map(x => x.guid), after.containers.map(x => x.guid))
    ? ok('容器 GUID 未变') : fail('容器 GUID 被改动');
  eq(before.containers.map(x => [x.seq, x.size]), after.containers.map(x => [x.seq, x.size]))
    ? ok('seq / size 字段未被改写') : fail('seq / size 字段被改写');
  eq(before.indexBytes, after.indexBytes)
    ? ok('containers.index 长度未变') : fail('containers.index 长度被改动');
  eq(
    before.containers.map(x => x.files.map(f => [f.logical, f.blobGuid])),
    after.containers.map(x => x.files.map(f => [f.logical, f.blobGuid])),
  )
    ? ok('blob GUID 与逻辑文件名未变') : fail('blob GUID / 逻辑名被改动');

  // --- 名字可派生的容器均应更新，且字节 == 来源 ---
  const steamLower = new Set(steamNames.map(s => s.toLowerCase()));
  const cores = new Set(steamNames.map(steamCore));
  const updatedSet = new Set(r.updated.map(u => u.container));
  const expected = before.containers
    .filter(x => x.files.some(f => resolvesToSteam(f.logical, x.name, steamLower, cores)))
    .map(x => x.name);
  const updatedOk = expected.every(n => updatedSet.has(n)) &&
    [...updatedSet].every(n => expected.includes(n));
  updatedOk
    ? ok(`所有名字可派生容器均已更新 ${JSON.stringify(expected)}`)
    : fail(`可派生容器更新不一致 期望=${JSON.stringify(expected)} 实际=${JSON.stringify([...updatedSet])}`);
  let blobOk = true;
  for (const u of r.updated) {
    const onDisk = crypto.createHash('md5').update(fs.readFileSync(u.blobPath)).digest('hex');
    if (onDisk !== srcMd5[u.sourceFileName]) {
      fail(`blob 字节 != 来源 ${u.container}/${u.logicalFileName}`);
      blobOk = false;
    }
  }
  if (blobOk) ok('所有目标 blob 字节 == 来源');

  // --- 无来源槽位不动 ---
  let untouched = true;
  for (const b of before.containers) {
    for (const f of b.files) {
      if (resolvesToSteam(f.logical, b.name, steamLower, cores)) continue;
      const a = after.containers.find(x => x.name === b.name)?.files.find(g => g.logical === f.logical);
      if (!a || a.md5 !== f.md5) {
        fail(`无来源槽位被动了 ${b.name}/${f.logical}`);
        untouched = false;
      }
    }
  }
  if (untouched) ok('无来源槽位全部未动');

  console.log(`  info  已更新 ${r.updated.length} / 跳过 ${r.skippedContainers.length} / unused ${JSON.stringify(r.unusedSteamFiles)} / history ${JSON.stringify(r.historyBackups)}`);
}

fs.rmSync(tmpRoot, { recursive: true, force: true });
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
