import { execSync, execFileSync } from 'child_process';

/**
 * Process Checker — detect whether a game is currently running before migration.
 * Implements the P-01 defense from agent.md: file-lock / access-denied prevention.
 */

/**
 * Check whether any of the given process names are running on Windows.
 * @param {string[]} processNames e.g. ['Brotato', 'Palworld-Win64-Shipping']
 * @returns {{ running: boolean, matchedNames: string[] }}
 */
export function checkGameRunning(processNames) {
  if (!processNames || processNames.length === 0) {
    return { running: false, matchedNames: [] };
  }

  if (process.platform !== 'win32') {
    return { running: false, matchedNames: [] };
  }

  let taskList = '';
  try {
    // tasklist output: "Image Name  PID Session Name  Mem Usage"
    taskList = execSync('tasklist /FO CSV /NH', { encoding: 'utf8', timeout: 8000 });
  } catch {
    // tasklist failed — block migration rather than blindly allowing (fail-close).
    // If we can't confirm the game is NOT running, it's safer to refuse.
    return { running: true, matchedNames: ['unknown（进程检测失败，为安全起见已阻止迁移）'] };
  }

  const lowerTaskList = taskList.toLowerCase();
  const matched = [];

  for (const name of processNames) {
    // Match against the image name without extension, case-insensitive.
    // tasklist CSV rows look like: "Brotato.exe","1234","Console","1","12,345 K"
    const needle = name.toLowerCase().replace(/\.exe$/, '');
    if (lowerTaskList.includes(`"${needle}.exe"`)) {
      matched.push(name);
    }
  }

  return { running: matched.length > 0, matchedNames: matched };
}

/**
 * Check whether the PLATFORM clients that own cloud sync are running.
 * A client open during migration holds stale cloud state in memory and can
 * push the old save back over the freshly migrated files — the #1 cause of
 * "移植成功但被云存档覆盖".
 * @param {'steam'|'xbox'} side The side being WRITTEN to.
 * @returns {{ running: boolean, matchedNames: string[] }}
 */
// XboxPcAppFT.exe is a persistent background helper of the Xbox app suite: it
// keeps running (and self-restarts) even after the app is fully exited, so it
// cannot be the cloud-sync owner. Counting it as a blocker caused the field
// bug "已尝试自动关闭 Xbox 应用但仍有进程未退出（xboxpcapp）" that no amount of
// manual closing could clear.
const NON_BLOCKERS = new Set(['xboxpcappft.exe']);

/** Parse tasklist CSV rows into { image, lower, pid } entries. */
function tasklistImages(taskList) {
  const out = [];
  for (const m of taskList.matchAll(/"([^"]+\.exe)","(\d+)"/g)) {
    out.push({ image: m[1], lower: m[1].toLowerCase(), pid: m[2] });
  }
  return out;
}

export function checkPlatformClient(side) {
  if (process.platform !== 'win32') {
    return { running: false, matchedNames: [] };
  }
  // Only guard the client that OWNS the target's cloud sync:
  //   writing Steam userdata → steam.exe matters;
  //   writing Xbox WGS → the Xbox PC app main process matters.
  // Steam must match EXACTLY ("steam.exe") so our own Steam-Xbox-Save-Migrator
  //.exe never self-matches; Xbox uses a prefix match to catch XboxPcApp.exe,
  // XboxApp.exe variants (XboxPcAppFT.exe excluded — see NON_BLOCKERS).
  const isSteam = side === 'steam';
  const prefixes = isSteam ? null : ['xboxpcapp', 'xboxapp', 'xbox-app'];

  let taskList = '';
  try {
    taskList = execSync('tasklist /FO CSV /NH', { encoding: 'utf8', timeout: 8000 });
  } catch {
    return { running: true, matchedNames: ['unknown（进程检测失败，为安全起见按运行中处理）'] };
  }

  const matched = [];
  for (const proc of tasklistImages(taskList)) {
    if (NON_BLOCKERS.has(proc.lower)) continue;
    if (isSteam) {
      if (proc.lower === 'steam.exe') matched.push(proc.image.replace(/\.exe$/i, ''));
    } else if (prefixes.some(p => proc.lower.startsWith(p))) {
      matched.push(proc.image.replace(/\.exe$/i, ''));
    }
  }
  return { running: matched.length > 0, matchedNames: matched };
}

/**
 * Force-close the Xbox PC app suite so its stale cloud state can't push back
 * over freshly migrated saves. Kills by PID (precise, immune to image-name
 * quirks) and re-snapshots the process table each round, because a single
 * taskkill round can miss processes that are slow to tear down or get
 * respawned by a helper while the app is shutting down.
 * @returns {{ attempted: boolean, killed: string[], stillRunning: string[], hint: string }}
 */
export function closePlatformClient(side) {
  if (process.platform !== 'win32') {
    return { attempted: false, killed: [], stillRunning: [], hint: '' };
  }
  if (side !== 'xbox') {
    // Steam is NOT auto-killed — users may be mid-download; it stays a manual step.
    return { attempted: false, killed: [], stillRunning: [], hint: '' };
  }

  const killedPids = new Set();
  const killedImages = new Set();
  let lastError = '';

  for (let round = 0; round < 3; round++) {
    let taskList = '';
    try {
      taskList = execSync('tasklist /FO CSV /NH', { encoding: 'utf8', timeout: 8000 });
    } catch {
      lastError = '进程列表读取失败';
      break;
    }

    // Same blocker rules as checkPlatformClient — never touch non-blockers
    // (XboxPcAppFT.exe respawns; killing it wastes rounds and changes nothing).
    const targets = [];
    for (const proc of tasklistImages(taskList)) {
      if (killedPids.has(proc.pid)) continue;
      if (NON_BLOCKERS.has(proc.lower)) continue;
      const isXboxFamily = ['xboxpcapp', 'xboxapp', 'xbox-app'].some(p => proc.lower.startsWith(p));
      if (isXboxFamily) targets.push({ image: proc.image, pid: proc.pid });
    }
    if (targets.length === 0) break; // nothing left to kill

    for (const t of targets) {
      try {
        execFileSync('taskkill', ['/F', '/T', '/PID', t.pid], { encoding: 'utf8', timeout: 8000, windowsHide: true, stdio: 'pipe' });
        killedPids.add(t.pid);
        killedImages.add(t.image.replace(/\.exe$/i, ''));
      } catch (e) {
        const detail = String((e && (e.stderr || e.stdout || e.message)) || '').trim().split(/\r?\n/)[0];
        if (detail) lastError = detail;
      }
    }

    // Let the OS release handles before the next snapshot/re-check.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
  }

  const after = checkPlatformClient('xbox');
  const hint = after.matchedNames.length > 0 && /拒绝访问|access is denied|denied/i.test(lastError)
    ? `关闭进程被系统拒绝（${lastError}），请以管理员身份运行本工具，或手动退出 Xbox 应用`
    : (after.matchedNames.length > 0 && !killedImages.size ? '未找到可结束的进程句柄' : '');
  return {
    attempted: killedPids.size > 0,
    killed: [...killedImages],
    stillRunning: after.matchedNames,
    hint,
  };
}
