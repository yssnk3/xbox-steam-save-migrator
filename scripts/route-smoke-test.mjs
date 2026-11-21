/**
 * Route smoke test — regression net for the P0 fixes.
 *
 * Boots the real Express app on a loopback-only test port with an isolated
 * data dir, then checks that (a) /api/scan-folder works under ESM, (b) scan
 * rows carry the real match fields, and (c) a refused migration never writes
 * to the target folder. No real save directory is touched.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const PORT = 43211;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sxsm-route-smoke-'));
process.env.SXSM_PORT = String(PORT);
process.env.SXSM_DATA_DIR = path.join(tmp, 'data');

let failures = 0;
const ok = (label) => console.log(`  PASS  ${label}`);
const skip = (label, why) => console.log(`  SKIP  ${label} — ${why}`);
const fail = (label, detail = '') => {
  console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`);
  failures++;
};
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const scanRoot = path.join(tmp, 'ScanRoot');
const palworldFolder = path.join(scanRoot, 'PalworldSave');
const steamTarget = path.join(tmp, 'SteamTarget');
const xboxSource = path.join(tmp, 'XboxSource');
for (const d of [palworldFolder, steamTarget, xboxSource]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(palworldFolder, 'level.sav'), Buffer.from('GVAS' + '\0'.repeat(64)));
const targetFile = path.join(steamTarget, 'existing.sav');
fs.writeFileSync(targetFile, Buffer.from('original-steam-save'));
const targetBefore = md5(targetFile);
const targetNamesBefore = fs.readdirSync(steamTarget).sort().join(',');

console.log('\n========== Route smoke (loopback :' + PORT + ') ==========');
await import('../server/index.js');

let ready = false;
for (let i = 0; i < 50; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/env`);
    if (r.ok) { ready = true; break; }
  } catch {}
  await wait(100);
}
if (!ready) {
  fail('backend listens on loopback');
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
}
ok('backend listens on 127.0.0.1');

// Cloud-sync shutdown now returns immediately and exposes real stage progress.
try {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/xbox/stop-cloud-sync/status`);
  const body = await r.json();
  r.ok && body.success && typeof body.done === 'boolean' && typeof body.stage === 'string'
    ? ok('stop-cloud-sync progress endpoint responds')
    : fail('stop-cloud-sync status', JSON.stringify(body).slice(0, 160));
} catch (e) {
  fail('stop-cloud-sync status threw', e.message);
}

// 1) The dead-ESM bug: this route used to call require() and always 500'd.
let scan;
try {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/scan-folder`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ folderPath: scanRoot }),
  });
  scan = await r.json();
  r.status === 200 && scan.success && Array.isArray(scan.games)
    ? ok('/api/scan-folder returns 200 + games[]')
    : fail('/api/scan-folder', `status=${r.status} body=${JSON.stringify(scan).slice(0, 200)}`);
} catch (e) {
  fail('/api/scan-folder threw', e.message);
}

// 2) Match fields must come from matches[0].id / .name, not flat properties.
if (scan && Array.isArray(scan.games) && scan.games.length > 0) {
  const row = scan.games[0];
  row.matchedGameId === 'palworld' && row.matchedGameName
    ? ok(`scan row matched ${row.matchedGameId} / ${row.matchedGameName}`)
    : fail('scan row match fields', JSON.stringify(row).slice(0, 200));
} else {
  skip('scan row match fields', 'no subfolder with save files was scanned');
}

// 3) Hard gate must fire BEFORE createBackup / extractWgsToFolder.
try {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/identify-and-migrate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sourcePath: palworldFolder,
      direction: 'xbox_to_steam',
      customSteamPath: steamTarget,
      customXboxPath: palworldFolder,
    }),
  });
  const body = await r.json().catch(() => ({}));
  const targetAfter = fs.existsSync(targetFile) ? md5(targetFile) : null;
  const namesAfter = fs.readdirSync(steamTarget).sort().join(',');
  targetAfter === targetBefore && namesAfter === targetNamesBefore
    ? ok('refused migration left target folder byte-identical')
    : fail('refused migration modified target', `before=${targetBefore}/${targetNamesBefore} after=${targetAfter}/${namesAfter}`);
  if (r.status === 400 && body.code === 'CONVERSION_REQUIRED') {
    ok('conversion-required gate returns 400 CONVERSION_REQUIRED');
  } else if (r.status === 409 && body.code === 'PLATFORM_RUNNING') {
    skip('gate code assertion', 'Steam client is running on this machine; preflight legitimately blocked first');
  } else {
    fail('gate code', `status=${r.status} code=${body.code} error=${body.error}`);
  }
} catch (e) {
  fail('gate request threw', e.message);
}

// 4) The server must not be reachable from a non-loopback interface.
const nets = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal);
if (nets.length === 0) {
  skip('no LAN bind', 'no non-loopback IPv4 interface');
} else {
  let reachable = false;
  try {
    const r = await fetch(`http://${nets[0].address}:${PORT}/api/env`, { signal: AbortSignal.timeout(1200) });
    reachable = r.ok;
  } catch {}
  reachable ? fail('LAN bind blocked', `${nets[0].address}:${PORT} answered`) : ok('LAN bind blocked');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
