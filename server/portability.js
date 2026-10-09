/**
 * Read-only portability prediction. Answers, before anything is written:
 *   - what a Steam → Xbox migration will land in (which slots, which files
 *     will NOT transfer, why),
 *   - what an Xbox → Steam extraction will produce (names, sizes, cloud
 *     mirrors that get synced).
 *
 * Both directions reuse the SAME matching the real writer uses (previewWgs
 * Update = dryRun of updateWgsInPlace), so a green prediction and the real
 * migration can never disagree. What prediction CANNOT tell you is whether
 * the game accepts foreign bytes — that needs one in-game load, and the
 * report says so.
 */
import fs from 'fs';
import path from 'path';
import {
  parseContainersIndexDetailed,
  parseContainerFolderFiles,
  hasExistingWgsStructure,
  previewWgsUpdate,
} from './wgsEngine.js';
import { getSteamEnvironment } from './steamLocator.js';

const JUNK_SOURCE_RE = /\.(bak\d*|tmp|old)$|^(steam_autocloud|remotecache|sharedconfig)\.vdf$/i;
const UNSUPPORTED_SENTINEL = '未检测到（可手动指定）';

function isRealPath(p) {
  return typeof p === 'string' && p.length > 0 && p !== UNSUPPORTED_SENTINEL;
}

function listSteamFiles(dir) {
  try {
    return fs.readdirSync(dir)
      .map(f => path.join(dir, f))
      .filter(f => fs.statSync(f).isFile())
      .map(f => ({ fileName: path.basename(f), filePath: f }));
  } catch {
    return [];
  }
}

/**
 * Xbox → Steam extraction preview. The extraction itself is deterministic
 * (logical names straight out of the manifests), so listing is enough.
 */
export function predictXboxToSteam(game, steamPath, xboxPath) {
  const report = {
    direction: 'xbox_to_steam',
    gameId: game?.id || null,
    verdict: 'unknown',
    reasons: [],
    files: [],
    mirrors: [],
  };
  if (!isRealPath(xboxPath)) {
    report.verdict = 'no-source';
    report.reasons.push('未找到 Xbox 端存档目录（可手动指定）');
    return report;
  }
  try {
    const idx = parseContainersIndexDetailed(path.join(xboxPath, 'containers.index'));
    const seen = new Map();
    for (const c of idx.containers) {
      const dir = path.join(xboxPath, c.guidHex);
      for (const m of parseContainerFolderFiles(dir)) {
        if (!m.blobPath || !fs.existsSync(m.blobPath)) continue;
        const size = fs.statSync(m.blobPath).size;
        // Extraction dedupes colliding logical names by container prefix;
        // mirror that here so the preview matches the real file set.
        const key = m.logicalFileName.toLowerCase();
        const name = seen.has(key)
          ? `${c.containerName}_${m.logicalFileName}`
          : m.logicalFileName;
        seen.set(key, true);
        report.files.push({
          name,
          original: m.logicalFileName,
          container: c.containerName,
          size,
          exists: true,
          sizeOk: size > 0,
        });
      }
    }
    if (report.files.length === 0) {
      report.verdict = 'empty';
      report.reasons.push('WGS 结构里没有任何可读的存档 blob');
      return report;
    }
    // Cloud mirrors: same-named existing files under userdata\<uid>\<appid>\remote
    // will receive the same bytes after the real migration (rollback defense).
    if (game?.steamAppId && isRealPath(steamPath)) {
      report.mirrors = listSteamCloudMirrors(
        report.files.map(f => ({ name: f.name, path: steamPath ? path.join(steamPath, f.name) : null })),
        steamPath,
        game.steamAppId,
      ).map(m => m.name);
    }
    report.verdict = 'ok';
    report.reasons.push('存档可整包提取到 Steam 目录；启动游戏如遇云冲突选「使用本地存档」。');
    return report;
  } catch (err) {
    report.verdict = 'error';
    report.reasons.push('解析 WGS 结构失败：' + err.message);
    return report;
  }
}

/**
 * Steam → Xbox write preview. Verdicts:
 *   ok          ≥1 slot will be written (still confirm in-game once)
 *   partial     structure fine but ZERO source files resolve to a slot
 *   refused     hard gate (conversion tool / byte-incompatible)
 *   needs-launch target has no game-generated WGS structure yet
 */
