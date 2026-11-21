/**
 * Rollback regression for the two-phase WGS writer.
 *
 * Builds a synthetic v14 WGS folder, injects a failure into the commit phase,
 * and asserts the target is byte-identical to before the attempted migration —
 * including the containers.index — with no leftover stage/rollback files.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { packFolderToWgs, updateWgsInPlace, parseContainersIndexDetailed, parseContainerFolderFiles } from '../server/wgsEngine.js';

let failures = 0;
const ok = (label) => console.log(`  PASS  ${label}`);
const fail = (label, detail = '') => {
  console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`);
  failures++;
};
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sxsm-wgs-rollback-'));
const srcDir = path.join(tmp, 'src');
const wgs = path.join(tmp, 'wgs');
fs.mkdirSync(srcDir, { recursive: true });

// Two source saves -> two containers, so the commit phase performs several
// renames before touching the index.
fs.writeFileSync(path.join(srcDir, 'slot1.sav'), Buffer.alloc(64, 0x11));
fs.writeFileSync(path.join(srcDir, 'slot2.sav'), Buffer.alloc(96, 0x22));
const input = fs.readdirSync(srcDir).map((f) => ({ fileName: f, filePath: path.join(srcDir, f) }));
packFolderToWgs(input, wgs, 'Test.Package_abc');

function blobPaths() {
  const idx = parseContainersIndexDetailed(path.join(wgs, 'containers.index'));
  return idx.containers.flatMap((c) =>
    parseContainerFolderFiles(path.join(wgs, c.guidHex)).map((m) => m.blobPath).filter(Boolean));
}

const indexBefore = fs.readFileSync(path.join(wgs, 'containers.index')).toString('hex');
const blobBefore = new Map(blobPaths().map((p) => [p, md5(p)]));

// New source bytes differ, so a successful write would change every blob.
fs.writeFileSync(path.join(srcDir, 'slot1.sav'), Buffer.alloc(130, 0x99));
fs.writeFileSync(path.join(srcDir, 'slot2.sav'), Buffer.alloc(150, 0x88));

const realRename = fs.renameSync;
let renameCount = 0;
fs.renameSync = (...args) => {
  renameCount++;
  if (renameCount === 2) throw new Error('injected commit failure');
  return realRename(...args);
};

console.log('\n========== WGS commit-failure rollback ==========');
let threw = false;
try {
  updateWgsInPlace(input, wgs);
} catch (err) {
  threw = /injected commit failure|已回滚/.test(err.message);
  if (!threw) console.log(`  info  unexpected error: ${err.message}`);
} finally {
  fs.renameSync = realRename;
}
threw ? ok('injected failure surfaced as an error') : fail('injected failure was swallowed');

const indexAfter = fs.readFileSync(path.join(wgs, 'containers.index')).toString('hex');
indexAfter === indexBefore ? ok('containers.index restored byte-for-byte') : fail('containers.index changed after rollback');

const blobsRestored = [...blobBefore].every(([p, h]) => fs.existsSync(p) && md5(p) === h);
blobsRestored ? ok('all blobs restored to pre-migration bytes') : fail('blob bytes differ after rollback');

const leftovers = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(stage|rollback)\.\d+$/.test(e.name)) leftovers.push(p);
  }
};
walk(wgs);
leftovers.length === 0 ? ok('no stage/rollback temp files left behind') : fail('leftover temp files', leftovers.join(', '));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
