/**
 * REAL cloud-overwrite validation (not a copy/paste of warning strings).
 *
 * Focus: can a migrated save be reverted by stale cloud/mirror bytes, and do
 * the guards actually stop a cloud-owning client from writing during migration?
 *
 * All fixtures are synthetic and isolated via SXSM_DATA_DIR. The real code
 * paths exercised: /api/copy-save, extractWgsToFolder, syncSteamCloudMirrors,
 * listSteamCloudMirrors, preflightWrite/checkPlatformClient, updateWgsInPlace.
 *
 * NOT covered here (no local observable state): whether Xbox's cloud service
 * itself accepted an upload. That needs a second-device check and is reported
 * as NOT RUN rather than claimed as verified.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawn, execFileSync } from 'child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sxsm-cloud-overwrite-'));
process.env.SXSM_DATA_DIR = path.join(tmp, 'data');
process.env.SXSM_PORT = '43277';

const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (label) => console.log(`  PASS  ${label}`);
const fail = (label, detail = '') => { console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failures++; };
const skip = (label, why) => console.log(`  SKIP  ${label} — ${why}`);

const { writeSettings } = await import('../server/settingsStore.js');
const { packFolderToWgs, updateWgsInPlace, parseContainersIndexDetailed } = await import('../server/wgsEngine.js');
const { checkPlatformClient } = await import('../server/processCheck.js');

const APPID = '999991';
const steamRoot = path.join(tmp, 'Steam');
const primary = path.join(steamRoot, 'userdata', '100', APPID, 'remote');
const mirrorA = path.join(steamRoot, 'userdata', '111', APPID, 'remote');
const mirrorB = path.join(steamRoot, 'userdata', '222', APPID, 'remote');
for (const d of [primary, mirrorA, mirrorB]) fs.mkdirSync(d, { recursive: true });
writeSettings({ paths: { steamRoot } });

const NEW = Buffer.from('MIGRATED-SAVE-BYTES-NEW');
const OLD = Buffer.from('STALE-CLOUD-SAVE-BYTES-OLD');
const NAME = 'slot1.sav';
for (const d of [primary, mirrorA, mirrorB]) fs.writeFileSync(path.join(d, NAME), OLD);

// Real WGS fixture with the migrated bytes as its blob.
const srcDir = path.join(tmp, 'src');
fs.mkdirSync(srcDir, { recursive: true });
fs.writeFileSync(path.join(srcDir, NAME), NEW);
const wgs = path.join(tmp, 'wgs');
packFolderToWgs([{ fileName: NAME, filePath: path.join(srcDir, NAME) }], wgs, 'Test.Package_abc');

console.log('\n========== Real cloud-overwrite validation ==========');
await import('../server/index.js'); // starts the real Express app on 43277
const API = 'http://127.0.0.1:43277';
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(`${API}/api/env`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 100));
}

async function copyXboxToSteam() {
  const r = await fetch(`${API}/api/copy-save`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sourcePath: wgs, sourceSide: 'xbox',
      targetPath: primary, targetSide: 'steam', targetSteamAppId: APPID,
    }),
  });
  return { status: r.status, body: await r.json() };
}

// ---- S1: migrated bytes must reach EVERY cloud mirror, not just the primary ----
if (checkPlatformClient('steam').running) {
  skip('S1 mirror sync', 'Steam client is running on this machine; preflight legitimately blocks the copy test');
} else {
  const r = await copyXboxToSteam();
  r.status === 200 && r.body.success
    ? ok('S1a Xbox→Steam migration executed through the real API')
    : fail('S1a migration failed', `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  const primaryOk = fs.readFileSync(path.join(primary, NAME)).equals(NEW);
  primaryOk ? ok('S1b primary save has migrated bytes') : fail('S1b primary still stale');
  const mirrorsOk = [mirrorA, mirrorB].every((d) => fs.readFileSync(path.join(d, NAME)).equals(NEW));
  mirrorsOk
    ? ok('S1c all same-named Steam cloud mirrors received migrated bytes')
    : fail('S1c a mirror kept stale bytes — cloud would revert the migration');
  const warns = r.body.warnings || [];
  warns.some((w) => w.includes('云镜像'))
    ? ok('S1d mirror sync is disclosed in the response warnings')
    : fail('S1d no mirror warning');
  const md5Ok = (r.body.verify?.files || []).every((f) => f.md5Match === true);
  md5Ok && r.body.verify?.hashUnchecked === false
    ? ok('S1e landed files were MD5-verified against the blob')
    : fail('S1e verification was unchecked', JSON.stringify(r.body.verify?.files).slice(0, 160));

  // ---- S3: simulate a cloud rollback, then re-migrate and check recovery ----
  for (const d of [primary, mirrorA, mirrorB]) fs.writeFileSync(path.join(d, NAME), OLD);
  const again = await copyXboxToSteam();
  const recovered = [primary, mirrorA, mirrorB].every((d) => fs.readFileSync(path.join(d, NAME)).equals(NEW));
  again.status === 200 && recovered
    ? ok('S3 cloud-rollback simulation recovered on re-migration (primary + mirrors)')
    : fail('S3 recovery failed', `${again.status} ${JSON.stringify(again.body).slice(0, 120)}`);
}

// ---- S2: an alive cloud-owning client is handled before any write.
// Steam side: hard block (no auto-close). Xbox side: close it first, then write.
async function spawnFakeProcess(name, tag) {
  const exe = path.join(tmp, name);
  fs.copyFileSync(process.execPath, exe);
  const hold = path.join(tmp, `hold-${tag}.cjs`);
  fs.writeFileSync(hold, 'setTimeout(()=>{},20000);');
  const proc = spawn(exe, [hold], { stdio: 'ignore', detached: true });
  proc.unref();
  await sleep(900);
  return proc;
}
function killFake(proc) {
  if (proc && proc.pid) {
    try { execFileSync('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { stdio: 'ignore' }); } catch {}
  }
}

let fakeSteam = null;
try {
  fakeSteam = await spawnFakeProcess('steam.exe', 'steam');
  checkPlatformClient('steam').running
    ? ok('S2a simulated Steam client detected by the real process checker')
    : fail('S2a process checker did not see the simulated client');
  const beforePrimary = fs.readFileSync(path.join(primary, NAME)).toString('hex');
  const r = await fetch(`${API}/api/copy-save`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sourcePath: wgs, sourceSide: 'xbox',
      targetPath: primary, targetSide: 'steam', targetSteamAppId: APPID,
    }),
  });
  const body = await r.json();
  r.status === 409 && body.code === 'PLATFORM_RUNNING'
    ? ok('S2b Steam-side write refused while client is alive (409 PLATFORM_RUNNING)')
    : fail('S2b guard did not block', `${r.status} ${JSON.stringify(body).slice(0, 160)}`);
  fs.readFileSync(path.join(primary, NAME)).toString('hex') === beforePrimary
    ? ok('S2c refused Steam-side write left the save byte-identical')
    : fail('S2c refused write mutated the Steam save');
} catch (e) {
  fail('S2 Steam scenario threw', e.message);
} finally {
  killFake(fakeSteam);
}

let fakeXbox = null;
try {
  fakeXbox = await spawnFakeProcess('xboxpcapp.exe', 'xbox');
  checkPlatformClient('xbox').running
    ? ok('S2d simulated Xbox client detected')
    : fail('S2d Xbox client not detected');
  const r = await fetch(`${API}/api/copy-save`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sourcePath: srcDir, sourceSide: 'steam',
      targetPath: wgs, targetSide: 'xbox',
    }),
  });
  const body = await r.json();
  r.status === 200 && body.success
    ? ok('S2e Xbox-side write proceeded only after auto-closing the client')
    : fail('S2e Xbox-side write failed', `${r.status} ${JSON.stringify(body).slice(0, 160)}`);
  checkPlatformClient('xbox').running === false
    ? ok('S2f cloud-owning Xbox client is gone after the guarded write')
    : fail('S2f client still running during/after write');
} catch (e) {
  fail('S2 Xbox scenario threw', e.message);
} finally {
  killFake(fakeXbox);
}

// ---- S4: FILETIME/mtime freshness is the "local newer than cloud" signal ----
const fixture = path.join(tmp, 'freshness');
fs.mkdirSync(fixture, { recursive: true });
packFolderToWgs([{ fileName: NAME, filePath: path.join(srcDir, NAME) }], fixture, 'Test.Package_abc');
const idxPath = path.join(fixture, 'containers.index');
const beforeIdx = parseContainersIndexDetailed(idxPath);
const beforeTime = BigInt(beforeIdx.containers[0].filetime);
const beforeIdxMtime = fs.statSync(idxPath).mtimeMs;
await new Promise((r) => setTimeout(r, 30));
fs.writeFileSync(path.join(srcDir, NAME), Buffer.concat([NEW, Buffer.from('-LONGER')]));
updateWgsInPlace([{ fileName: NAME, filePath: path.join(srcDir, NAME) }], fixture);
const afterIdx = parseContainersIndexDetailed(idxPath);
BigInt(afterIdx.containers[0].filetime) > beforeTime
  ? ok('S4 container FILETIME advanced so cloud sees this copy as newer')
  : fail('S4 FILETIME not refreshed');
const mtimeOk = fs.statSync(idxPath).mtimeMs > beforeIdxMtime;
mtimeOk ? ok('S4b containers.index mtime refreshed after write') : fail('S4b index mtime stale');

console.log('\nNOT RUN: actual Xbox cloud acceptance / second-device download — no local observable state.');
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures === 0 ? '\nALL RUNNABLE CHECKS PASS' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