export function predictSteamToXbox(game, steamPath, xboxPath) {
  const report = {
    direction: 'steam_to_xbox',
    gameId: game?.id || null,
    verdict: 'unknown',
    reasons: [],
    willWrite: [],
    unusedSteamFiles: [],
    skippedContainers: [],
    historyBackups: [],
    targetContainers: null,
  };

  if (!isRealPath(steamPath)) {
    report.verdict = 'no-source';
    report.reasons.push('未找到 Steam 端存档目录（可手动指定）');
    return report;
  }
  if (game?.needsConversionTool) {
    report.verdict = 'refused';
    report.reasons.push(`需先用 ${game.needsConversionTool} 等外部工具转换格式（Xbox 端字节布局不同），工具不猜字节`);
    return report;
  }
  if (game?.steamXboxByteIncompatible) {
    report.verdict = 'refused';
    report.reasons.push('经实测两端存档字节不兼容（写入会导致游戏黑屏），已禁用该方向');
    return report;
  }
  if (!isRealPath(xboxPath) || !hasExistingWgsStructure(xboxPath)) {
    report.verdict = 'needs-launch';
    report.reasons.push('Xbox 端还没有游戏自己生成的存档结构：请先在 Xbox 端启动一次游戏并存档，再回来移植');
    return report;
  }

  const files = listSteamFiles(steamPath).filter(f => !JUNK_SOURCE_RE.test(f.fileName));
  if (files.length === 0) {
    report.verdict = 'empty';
    report.reasons.push('Steam 存档目录为空或只含垃圾文件');
    return report;
  }

  let r;
  try {
    r = previewWgsUpdate(files, xboxPath);
  } catch (err) {
    report.verdict = 'error';
    report.reasons.push('干跑失败：' + err.message);
    return report;
  }

  report.targetContainers = r.containersCount;
  report.willWrite = r.updated.map(u => ({
    slot: `${u.container} / ${u.logicalFileName}`,
    source: u.sourceFileName,
    size: u.size,
  }));
  report.unusedSteamFiles = r.unusedSteamFiles;
  report.skippedContainers = r.skippedContainers.map(s => ({ container: s.container, reason: s.reason }));
  report.historyBackups = r.historyBackups;

  if (report.willWrite.length === 0) {
    report.verdict = 'partial';
    report.reasons.push(`Steam 端 ${files.length} 个文件没有任何一个能对应到 Xbox 容器槽位（命名推不出对应关系），直接写入 0 字节`);
  } else {
    report.verdict = 'ok';
    report.reasons.push(`将写入 ${report.willWrite.length} 个槽位（${report.willWrite.map(w => w.source).filter((v, i, a) => a.indexOf(v) === i).join('、')}）；是否被游戏读取仍需进游戏确认一次`);
    if (report.unusedSteamFiles.length > 0) {
      report.reasons.push(`${report.unusedSteamFiles.length} 个文件无对应槽位不会写入：${report.unusedSteamFiles.join('、')}`);
    }
  }
  return report;
}

/**
 * Read-only listing of Steam cloud-mirror files that a migration into
 * `steamPath` would keep in sync: existing same-named files under
 * userdata\<uid>\<appid>\remote\ across every detected Steam install.
 */
export function listSteamCloudMirrors(landedFiles, steamPath, steamAppId) {
  const mirrors = [];
  if (!steamAppId || !Array.isArray(landedFiles) || landedFiles.length === 0) return mirrors;
  try {
    const env = getSteamEnvironment();
    const roots = (env.userdataDirs && env.userdataDirs.length) ? env.userdataDirs : [];
    const byLowerName = new Map();
    for (const f of landedFiles) {
      if (f && f.name && f.path) byLowerName.set(String(f.name).toLowerCase(), f);
    }
    if (!roots.length || byLowerName.size === 0) return mirrors;
    const primary = path.resolve(String(steamPath)).toLowerCase();
    for (const root of roots) {
      let uids = [];
      try { uids = fs.readdirSync(root); } catch { continue; }
      for (const uid of uids) {
        const remoteDir = path.join(root, String(uid), String(steamAppId), 'remote');
        let entries = [];
        try { entries = fs.readdirSync(remoteDir); } catch { continue; }
        const remoteNorm = path.resolve(remoteDir).toLowerCase();
        if (primary === remoteNorm || primary.startsWith(remoteNorm + path.sep)) continue;
        for (const e of entries) {
          const hit = byLowerName.get(e.toLowerCase());
          if (!hit) continue;
          try {
            const target = path.join(remoteDir, e);
            if (!fs.statSync(target).isFile()) continue;
            mirrors.push({ name: e, path: target, size: fs.statSync(target).size });
          } catch {}
        }
      }
    }
  } catch {}
  return mirrors;
}
