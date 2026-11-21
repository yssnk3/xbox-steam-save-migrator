/**
 * Backup restore regression: staged restore, byte verification and reversible
 * quarantine of files that were not part of the backup.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sxsm-backup-restore-'));
process.env.SXSM_DATA_DIR = path.join(tmp, 'data');

const { createBackup, restoreBackup, listBackups } = await import('../server/backupManager.js');

let failures = 0;
const ok = (label) => console.log(`  PASS  ${label}`);
const fail = (label, detail = '') => {
  console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`);
  failures++;
};

const src = path.join(tmp, 'source');
const target = path.join(tmp, 'target');
fs.mkdirSync(src, { recursive: true });
fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(src, 'save1.dat'), Buffer.from('ORIGINAL-SAVE-1'));
fs.writeFileSync(path.join(src, 'save2.dat'), Buffer.from('ORIGINAL-SAVE-2'));

console.log('\n========== Backup restore safety ==========');
const backup = await createBackup(src, 'restore-test', 'steam', { restoreTargetPath: target });
fs.existsSync(backup.backupPath)
  ? ok('backup zip created') : fail('backup zip missing');

// Simulate a post-backup session: one file changed, one extra file added.
fs.writeFileSync(path.join(target, 'save1.dat'), Buffer.from('NEWER-SAVE-1'));
fs.writeFileSync(path.join(target, 'new-session.dat'), Buffer.from('EXTRA'));
fs.writeFileSync(path.join(target, 'save2.dat'), Buffer.from('ORIGINAL-SAVE-2'));

const result = await restoreBackup(backup.backupPath, target);
fs.readFileSync(path.join(target, 'save1.dat'), 'utf8') === 'ORIGINAL-SAVE-1'
  ? ok('modified file restored to backup bytes') : fail('modified file not restored');
result.restored === 2 ? ok('restored file count = 2') : fail('restored count', String(result.restored));
result.quarantined === 1 && result.quarantineDir
  ? ok('extra file quarantined (not deleted)') : fail('extras not quarantined', JSON.stringify(result));

const quarantined = path.join(target, result.quarantineDir || '', 'new-session.dat');
fs.existsSync(quarantined) && fs.readFileSync(quarantined, 'utf8') === 'EXTRA'
  ? ok('quarantined file keeps its bytes') : fail('quarantine lost the extra file');

const stages = fs.readdirSync(path.dirname(target)).filter((n) => n.startsWith('.restore-stage-'));
stages.length === 0 ? ok('staging directory cleaned up') : fail('staging left behind', stages.join(','));

Array.isArray(listBackups()) && listBackups().some((b) => b.fileName === backup.backupFileName)
  ? ok('backup listed with sidecar') : fail('backup not listed');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
