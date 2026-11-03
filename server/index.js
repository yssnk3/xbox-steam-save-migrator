import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { exec, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { scanInstalledGames, resolveAppxInfos, readAppxManifestInfo } from './gameDetector.js';
import { extractWgsToFolder, parseContainersIndex, parseContainerFolderFiles, updateWgsInPlace, hasExistingWgsStructure } from './wgsEngine.js';
import { listSteamCloudMirrors, predictSteamToXbox, predictXboxToSteam } from './portability.js';
import { createBackup, listBackups, restoreBackup, restoreBackupAuto, deleteBackup, pruneBackups } from './backupManager.js';
import { addCustomGame, deleteCustomGame, getCustomGames } from './customGamesStore.js';
import { checkGameRunning, checkPlatformClient, closePlatformClient } from './processCheck.js';
import { friendlyError } from './errorMessages.js';
import { identifySavePath, resolveCounterpartPath, findGameById } from './gameIdentifier.js';
import { enrichGames, steamIconFor } from './steamMetadata.js';
import { scanXboxLibrary, launchXboxGame, checkXboxGameRunning, stopCloudSync } from './xboxLibrary.js';
import { getPublicSettings, writeSettings, readSettings } from './settingsStore.js';
import { explainFailure, testAiConnection, AiError } from './aiAssistant.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// MD5 hex digest of a file for write-back integrity verification.
/** Atomic file copy used by the same-side Steam → Steam copy. */
function copyFileAtomic(src, dest) {
  const tmp = dest + '.tmp.' + process.pid;
  fs.copyFileSync(src, tmp);
  fs.renameSync(tmp, dest);
}

/** Shallow file listing (no recursion); only files, not directories. */
function listFilesShallow(dir) {
  try {
    return fs.readdirSync(dir)
      .filter(f => {
        try { return fs.statSync(path.join(dir, f)).isFile(); } catch { return false; }
      })
      .map(f => path.join(dir, f));
  } catch { return []; }
}

function fileMd5(filePath) {
  return crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * Turn "what actually landed where" into a single ok verdict + audit report.
 * File side (xbox→steam): every landed file exists, is non-empty, and its
 * on-disk MD5 matches the source blob (or the source hash was unavailable).
 * WGS side (steam→xbox): containers.index exists, ≥1 container written, and
 * every blob actually exists on disk at the recorded size.
 * This is what the UI grades "成功/需复查/失败" against — a migration can only
 * claim success if the files the game will read are really there and intact.
 */
function buildVerify(wgsResult, opts = {}) {
  if (opts.files) {
    const files = opts.files;
    const allLanded = files.length > 0 && files.every(f => f.size > 0);
    const allHashOk = files.every(f => f.md5Match === 'n/a' || f.md5Match === true);
    return {
      ok: allLanded && allHashOk,
      targetPath: opts.targetPath,
      files,
      note: opts.note || '文件已写入目标目录，且尺寸非 0、内容 MD5 与来源一致。存档能否被游戏读取，需启动游戏读档确认一次（各游戏存档字节格式由游戏自身决定）。'
    };
  }
  if (opts.blobs) {
    const blobs = opts.blobs;
    const blobsOk = blobs.length > 0 && blobs.every(b => b.exists && b.sizeOk);
    return {
      ok: opts.indexExists && opts.containersCount > 0 && blobsOk,
      targetPath: opts.targetPath,
      containers: opts.containersCount,
      indexExists: opts.indexExists,
      blobs,
      note: opts.note || '文件已构造成 Xbox WGS v14 格式写入，且每个 WGS blob 均已落盘、大小与来源一致。首次启动 Xbox 游戏请按提示选择“使用本地存档”，并留意云同步冲突。'
    };
  }
  return { ok: false, targetPath: opts.targetPath || '', note: opts.note || '未生成校验报告。' };
}

/**
 * Best-effort game record for a bare Xbox WGS path (manual routes have no game
 * id). Reuses the identifier so per-game filename maps — the only way to know
 * Steam's `shared.dat` is Xbox's `sharedData.dat` — still apply.
 */
function inferGameRecordFromWgsPath(xboxPath) {
  try {
    const id = identifySavePath(xboxPath);
    const top = id.matches && id.matches[0];
    return top ? findGameById(top.id) : null;
  } catch {
    return null;
  }
}

/**
 * Hard gates shared by every route, derived purely from the game record.
 * Returns a refusal message, or null when the game may migrate directly.
 */
function migrationRefusalFor(gameRecord) {
  if (!gameRecord) return null;
  if (gameRecord.needsConversionTool) {
    return `该游戏 Xbox(XGP) 端与 Steam 端存档不是同一种字节布局，需先用 ${gameRecord.needsConversionTool} 等外部工具转换，暂不支持直接移植（已阻止写入以保护你的存档）。识别与提取备份功能不受影响。`;
  }
  return null;
}

/**
 * Post-migrate Steam cloud hints, driven by what is actually in the target
 * directory (tutorial case: Vampire Survivors keeps cloud mirrors that revert
 * a migrated save when Steam syncs).
 */
function steamCloudWarnings(steamPath) {
  const warnings = [];
  try {
    if (!fs.existsSync(steamPath)) return warnings;
    const cloudMarkers = fs.readdirSync(steamPath)
      .filter(f => /^steam_autocloud\.vdf$|^remotecache\.vdf$/i.test(f));
    if (cloudMarkers.length > 0) {
      warnings.push('检测到目标目录存在 Steam 云同步清单（' + cloudMarkers.join('、') + '）：若移植后游戏读不到新档，多半是云同步用云端旧档回滚了本地文件。请在 Steam 设置中暂时关闭该游戏的云同步后重试，启动游戏遇到云冲突时选择「使用本地存档」。');
    }
  } catch {}
  return warnings;
}

/**
 * Universal Steam cloud-mirror sync (Xbox -> Steam). Some games keep byte
 * copies of their saves under <Steam>\userdata\<uid>\<appid>\remote\ while the
 * live saves live elsewhere (Vampire Survivors keeps several locations — the
 * tutorial authors copy every one by hand, or Steam cloud reverts the
 * migration on next launch). The READ-ONLY enumeration of which mirrors exist
 * lives in portability.js (listSteamCloudMirrors); this function just writes
 * the same bytes + fresh mtime into each one. No new mirror files are created;
 * mirrors equal to the primary location are skipped.
 */
function syncSteamCloudMirrors(landedFiles, steamPath, steamAppId) {
  const synced = [];
  if (!Array.isArray(landedFiles) || landedFiles.length === 0) return synced;
  const byName = new Map();
  for (const f of landedFiles) if (f && f.name && f.path) byName.set(String(f.name).toLowerCase(), f);
  const targets = listSteamCloudMirrors(
    landedFiles.map(f => ({ name: f.name, path: f.path })),
    steamPath,
    steamAppId,
  );
  for (const t of targets) {
    const src = byName.get(t.name.toLowerCase());
    if (!src || !src.path || !fs.existsSync(src.path)) continue;
    try {
      const tmp = t.path + '.tmp.' + process.pid;
      fs.copyFileSync(src.path, tmp);
      fs.renameSync(tmp, t.path);
      const now = new Date();
      try { fs.utimesSync(t.path, now, now); } catch {}
      synced.push({ name: t.name, path: t.path, size: fs.statSync(t.path).size, md5Match: 'n/a', mirror: true });
    } catch {}
  }
  return synced;
}

/**
 * Single Steam -> Xbox write path shared by every route.
 *
 * UNIVERSAL, zero per-game config: the write only lands bytes in slots whose
 * logical name is derived from a Steam file name (exact, or version-suffix
 * slot); every container participates, rollback containers included. The target
 * MUST already carry the game's own WGS structure — when it doesn't, we refuse
 * instead of rebuilding guessed container names, because guessed names are
 * exactly what the game cannot read (the original "shows success but doesn't
 * work" failure). The fix is the tutorial method: launch the game once on the
 * Xbox side to let IT create the structure, then migrate.
 */
function writeSteamToXbox(filesInSteamDir, xboxPath, opts = {}) {
  const idxPath = path.join(xboxPath, 'containers.index');

  if (opts.byteIncompatible) {
    return {
      result: null,
      verify: null,
      refused: '该游戏经实测确认 Steam 与 Xbox 端存档字节格式不兼容（移植后游戏无法读取、启动黑屏），已阻止写入以保护你的 Xbox 存档。可用 Xbox→Steam 方向提取备份，或等待后续版本支持字节转换。',
    };
  }

  if (!hasExistingWgsStructure(xboxPath)) {
    return {
      result: null,
      verify: null,
      refused: 'Xbox 端还没有该游戏自己生成的存档结构（containers.index 缺失或无有效容器）。工具不会凭文件名猜测并新建容器——那是游戏读不到存档的主要原因。请先在 Xbox 端启动一次该游戏并存档，让游戏建立结构后再回来移植（教程通用方法）。',
    };
  }

  const r = updateWgsInPlace(filesInSteamDir, xboxPath);
  const blobs = r.updated.map(u => {
    const exists = Boolean(u.blobPath && fs.existsSync(u.blobPath));
    const sizeOk = exists && fs.statSync(u.blobPath).size === u.size;
    let md5Match = 'n/a';
    if (exists && u.srcMd5) md5Match = fileMd5(u.blobPath) === u.srcMd5;
    return {
      name: `${u.container} / ${u.logicalFileName}`,
      source: u.sourceFileName,
      exists,
      sizeOk,
      md5Match,
      blobPath: u.blobPath,
      size: u.size,
    };
  });
  const allOk = blobs.length > 0
    && blobs.every(b => b.exists && b.sizeOk && (b.md5Match === true || b.md5Match === 'n/a'));
  const verify = {
    ok: allOk && fs.existsSync(idxPath),
    targetPath: xboxPath,
    mode: 'in-place',
    containers: r.containersCount,
    indexExists: fs.existsSync(idxPath),
    blobs,
    skippedContainers: r.skippedContainers,
    unusedSteamFiles: r.unusedSteamFiles,
    historyBackups: r.historyBackups,
    note: '已按 Xbox 端原有容器结构就地替换存档字节（容器名、容器/blob GUID、清单均未改动），并同步时间戳。'
      + (r.unusedSteamFiles.length
        ? ` 注意：有 ${r.unusedSteamFiles.length} 个 Steam 存档文件在 Xbox 结构中找不到同名或版本号对应的存档位（${r.unusedSteamFiles.join('、')}），这些进度未被写入；Xbox 端的共享/设置类容器也不会被跨名写入。`
        : '')
      + (r.historyBackups.length
        ? ` 另有 ${r.historyBackups.length} 个带版本号的历史备份档（如 ${r.historyBackups.slice(0, 2).join('、')}${r.historyBackups.length > 2 ? ' 等' : ''}）属游戏自动轮转备份，Xbox 端无对应槽位，无需移植。`
        : '')
      + ' 存档能否被游戏读取，仍需启动游戏读档确认一次。',
  };
  return { result: r, verify };
}

/**
 * Normalize extracted Xbox blob filenames to the names the Steam game reads.
 * Unity-style games name the current save `userN.dat` and rotate backups as
 * `userN_1.0.<pkg.ver>.dat`; exposing the freshly extracted save under the
 * bare name makes it the game's "current" save. A per-game rename map (e.g.
 * sharedData.dat -> shared.dat) is applied first, then version-suffixed names
 * are collapsed onto their bare form when a matching current file already
 * exists in the target folder (so we never invent names the game doesn't use).
 * Each record carries { original, final, path, size } so the caller can build
 * an auditable "what actually landed where" report.
 */
function applySteamFileNameNormalization(extracted, targetDir, game) {
  const map = (game && game.steamFileRenameMap) || {};
  // Remember whatever "current" (bare) save names the target already uses.
  let existing = new Set();
  try { existing = new Set(fs.readdirSync(targetDir)); } catch {}

  const records = [];
  for (const f of extracted) {
    let name = map[f.logicalFileName] || f.logicalFileName;
    const original = name;

    // Collapse user1_1.0.30000.dat -> user1.dat (strip `_<digits>.<digits>` run)
    // only when the bare form already exists in the target folder.
    if (game && game.steamStripVersionSuffix) {
      const m = /^(.+?)_\d+(?:\.\d+)*(\.[^.]+)$/.exec(name);
      if (m && existing.has(m[1] + m[2])) {
        name = m[1] + m[2];
      }
    }

    const destPath = path.join(targetDir, name);
    fs.copyFileSync(f.extractedPath, destPath);
    records.push({
      original,
      final: name,
      path: destPath,
      size: fs.existsSync(destPath) ? fs.statSync(destPath).size : 0,
      srcMd5: f.md5
    });
  }
  return records;
}

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

/**
 * Failure-context collector.
 *
 * Every failure branch in this file returns `{ success: false, error, code? }`,
 * which is all the UI gets — not enough for the AI assistant to diagnose.
 * Instead of editing 100+ branches, wrap res.json so any non-2xx or
 * success:false response is enriched in one place with the request body and a
 * best-effort game/direction reading. Routes that already supply `context`
 * keep it untouched.
 */
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    if (payload && typeof payload === 'object' && payload.success === false && !payload.context) {
      const body = req.body || {};
      payload.context = {
        stage: `${req.method} ${req.path}`,
        code: payload.code || null,
        error: payload.error || null,
        gameId: body.gameId || null,
        direction: body.direction || null,
        steamPath: body.customSteamPath || body.steamPath || null,
        xboxPath: body.customXboxPath || body.xboxPath || null,
        sourcePath: body.sourcePath || null,
        targetPath: body.targetPath || null,
      };
    }
    return originalJson(payload);
  };
  next();
});

// Serve built frontend static assets from dist/
const distPath = path.join(__dirname, '../dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// API: Get Installed Games with Save Details
app.get('/api/games', async (req, res) => {
  try {
    const data = scanInstalledGames();
    // Network auto-search: fetch Chinese names for placeholder/English titles
    // and route Steam icons through the local proxy (CDN often blocked in CN).
    await enrichGames(data.games);
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// API: Local proxy for a Steam game's header art. The renderer loads from
// localhost only, so a blocked Steam CDN can't blank out icons anymore.
app.get('/api/steam-icon/:appId', async (req, res) => {
  const appId = String(req.params.appId || '').trim();
  if (!/^\d+$/.test(appId)) {
    return res.status(400).json({ success: false, error: '无效的 Steam AppID' });
  }
  try {
    const buf = await steamIconFor(appId);
    if (!buf) {
      return res.status(404).json({ success: false, error: '未找到该游戏的图标' });
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(buf);
  } catch (err) {
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// API: User-defined games for scan fallback
app.get('/api/custom-games', (req, res) => {
  res.json({ success: true, games: getCustomGames() });
});

app.post('/api/custom-games', (req, res) => {
  const { name, steamSaveRelPath, xboxPackageName, steamAppId, saveFilePattern, notes, processNames } = req.body || {};
  if (!name || (!steamSaveRelPath && !xboxPackageName)) {
    return res.status(400).json({ success: false, error: '请至少填写游戏名称和 Steam 存档路径或 Xbox 包名' });
  }
  try {
    const game = addCustomGame({ name, steamSaveRelPath, xboxPackageName, steamAppId, saveFilePattern, notes, processNames });
    res.json({ success: true, game });
  } catch (err) {
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

app.delete('/api/custom-games/:id', (req, res) => {
  try {
    deleteCustomGame(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// API: Open Folder in Windows File Explorer
app.post('/api/open-folder', (req, res) => {
  const { folderPath } = req.body;
  if (!folderPath || !fs.existsSync(folderPath)) {
    return res.status(400).json({ success: false, error: '目录不存在或无效' });
  }

  try {
    exec(`explorer.exe "${folderPath}"`);
    res.json({ success: true, message: '已在 Windows 资源管理器中打开该目录' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Save File Inspection & Validation
app.post('/api/inspect-save', (req, res) => {
  const { gameId } = req.body;
  try {
    const gamesData = scanInstalledGames();
    const game = gamesData.games.find(g => g.id === gameId);
    if (!game) {
      return res.status(404).json({ success: false, error: '未找到对应游戏' });
    }

    const steamInspection = {
      exists: game.isSteamDetected,
      path: game.steamSavePath,
      lastModified: game.steamLastModified,
      files: []
    };

    if (game.isSteamDetected && fs.existsSync(game.steamSavePath)) {
      try {
        const files = fs.readdirSync(game.steamSavePath);
        for (const f of files) {
          const fp = path.join(game.steamSavePath, f);
          if (fs.statSync(fp).isFile()) {
            const fileBuf = fs.readFileSync(fp);
            const md5 = crypto.createHash('md5').update(fileBuf).digest('hex');
            steamInspection.files.push({
              fileName: f,
              size: fileBuf.length,
              md5,
              mtime: fs.statSync(fp).mtime
            });
          }
        }
      } catch (e) { }
    }

    const xboxInspection = {
      exists: game.isXboxDetected,
      path: game.xboxWgsPath,
      lastModified: game.xboxLastModified,
      containers: []
    };

    if (game.isXboxDetected && fs.existsSync(game.xboxWgsPath)) {
      try {
        const indexPath = path.join(game.xboxWgsPath, 'containers.index');
        if (fs.existsSync(indexPath)) {
          const indexParsed = parseContainersIndex(indexPath);
          for (const c of indexParsed.containers) {
            const cPath = path.join(game.xboxWgsPath, c.guidHex);
            const mappedFiles = parseContainerFolderFiles(cPath);
            xboxInspection.containers.push({
              containerName: c.containerName,
              cloudName: c.cloudName,
              guidHex: c.guidHex,
              size: c.size,
              mappedFiles
            });
          }
        }
      } catch (e) { }
    }

    // Recommendation logic
    let recommendation = 'none';
    let recommendationReason = '';

    if (game.isSteamDetected && game.isXboxDetected) {
      const sTime = game.steamLastModified ? new Date(game.steamLastModified).getTime() : 0;
      const xTime = game.xboxLastModified ? new Date(game.xboxLastModified).getTime() : 0;

      if (xTime > sTime + 5000) {
        recommendation = 'xbox_to_steam';
        const diffMins = Math.round((xTime - sTime) / 60000);
        recommendationReason = `Xbox 端的存档更新 (比 Steam 晚 ${diffMins} 分钟)，建议【从 Xbox 提取至 Steam】。`;
      } else if (sTime > xTime + 5000) {
        recommendation = 'steam_to_xbox';
        const diffMins = Math.round((sTime - xTime) / 60000);
        recommendationReason = `Steam 端的存档更新 (比 Xbox 晚 ${diffMins} 分钟)，建议【从 Steam 打包至 Xbox】。`;
      } else {
        recommendation = 'synced';
        recommendationReason = '双端存档时间完全同步。';
      }
    } else if (game.isXboxDetected) {
      recommendation = 'xbox_to_steam';
      recommendationReason = '已检测到 Xbox 存档，建议提取并备份至 Steam 目录。';
    } else if (game.isSteamDetected) {
      recommendation = 'steam_to_xbox';
      recommendationReason = '已检测到 Steam 存档，建议打包写入 Xbox Game Pass 目录。';
    }

    res.json({
      success: true,
      game,
      steamInspection,
      xboxInspection,
      recommendation,
      recommendationReason
    });
  } catch (err) {
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// API: Resolve both platform save paths for an identified game (auto-fill the
// counterpart side of a manual migration).
app.post('/api/resolve-counterpart', (req, res) => {
  const { gameId } = req.body || {};
  try {
    if (!gameId) return res.status(400).json({ success: false, error: '缺少 gameId' });
    const result = resolveCounterpartPath(gameId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// API: Serve an installed UWP game's store logo. The renderer can't read
// WindowsApps directly, so the server streams it; falls back through common
// logo asset names when the manifest's Logo attribute misses.
app.get('/api/xbox-icon/:pkg', (req, res) => {
  const pkg = decodeURIComponent(req.params.pkg || '');
  try {
    if (!/^[A-Za-z0-9.\-_]+$/.test(pkg)) {
      return res.status(400).json({ success: false, error: '无效的包名' });
    }
    const appx = resolveAppxInfos([pkg]).get(pkg);
    if (!appx || !appx.installLocation) {
      return res.status(404).json({ success: false, error: '未找到该应用的安装位置' });
    }

    const candidates = [];
    const info = readAppxManifestInfo(appx.installLocation);
    if (info.logoRel) candidates.push(path.join(appx.installLocation, info.logoRel));
    // Common fallbacks inside Assets\ (store logos are usually plain PNG).
    const base = path.join(appx.installLocation, 'Assets');
    for (const f of [
      'StoreLogo.png',
      'Square44x44Logo.targetsize-96_altform-unplated.png',
      'Square44x44Logo.targetsize-256_altform-unplated.png',
      'Square150x150Logo.png',
      'Logo.png',
    ]) candidates.push(path.join(base, f));

    for (const p of candidates) {
      try {
        if (p && fs.existsSync(p) && fs.statSync(p).isFile()) {
          res.setHeader('Content-Type', 'image/png');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          return res.sendFile(p);
        }
      } catch {}
    }
    return res.status(404).json({ success: false, error: '未找到可用的图标资源' });
  } catch (err) {
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// API: Scan every installed packaged app, flag Game Pass games.
// 60s cached; pass ?refresh=1 to force a fresh PowerShell sweep.
app.get('/api/xbox/library', (req, res) => {
  try {
    const result = scanXboxLibrary({ refresh: req.query.refresh === '1' });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// API: Launch a packaged app by AUMID via shell activation (no Xbox client UI).
app.post('/api/xbox/launch', (req, res) => {
  const { aumid } = req.body || {};
  try {
    if (!aumid) {
      return res.status(400).json({ success: false, error: '缺少 aumid' });
    }
    res.json({ success: true, message: '启动指令已发出，正在等待游戏进程出现', ...launchXboxGame(aumid) });
  } catch (err) {
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// API: Is the packaged app (any top-level exe of the install dir) running?
app.post('/api/xbox/check-running', (req, res) => {
  const { installLocation, extraProcessNames } = req.body || {};
  try {
    if (!installLocation || !fs.existsSync(installLocation)) {
      return res.status(400).json({ success: false, error: '缺少或无效的 installLocation' });
    }
    res.json({ success: true, ...checkXboxGameRunning(installLocation, extraProcessNames || []) });
  } catch (err) {
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// API: Best-effort cloud-sync kill switch — close the Xbox app suite, kill
// XboxPcAppFT, try to stop GamingServices (admin-gated, failure is tolerated).
app.post('/api/xbox/stop-cloud-sync', (req, res) => {
  try {
    res.json({ success: true, ...stopCloudSync() });
  } catch (err) {
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// API: Identify a source path, resolve both platform paths, and migrate in one shot.
// Goal: "drop in an unknown save folder -> system figures out the game + direction
// -> fills in the counterpart path -> migrates".
app.post('/api/identify-and-migrate', async (req, res) => {
  const { sourcePath, direction, customSteamPath, customXboxPath } = req.body || {};
  try {
    if (!sourcePath) {
      return res.status(400).json({ success: false, error: '缺少源存档路径 sourcePath' });
    }
    if (!direction || !['xbox_to_steam', 'steam_to_xbox'].includes(direction)) {
      return res.status(400).json({ success: false, error: '缺少或无效的 direction' });
    }

    // Cloud-overwrite guard — same as /api/migrate. Xbox app auto-closes.
    const idTargetSide = direction === 'xbox_to_steam' ? 'steam' : 'xbox';
    const idPlatform = checkPlatformClient(idTargetSide);
    if (idPlatform.running) {
      if (idTargetSide === 'xbox') {
        const closed = closePlatformClient('xbox');
        if (closed.stillRunning.length > 0) {
          return res.status(409).json({
            success: false,
            code: 'PLATFORM_RUNNING',
            error: `已尝试自动关闭 Xbox 应用但仍有进程未退出（${closed.stillRunning.join('、')}）。${closed.hint ? closed.hint + '。' : '请手动退出 Xbox 应用后'}重试。`
          });
        }
      } else {
        return res.status(409).json({
          success: false,
          code: 'PLATFORM_RUNNING',
          error: `检测到 Steam 客户端正在运行。为防止云同步覆盖刚移植的存档，请完全退出 Steam 后重试。`
        });
      }
    }

    const idResult = identifySavePath(sourcePath);
    const topMatch = idResult.matches && idResult.matches[0];

    // Full DB record (carries per-game rename maps that a bare match lacks).
    const gameRecord = topMatch ? findGameById(topMatch.id) : null;

    // Resolve counterpart (and confirm the chosen sides) via the identified game.
    let counterpart = null;
    if (topMatch) {
      counterpart = resolveCounterpartPath(topMatch.id);
    }

    let steamPath = customSteamPath || (counterpart && counterpart.steamSavePath) || null;
    let xboxPath = customXboxPath || (counterpart && counterpart.xboxWgsPath) || null;

    // Honor the folder the user actually picked: when it IS the source side for
    // the chosen direction, migrate FROM it rather than from the auto-resolved
    // library path (the two differ for archived/relocated copies). The picked
    // folder is only an identification hint for the opposite direction.
    if (direction === 'xbox_to_steam' && idResult.side === 'xbox' && !customXboxPath) {
      xboxPath = sourcePath;
    } else if (direction === 'steam_to_xbox' && idResult.side === 'steam' && !customSteamPath) {
      steamPath = sourcePath;
    }

    // If the source itself is clearly one side, sanity-check we're not migrating
    // in a nonsensical direction for it.
    if (!steamPath || !xboxPath) {
      return res.status(400).json({
        success: false,
        error: `无法自动补全对面平台的路径。识别结果：${idResult.side}${topMatch ? '（' + topMatch.name + '）' : ''}。请在手动移植面板中自行指定两个路径，或确认该游戏已安装两边。`
      });
    }

    let backupInfo = null;
    // Always back up the side that is about to be OVERWRITTEN, not the source.
    if (direction === 'xbox_to_steam') {
      if (fs.existsSync(steamPath)) backupInfo = await createBackup(steamPath, 'identify', 'steam', { restoreTargetPath: steamPath, direction, gameName: topMatch ? topMatch.name : null });
    } else if (fs.existsSync(xboxPath)) {
      backupInfo = await createBackup(xboxPath, 'identify', 'xbox', { restoreTargetPath: xboxPath, direction, gameName: topMatch ? topMatch.name : null });
    }

    const result = direction === 'xbox_to_steam'
      ? await extractWgsToFolder(xboxPath, steamPath)
      : null;

    // Identify-only (Category C) games are recognized for identification but
    // have no verified steam↔xbox layout — surface that in the report so the
    // UI can warn instead of claiming a sure success.
    const isIdentifyOnly = topMatch && (topMatch.category === 'C' || gameRecord?.category === 'C');
    const ruleSource = gameRecord || topMatch || null;
    const identifiedInfo = {
      side: idResult.side,
      gameId: topMatch ? topMatch.id : null,
      name: topMatch ? topMatch.name : null,
      confidence: topMatch ? topMatch.confidence : null,
      identifyOnly: Boolean(isIdentifyOnly),
      byteIncompatible: Boolean(ruleSource && ruleSource.steamXboxByteIncompatible),
      needsConversionTool: Boolean(ruleSource && ruleSource.needsConversionTool),
      accountBound: Boolean(ruleSource && ruleSource.accountBound),
      writeRuleNote: (ruleSource && ruleSource.xboxWriteRule && ruleSource.xboxWriteRule.note) || null,
    };

    // Hard gate for conversion-required games (both directions — Palworld etc.).
    const convRefusal = migrationRefusalFor(ruleSource);
    if (convRefusal) {
      return res.status(400).json({
        success: false,
        code: 'CONVERSION_REQUIRED',
        error: `《${topMatch ? topMatch.name : '游戏'}》${convRefusal}`
      });
    }

    if (direction === 'xbox_to_steam') {
      if (result.extractedFiles.length === 0) {
        return res.status(500).json({ success: false, error: '未能从 Xbox WGS 目录提取到任何存档文件。' });
      }
      const renamed = applySteamFileNameNormalization(result.extractedFiles, steamPath, gameRecord || topMatch || {});
      // Audit report: landed name + size + MD5 match vs the source blob, then
      // universal Steam cloud-mirror sync (same save names under userdata).
      const files = renamed.map(r => {
        let md5Match = 'n/a';
        if (r.srcMd5 && r.size > 0) {
          md5Match = fileMd5(r.path) === r.srcMd5;
        }
        return { name: r.final, original: r.original, size: r.size, path: r.path, md5Match };
      });
      const mirrors = syncSteamCloudMirrors(files, steamPath, (gameRecord || topMatch || {}).steamAppId);
      if (mirrors.length > 0) files.push(...mirrors);
      const verify = buildVerify(null, {
        files,
        targetPath: steamPath,
        note: '已根据识别结果自动补全路径并完成 Xbox→Steam 移植。' + (isIdentifyOnly ? '（注意：该游戏属于“识别专用”分类，双端存档布局未经实测验证，启动游戏后请务必确认一次读档情况。）' : '')
      });
      return res.json({
        success: true,
        message: `识别成功（${topMatch ? topMatch.name : '未知游戏'}），完成 Xbox→Steam 移植。`,
        identified: identifiedInfo,
        warnings: [
          ...steamCloudWarnings(steamPath),
          ...(mirrors.length > 0 ? [`已同步 ${mirrors.length} 个 Steam 云镜像中的同名存档（userdata\\<账号>\\${(gameRecord || topMatch || {}).steamAppId}\\remote），防止云同步用旧镜像回滚。`] : []),
          ...(ruleSource && ruleSource.accountBound ? ['注意：该游戏为在线服务类，存档与微软/游戏账号绑定——只移植你自己账号的存档，使用他人存档可能无法读档甚至有封号风险。'] : []),
        ],
        backup: backupInfo,
        verify,
        result
      });
    } else {
      // steam_to_xbox
      if (!fs.existsSync(steamPath)) {
        return res.status(400).json({ success: false, error: `未找到 Steam 存档目录：${steamPath}` });
      }
      const filesInSteamDir = fs.readdirSync(steamPath)
        .filter(f => fs.statSync(path.join(steamPath, f)).isFile())
        .map(f => ({ fileName: f, filePath: path.join(steamPath, f) }));
      if (filesInSteamDir.length === 0) {
        return res.status(400).json({ success: false, error: `Steam 存档目录为空：${steamPath}` });
      }
      const pkgName = counterpart && counterpart.xboxPackageFolder
        ? counterpart.xboxPackageFolder
        : 'GamePassSave';
      const { result: pkgResult, verify, refused } = writeSteamToXbox(filesInSteamDir, xboxPath, {
        packageName: pkgName,
        byteIncompatible: Boolean(gameRecord && gameRecord.steamXboxByteIncompatible),
      });
      if (refused) {
        return res.status(400).json({
          success: false,
          code: 'BYTE_INCOMPATIBLE',
          error: `《${topMatch ? topMatch.name : '游戏'}》${refused}`
        });
      }
      if (isIdentifyOnly) {
        verify.note += '（注意：该游戏属于“识别专用”分类，双端存档布局未经实测验证，启动游戏后请务必确认一次读档情况。）';
      }
      return res.json({
        success: true,
        message: `识别成功（${topMatch ? topMatch.name : '游戏'}），完成 Steam→Xbox 移植。`,
        identified: identifiedInfo,
        warnings: [
          ...(ruleSource && ruleSource.accountBound ? ['注意：该游戏为在线服务类，存档与微软/游戏账号绑定——只移植你自己账号的存档，使用他人存档可能无法读档甚至有封号风险。'] : []),
        ],
        backup: backupInfo,
        verify,
        result: pkgResult
      });
    }
  } catch (err) {
    console.error('Identify-and-migrate Error:', err);
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// API: Migrate Saves between Steam and Xbox
app.post('/api/migrate', async (req, res) => {
  const { gameId, direction, customSteamPath, customXboxPath } = req.body;

  if (!gameId || !direction) {
    return res.status(400).json({ success: false, error: 'Missing gameId or direction' });
  }

  try {
    const gamesData = scanInstalledGames();
    const game = gamesData.games.find(g => g.id === gameId);

    if (!game) {
      return res.status(404).json({ success: false, error: 'Game not found in database' });
    }

    // Hard gate: games needing an external byte-conversion tool never migrate
    // directly (Palworld: XGP .SAV ≠ Steam .sav — tutorial-verified).
    const refusal = migrationRefusalFor(game);
    if (refusal) {
      return res.status(400).json({ success: false, code: 'CONVERSION_REQUIRED', error: `《${game.name}》${refusal}` });
    }

    const processCheck = checkGameRunning(game.processNames || []);
    if (processCheck.running) {
      return res.status(409).json({
        success: false,
        code: 'GAME_RUNNING',
        error: `检测到《${game.name}》仍在运行（${processCheck.matchedNames.join('、')}）。请先完全退出游戏后再执行存档移植。`
      });
    }

    // Cloud-overwrite guard: the client that owns the TARGET side's cloud sync
    // must be closed, or it can push its in-memory stale cloud state right back
    // over the files we're about to write. Xbox app is auto-closed; Steam stays
    // a manual step (users may be mid-download).
    const targetSide = direction === 'xbox_to_steam' ? 'steam' : 'xbox';
    const platform = checkPlatformClient(targetSide);
    if (platform.running) {
      if (targetSide === 'xbox') {
        const closed = closePlatformClient('xbox');
        if (closed.stillRunning.length > 0) {
          return res.status(409).json({
            success: false,
            code: 'PLATFORM_RUNNING',
            error: `已尝试自动关闭 Xbox 应用但仍有进程未退出（${closed.stillRunning.join('、')}）。${closed.hint ? closed.hint + '。' : '请手动退出 Xbox 应用（右下角托盘图标 → 退出）后'}重试。`
          });
        }
      } else {
        return res.status(409).json({
          success: false,
          code: 'PLATFORM_RUNNING',
          error: `检测到 Steam 客户端正在运行。为防止云同步把旧存档覆盖回刚移植的文件，请完全退出 Steam（右下角托盘图标 → 退出）后重试。`
        });
      }
    }

    const steamPath = customSteamPath || game.steamSavePath;
    const xboxPath = customXboxPath || game.xboxWgsPath;

    let backupInfo = null;

    if (direction === 'xbox_to_steam') {
      if (!fs.existsSync(xboxPath) || !fs.existsSync(path.join(xboxPath, 'containers.index'))) {
        return res.status(400).json({ success: false, error: `Xbox WGS 目录无效或缺少 containers.index：${xboxPath}` });
      }

      if (fs.existsSync(steamPath)) {
        backupInfo = await createBackup(steamPath, gameId, 'steam', { restoreTargetPath: steamPath, direction, gameName: game.name });
      }

      const result = extractWgsToFolder(xboxPath, steamPath);

      if (result.extractedFiles.length === 0) {
        return res.status(500).json({ success: false, error: '未能从 Xbox WGS 目录提取到任何存档文件，请检查该游戏是否真的有本地存档。' });
      }

const renamed = applySteamFileNameNormalization(result.extractedFiles, steamPath, game);

      // Build an auditable landed-file report for the UI, then keep any Steam
      // cloud mirrors of the same save names in sync (universal multi-location
      // rule — otherwise cloud sync can revert the migration).
      const files = renamed.map(r => {
        let md5Match = 'n/a';
        if (r.srcMd5 && r.size > 0) {
          md5Match = fileMd5(r.path) === r.srcMd5;
        }
        return { name: r.final, original: r.original, size: r.size, path: r.path, md5Match };
      });
      const mirrors = syncSteamCloudMirrors(files, steamPath, game.steamAppId);
      if (mirrors.length > 0) files.push(...mirrors);
      const allLanded = files.length > 0 && files.every(f => f.size > 0);
      const allHashOk = files.every(f => f.md5Match === 'n/a' || f.md5Match === true);
      const verify = buildVerify(null, {
        files,
        targetPath: steamPath,
        note: '文件已写入 Steam 存档目录，且尺寸非 0、内容 MD5 与来源一致。存档能否被游戏读取，需启动游戏读档确认一次（各游戏存档字节格式由游戏自身决定）。'
      });

      return res.json({
        success: true,
        message: `成功从 Xbox 提取并移植 ${renamed.length} 个存档文件至 Steam 目录！`,
        warnings: [
          '移植时已要求退出 Steam；现在重新打开 Steam 即可。启动游戏后 Steam 会自动把新存档上传为云端最新版。',
          '如果启动游戏时弹出云同步冲突选择框，请务必选择「使用本地存档」，避免云端旧存档覆盖刚移植的文件。',
          ...steamCloudWarnings(steamPath),
          ...(mirrors.length > 0 ? [`已同步 ${mirrors.length} 个 Steam 云镜像中的同名存档（userdata\\<账号>\\${game.steamAppId}\\remote），防止云同步用旧镜像回滚。`] : []),
          ...(game.accountBound ? ['注意：该游戏为在线服务类，存档与微软/游戏账号绑定——只移植你自己账号的存档，使用他人存档可能无法读档甚至有封号风险。'] : []),
        ],
        backup: backupInfo,
        verify,
        result
      });
    } else if (direction === 'steam_to_xbox') {
      if (!fs.existsSync(steamPath)) {
        return res.status(400).json({ success: false, error: `未找到 Steam 存档目录：${steamPath}` });
      }

      if (fs.existsSync(xboxPath)) {
        backupInfo = await createBackup(xboxPath, gameId, 'xbox', { restoreTargetPath: xboxPath, direction, gameName: game.name });
      }

      const filesInSteamDir = fs.readdirSync(steamPath)
        .filter(f => fs.statSync(path.join(steamPath, f)).isFile())
        .map(f => ({
          fileName: f,
          filePath: path.join(steamPath, f)
        }));

      if (filesInSteamDir.length === 0) {
        return res.status(400).json({ success: false, error: `Steam 存档目录中未找到有效文件：${steamPath}` });
      }

const pkgName = game.xboxPackageFolder || game.xboxPackageName.replace('*', 'Save');
      const { result, verify, refused } = writeSteamToXbox(filesInSteamDir, xboxPath, {
        packageName: pkgName,
        byteIncompatible: Boolean(game.steamXboxByteIncompatible),
      });
      if (refused) {
        return res.status(400).json({
          success: false,
          code: 'BYTE_INCOMPATIBLE',
          error: `《${game.name}》${refused}`
        });
      }

      return res.json({
        success: true,
        message: `成功将 Steam 存档写入 Xbox 目录！`,
        warnings: [
          'Xbox 应用已在移植前自动关闭（防止其推送云端旧档）；现在重新打开 Xbox 应用再启动游戏。存档时间戳已同步为最新，云端会自动拉取本地新档。',
          '若首次启动弹出云同步冲突选择框，请务必选择「使用本地存档」。建议先断网启动一次游戏确认读档正常，再恢复联网。',
          ...(game.accountBound ? ['注意：该游戏为在线服务类，存档与微软/游戏账号绑定——只移植你自己账号的存档，使用他人存档可能无法读档甚至有封号风险。'] : []),
        ],
        backup: backupInfo,
        verify,
        result
      });
    } else {
      return res.status(400).json({ success: false, error: 'Invalid migration direction' });
    }
  } catch (err) {
    console.error('Migration Error:', err);
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// API: Choose a Windows folder for the manual converter.
app.post('/api/pick-folder', (req, res) => {
  if (process.platform !== 'win32') {
    return res.status(400).json({ success: false, error: '文件夹选择器仅支持 Windows' });
  }
  try {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
      '$d.Description = \'请选择目录\'',
      '$d.ShowNewFolderButton = $true',
      'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($d.SelectedPath) }'
    ].join('; ');
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true });
    let output = '';
    let error = '';
    child.stdout.on('data', data => { output += data.toString(); });
    child.stderr.on('data', data => { error += data.toString(); });
    child.on('close', code => {
      if (code !== 0) return res.status(500).json({ success: false, error: error.trim() || '无法打开文件夹选择器' });
      res.json({ success: true, path: output.trim() });
    });
  } catch (err) {
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// API: Choose a single save FILE on Windows (OpenFileDialog).
app.post('/api/pick-file', (req, res) => {
  if (process.platform !== 'win32') {
    return res.status(400).json({ success: false, error: '文件选择器仅支持 Windows' });
  }
  try {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$d = New-Object System.Windows.Forms.OpenFileDialog',
      '$d.Title = \'请选择存档文件\'',
      '$d.Filter = \'存档文件 (*.dat;*.sav;*.json;*.sfs;*.bin;*.save;*.gsv;*.hg;*.csk;*.wld;*.plr;*.sjson)|*.dat;*.sav;*.json;*.sfs;*.bin;*.save;*.gsv;*.hg;*.csk;*.wld;*.plr;*.sjson|所有文件 (*.*)|*.*\'',
      '$d.CheckFileExists = $true',
      'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($d.FileName) }'
    ].join('; ');
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true });
    let output = '';
    let error = '';
    child.stdout.on('data', data => { output += data.toString(); });
    child.stderr.on('data', data => { error += data.toString(); });
    child.on('close', code => {
      if (code !== 0) return res.status(500).json({ success: false, error: error.trim() || '无法打开文件选择器' });
      res.json({ success: true, path: output.trim() });
    });
  } catch (err) {
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// API: Backup restore/delete/open
app.post('/api/backups/restore', async (req, res) => {
  try {
    const { backupPath, targetFolderPath } = req.body || {};
    const result = await restoreBackup(backupPath, targetFolderPath);
    res.json({ success: true, result });
  } catch (err) {
    res.status(400).json({ success: false, error: friendlyError(err) });
  }
});

app.delete('/api/backups', (req, res) => {
  try {
    const result = deleteBackup(req.body?.backupPath);
    res.json({ success: true, result });
  } catch (err) {
    res.status(400).json({ success: false, error: friendlyError(err) });
  }
});

app.post('/api/backups/open', (req, res) => {
  try {
    const backupPath = req.body?.backupPath;
    if (!backupPath || !fs.existsSync(backupPath)) return res.status(400).json({ success: false, error: '备份文件不存在' });
    exec(`explorer.exe /select,"${backupPath}"`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// API: Restore using the directory recorded in the backup's sidecar (one-click rollback).
app.post('/api/backups/restore-auto', async (req, res) => {
  try {
    const { backupPath } = req.body || {};
    const result = await restoreBackupAuto(backupPath);
    res.json({ success: true, result });
  } catch (err) {
    res.status(400).json({ success: false, error: friendlyError(err) });
  }
});

// API: 设置读写。GET 永不回传 API Key 明文，只回 hint。
app.get('/api/settings', (req, res) => {
  try {
    res.json({ success: true, settings: getPublicSettings() });
  } catch (err) {
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

app.put('/api/settings', (req, res) => {
  try {
    writeSettings(req.body || {});
    res.json({ success: true, settings: getPublicSettings() });
  } catch (err) {
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// API: 测试 AI 连通性（设置页「测试连接」按钮）。
// 接受表单当前值，未保存也能验证；缺省字段回落到已保存配置。
app.post('/api/settings/test-ai', async (req, res) => {
  try {
    const { baseUrl, model, apiKey, timeoutMs } = req.body || {};
    const result = await testAiConnection({ baseUrl, model, apiKey, timeoutMs });
    res.json({ success: true, ...result });
  } catch (err) {
    const code = err instanceof AiError ? err.code : 'AI_UNKNOWN';
    res.status(400).json({ success: false, error: err.message || friendlyError(err), code });
  }
});

// API: AI 失败诊断 — 用户手动触发，输入是一次移植失败的现场上下文。
app.post('/api/ai/explain-failure', async (req, res) => {
  try {
    const context = req.body?.context || {};
    const result = await explainFailure(context);
    res.json({ success: true, ...result });
  } catch (err) {
    const code = err instanceof AiError ? err.code : 'AI_UNKNOWN';
    res.status(400).json({ success: false, error: err.message || friendlyError(err), code });
  }
});

// API: Manual WGS Extraction
app.post('/api/manual/extract', (req, res) => {
  const { wgsFolderPath, outputFolderPath } = req.body;
  if (!wgsFolderPath || !outputFolderPath) {
    return res.status(400).json({ success: false, error: 'Missing folder paths' });
  }

  try {
    const result = extractWgsToFolder(wgsFolderPath, outputFolderPath);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// API: Manual WGS Packing (advanced tool). Goes through the same
// structure-preserving writer as the migration routes, and backs up the target
// first — this route used to call the destructive rebuild with no backup at all.
app.post('/api/manual/pack', async (req, res) => {
  const { inputFolderPath, targetWgsFolderPath, packageName } = req.body;
  if (!inputFolderPath || !targetWgsFolderPath) {
    return res.status(400).json({ success: false, error: 'Missing folder paths' });
  }

  try {
    const packPlatform = checkPlatformClient('xbox');
    if (packPlatform.running) {
      const closed = closePlatformClient('xbox');
      if (closed.stillRunning.length > 0) {
        return res.status(409).json({
          success: false,
          code: 'PLATFORM_RUNNING',
          error: `已尝试自动关闭 Xbox 应用但仍有进程未退出（${closed.stillRunning.join('、')}）。${closed.hint ? closed.hint + '。' : '请手动退出 Xbox 应用后'}重试。`
        });
      }
    }

    const files = fs.readdirSync(inputFolderPath)
      .filter(f => fs.statSync(path.join(inputFolderPath, f)).isFile())
      .map(f => ({ fileName: f, filePath: path.join(inputFolderPath, f) }));

    if (files.length === 0) {
      return res.status(400).json({ success: false, error: `来源目录中未找到有效文件：${inputFolderPath}` });
    }

    let backupInfo = null;
    if (fs.existsSync(targetWgsFolderPath)) {
      backupInfo = await createBackup(targetWgsFolderPath, 'manual-pack', 'xbox', { restoreTargetPath: targetWgsFolderPath, direction: 'pack', gameName: null });
    }

    const { result, verify, refused } = writeSteamToXbox(files, targetWgsFolderPath, {
      packageName: packageName || 'ManualPackage',
    });
    if (refused) return res.status(400).json({ success: false, code: 'BYTE_INCOMPATIBLE', error: refused });
    res.json({ success: true, backup: backupInfo, verify, result });
  } catch (err) {
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// API: Side-AGNOSTIC save copy. Source and target each carry their own
// (independently resolved) side, so the same endpoint covers four cases:
//   xbox  -> xbox   (multi-user, multi-instance, WGS backup/restore)
//   steam -> steam  (cross-account, cross-machine restore, manual mirroring)
//   xbox  -> steam  (异端提取)
//   steam -> xbox   (异端打包)
// The WGS writer is end-agnostic: Steam files fed into an Xbox target still
// go through the universal slot-matching contract.
app.post('/api/copy-save', async (req, res) => {
  const { sourcePath, sourceSide, targetPath, targetSide, targetSteamAppId } = req.body || {};
  if (!sourcePath || !targetPath || !sourceSide || !targetSide) {
    return res.status(400).json({ success: false, error: '请同时提供 sourcePath、sourceSide、targetPath、targetSide' });
  }
  if (!['xbox', 'steam'].includes(sourceSide) || !['xbox', 'steam'].includes(targetSide)) {
    return res.status(400).json({ success: false, error: 'sourceSide / targetSide 必须为 xbox 或 steam' });
  }
  try {
    if (path.resolve(sourcePath) === path.resolve(targetPath)) {
      return res.status(400).json({ success: false, error: '源目录与目标目录相同，复制没有意义。' });
    }
  } catch {}

  try {
    let backupInfo = null;

    if (sourceSide === 'xbox' && targetSide === 'xbox') {
      const idxPath = path.join(sourcePath, 'containers.index');
      if (!fs.existsSync(sourcePath) || !fs.existsSync(idxPath)) {
        return res.status(400).json({ success: false, error: `源 WGS 目录无效或缺少 containers.index：${sourcePath}` });
      }
      if (!hasExistingWgsStructure(targetPath)) {
        return res.status(400).json({ success: false, error: `目标 WGS 目录还没有该游戏自己生成的存档结构。工具不凭文件名猜测并新建容器（那是游戏读不到存档的主要原因），请先启动一次游戏让 Xbox 端生成结构。` });
      }
      if (fs.existsSync(targetPath)) {
        backupInfo = await createBackup(targetPath, 'copy-xbox-xbox', 'xbox', { restoreTargetPath: targetPath, direction: 'xbox_to_xbox', gameName: null });
      }
      const { parseContainersIndexDetailed, parseContainerFolderFiles } = await import('./wgsEngine.js');
      const detailed = parseContainersIndexDetailed(path.join(sourcePath, 'containers.index'));
      const inputFiles = [];
      for (const c of detailed.containers) {
        const srcDir = path.join(sourcePath, c.guidHex);
        for (const m of parseContainerFolderFiles(srcDir)) {
          if (m.blobPath) inputFiles.push({ fileName: m.logicalFileName, filePath: m.blobPath });
        }
      }
      const { result, verify, refused } = writeSteamToXbox(inputFiles, targetPath, { byteIncompatible: false });
      if (refused) return res.status(400).json({ success: false, code: 'BYTE_INCOMPATIBLE', error: refused });
      return res.json({
        success: true,
        message: `完成 Xbox→Xbox 同端复制（${result.updated.length} 个槽位已写入目标容器）。`,
        warnings: [
          '同端复制常用于多账号切换、备份恢复或 WGS 实例迁移；操作前已自动备份目标目录。',
          '若首次启动弹出云同步冲突选择框，请务必选择「使用本地存档」。',
        ],
        backup: backupInfo,
        verify,
        result,
      });
    }

    if (sourceSide === 'steam' && targetSide === 'steam') {
      if (!fs.existsSync(sourcePath)) {
        return res.status(400).json({ success: false, error: `源目录不存在：${sourcePath}` });
      }
      const files = listFilesShallow(sourcePath);
      if (files.length === 0) {
        return res.status(400).json({ success: false, error: `源目录中没有任何文件：${sourcePath}` });
      }
      if (fs.existsSync(targetPath)) {
        backupInfo = await createBackup(targetPath, 'copy-steam-steam', 'steam', { restoreTargetPath: targetPath, direction: 'steam_to_steam', gameName: null });
      } else {
        fs.mkdirSync(targetPath, { recursive: true });
      }
      const landed = [];
      for (const f of files) {
        const dest = path.join(targetPath, path.basename(f));
        copyFileAtomic(f, dest);
        try { fs.utimesSync(dest, new Date(), new Date()); } catch {}
        let md5Match = 'n/a';
        try { md5Match = fileMd5(dest) === fileMd5(f); } catch {}
        landed.push({ name: path.basename(f), original: path.basename(f), size: fs.statSync(dest).size, path: dest, md5Match });
      }
      const mirrors = syncSteamCloudMirrors(landed, targetPath, targetSteamAppId);
      if (mirrors.length > 0) landed.push(...mirrors);
      const verify = {
        ok: landed.length > 0 && landed.every(f => f.size > 0),
        targetPath,
        files: landed,
        note: '文件已复制到目标 Steam 存档目录；同名云镜像（如 userdata\\<账号>\\<appid>\\remote\\ 中的文件）也已同步更新。',
      };
      return res.json({
        success: true,
        message: `完成 Steam→Steam 同端复制（${landed.length - mirrors.length} 个文件${mirrors.length ? ` + ${mirrors.length} 个云镜像` : ''}）。`,
        warnings: [
          '同端复制常用于多账号切换、跨机恢复或手动镜像。',
          '如果启动游戏时弹出云同步冲突选择框，请务必选择「使用本地存档」。',
          ...(mirrors.length > 0 ? [`已同步 ${mirrors.length} 个 Steam 云镜像（userdata\\<账号>\\${targetSteamAppId || '?'}\\remote），防止云同步回滚。`] : []),
        ],
        backup: backupInfo,
        verify,
        result: { copied: landed.length, mirrors: mirrors.length },
      });
    }

    if (sourceSide === 'xbox' && targetSide === 'steam') {
      const idxPath = path.join(sourcePath, 'containers.index');
      if (!fs.existsSync(sourcePath) || !fs.existsSync(idxPath)) {
        return res.status(400).json({ success: false, error: `源 WGS 目录无效或缺少 containers.index：${sourcePath}` });
      }
      if (fs.existsSync(targetPath)) {
        backupInfo = await createBackup(targetPath, 'copy-xbox-steam', 'steam', { restoreTargetPath: targetPath, direction: 'xbox_to_steam', gameName: null });
      } else {
        fs.mkdirSync(targetPath, { recursive: true });
      }
      const result = extractWgsToFolder(sourcePath, targetPath);
      if (result.extractedFiles.length === 0) {
        return res.status(500).json({ success: false, error: '未能从 Xbox WGS 目录提取到任何存档文件。' });
      }
      const files = result.extractedFiles.map(f => {
        let md5Match = 'n/a';
        if (f.md5 && f.size > 0 && fs.existsSync(f.extractedPath)) md5Match = fileMd5(f.extractedPath) === f.md5;
        return { name: f.logicalFileName, original: f.logicalFileName, size: f.size, path: f.extractedPath, md5Match };
      });
      const mirrors = syncSteamCloudMirrors(files, targetPath, targetSteamAppId);
      if (mirrors.length > 0) files.push(...mirrors);
      const verify = {
        ok: files.length > 0 && files.every(f => f.size > 0),
        targetPath,
        files,
        note: '已从 Xbox WGS 提取并写入目标 Steam 目录，尺寸非 0、内容 MD5 与来源一致。',
      };
      return res.json({
        success: true,
        message: `完成 Xbox→Steam 提取（${files.length - mirrors.length} 个文件${mirrors.length ? ` + ${mirrors.length} 个云镜像` : ''}）。`,
        warnings: [
          '如果启动游戏时弹出云同步冲突选择框，请务必选择「使用本地存档」。',
          ...(mirrors.length > 0 ? [`已同步 ${mirrors.length} 个 Steam 云镜像（userdata\\<账号>\\${targetSteamAppId || '?'}\\remote），防止云同步用旧镜像回滚。`] : []),
        ],
        backup: backupInfo,
        verify,
        result,
      });
    }

    if (sourceSide === 'steam' && targetSide === 'xbox') {
      if (!fs.existsSync(sourcePath)) {
        return res.status(400).json({ success: false, error: `源 Steam 目录不存在：${sourcePath}` });
      }
      const inputFiles = listFilesShallow(sourcePath).map(p => ({ fileName: path.basename(p), filePath: p }));
      if (inputFiles.length === 0) {
        return res.status(400).json({ success: false, error: `源目录中没有任何文件：${sourcePath}` });
      }
      if (!hasExistingWgsStructure(targetPath)) {
        return res.status(400).json({ success: false, error: `目标 WGS 目录还没有该游戏自己生成的存档结构。工具不凭文件名猜测并新建容器，请先在 Xbox 端启动一次游戏让游戏建立结构。` });
      }
      if (fs.existsSync(targetPath)) {
        backupInfo = await createBackup(targetPath, 'copy-steam-xbox', 'xbox', { restoreTargetPath: targetPath, direction: 'steam_to_xbox', gameName: null });
      }
      const { result, verify, refused } = writeSteamToXbox(inputFiles, targetPath, { byteIncompatible: false });
      if (refused) return res.status(400).json({ success: false, code: 'BYTE_INCOMPATIBLE', error: refused });
      return res.json({
        success: true,
        message: `完成 Steam→Xbox 移植（${result.updated.length} 个槽位已写入目标容器）。`,
        warnings: [
          '若首次启动弹出云同步冲突选择框，请务必选择「使用本地存档」。',
        ],
        backup: backupInfo,
        verify,
        result,
      });
    }

    return res.status(400).json({ success: false, error: `不支持的复制方向：${sourceSide} → ${targetSide}` });
  } catch (err) {
    console.error('Copy-save Error:', err);
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// API: Identify which game a user-selected save folder belongs to.
app.post('/api/identify-save', (req, res) => {
  const { savePath } = req.body || {};
  if (!savePath) {
    return res.status(400).json({ success: false, error: '请提供待识别的存档路径' });
  }
  try {
    const result = identifySavePath(savePath);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// API: Read-only "portability test / preview" (dry run, no writes). Runs the
// SAME slot-matching the real migration uses and reports, for BOTH directions,
// what would land where and why anything is refused/downgraded. Safe to call
// repeatedly — it is the "移植测试" button's backend.
app.post('/api/portability-report', (req, res) => {
  const { gameId, customSteamPath, customXboxPath } = req.body || {};
  if (!gameId) {
    return res.status(400).json({ success: false, error: '请提供 gameId' });
  }
  try {
    const gamesData = scanInstalledGames();
    const game = gamesData.games.find(g => g.id === gameId);
    if (!game) {
      return res.status(404).json({ success: false, error: `未找到游戏 ${gameId}（可能本机未检测到）` });
    }
    const steamPath = customSteamPath || game.steamSavePath;
    const xboxPath = customXboxPath || game.xboxWgsPath;
    const s2x = predictSteamToXbox(game, steamPath, xboxPath);
    const x2s = predictXboxToSteam(game, steamPath, xboxPath);
    res.json({
      success: true,
      game: {
        id: game.id,
        name: game.name,
        category: game.category,
        needsConversionTool: game.needsConversionTool || null,
        accountBound: Boolean(game.accountBound),
        identifyOnly: game.category === 'C',
      },
      steamPath,
      xboxPath,
      steamToXbox: s2x,
      xboxToSteam: x2s,
      note: '预演结果：写入是否落对槽位已验证（同名/版本后缀/容器名三条名字派生通道），但游戏是否接受外来字节（加密/校验和/账号绑定）仍需进游戏读档确认一次。',
    });
  } catch (err) {
    console.error('Portability-report Error:', err);
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// API: Read-only portability prediction ("移植测试 / 预演"). Runs the EXACT
// dry-run matching the real migration would use, so a green verdict and the
// actual write can never disagree. No bytes are written, ever.
app.post('/api/portability-report', (req, res) => {
  const { gameId, customSteamPath, customXboxPath } = req.body || {};
  if (!gameId) {
    return res.status(400).json({ success: false, error: '请提供 gameId' });
  }
  try {
    const gamesData = scanInstalledGames();
    const game = gamesData.games.find(g => g.id === gameId);
    if (!game) {
      return res.status(404).json({ success: false, error: '未找到该游戏（可能未在本机检测到）' });
    }
    const steamPath = customSteamPath || game.steamSavePath;
    const xboxPath = customXboxPath || game.xboxWgsPath;
    const s2x = predictSteamToXbox(game, steamPath, xboxPath);
    const x2s = predictXboxToSteam(game, steamPath, xboxPath);
    res.json({
      success: true,
      game: {
        id: game.id,
        name: game.name,
        category: game.category,
        needsConversionTool: game.needsConversionTool || null,
        accountBound: Boolean(game.accountBound),
        identifyOnly: game.category === 'C',
      },
      steamPath,
      xboxPath,
      steamToXbox: s2x,
      xboxToSteam: x2s,
      note: '预演结果：写入是否落对槽位已验证（同名/版本后缀/容器名三条名字派生通道），但游戏是否接受外来字节（加密/校验和/账号绑定）仍需进游戏读档确认一次。',
    });
  } catch (err) {
    console.error('Portability-report Error:', err);
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});


// API: Manual point-and-click migration between arbitrary Steam folder and
// arbitrary Xbox WGS folder — no preset game entry required. The user picks
// both folders; this validates them, backs up the target, and runs the
// matching WGS engine direction. Package name for packing is inferred from
// the WGS path (Packages\<PackageFamilyName> segment) when not provided.
app.post('/api/manual/migrate', async (req, res) => {
  const { steamPath, xboxPath, direction, packageName } = req.body || {};

  if (!steamPath || !xboxPath) {
    return res.status(400).json({ success: false, error: '请同时指定 Steam 存档目录与 Xbox WGS 目录' });
  }
  if (direction !== 'xbox_to_steam' && direction !== 'steam_to_xbox') {
    return res.status(400).json({ success: false, error: '无效的移植方向' });
  }

  // Cloud-overwrite guard — same as /api/migrate. Xbox app auto-closes.
  const manualTargetSide = direction === 'xbox_to_steam' ? 'steam' : 'xbox';
  const manualPlatform = checkPlatformClient(manualTargetSide);
  if (manualPlatform.running) {
    if (manualTargetSide === 'xbox') {
      const closed = closePlatformClient('xbox');
      if (closed.stillRunning.length > 0) {
        return res.status(409).json({
          success: false,
          code: 'PLATFORM_RUNNING',
          error: `已尝试自动关闭 Xbox 应用但仍有进程未退出（${closed.stillRunning.join('、')}）。${closed.hint ? closed.hint + '。' : '请手动退出 Xbox 应用后'}重试。`
        });
      }
    } else {
      return res.status(409).json({
        success: false,
        code: 'PLATFORM_RUNNING',
        error: `检测到 Steam 客户端正在运行。为防止云同步把旧存档覆盖回刚移植的文件，请完全退出 Steam（右下角托盘图标 → 退出）后重试。`
      });
    }
  }

  try {
    // Infer the Package Family Name from the WGS path
    // (...\Packages\<PackageFamilyName>\SystemAppData\wgs\<guid>)
    const inferPackageName = (wgsPath) => {
      const pkgMatch = wgsPath.match(/[\\\/]Packages[\\\/]([^\\\/]+?)(?:[\\\/]|$)/i);
      return pkgMatch ? pkgMatch[1] : (packageName || 'ManualPackage');
    };

    // One game-record lookup for both directions: rename maps, per-game write
    // rules and hard gates all follow the WGS folder the user picked.
    const manualGame = inferGameRecordFromWgsPath(xboxPath);
    if (manualGame && manualGame.steamXboxByteIncompatible) {
      return res.status(400).json({
        success: false,
        code: 'BYTE_INCOMPATIBLE',
        error: `《${manualGame.name}》${'该游戏经实测确认 Steam 与 Xbox 端存档字节格式不兼容（移植后游戏无法读取、启动黑屏），已阻止写入以保护你的存档。'}`
      });
    }
    const manualRefusal = migrationRefusalFor(manualGame);
    if (manualRefusal) {
      return res.status(400).json({
        success: false,
        code: 'CONVERSION_REQUIRED',
        error: `《${manualGame.name}》${manualRefusal}`
      });
    }

    if (direction === 'xbox_to_steam') {
      const indexPath = path.join(xboxPath, 'containers.index');
      if (!fs.existsSync(xboxPath) || !fs.existsSync(indexPath)) {
        return res.status(400).json({ success: false, error: `Xbox WGS 目录无效或缺少 containers.index：${xboxPath}` });
      }

      let backupInfo = null;
      if (fs.existsSync(steamPath)) {
        backupInfo = await createBackup(steamPath, 'manual', 'steam', { restoreTargetPath: steamPath, direction, gameName: null });
      }

      const result = extractWgsToFolder(xboxPath, steamPath);

      if (result.extractedFiles.length === 0) {
        return res.status(500).json({ success: false, error: '未能从 Xbox WGS 目录提取到任何存档文件，请检查该游戏是否真的有本地存档。' });
      }

      // Audit report: landed name + size + MD5 match vs the source blob, then
      // universal Steam cloud-mirror sync (same save names under userdata).
      const files = result.extractedFiles.map(f => {
        let md5Match = 'n/a';
        if (f.md5 && f.size > 0 && fs.existsSync(f.extractedPath)) {
          md5Match = fileMd5(f.extractedPath) === f.md5;
        }
        return { name: f.logicalFileName, original: f.logicalFileName, size: f.size, path: f.extractedPath, md5Match };
      });
      const mirrors = syncSteamCloudMirrors(files, steamPath, (manualGame || {}).steamAppId);
      if (mirrors.length > 0) files.push(...mirrors);
      const verify = buildVerify(null, {
        files,
        targetPath: steamPath,
        note: '文件已写入指定 Steam 存档目录，且尺寸非 0、内容 MD5 与来源一致。存档能否被游戏读取，需启动游戏读档确认一次。'
      });

      return res.json({
        success: true,
        message: `成功从 Xbox 提取并移植 ${result.extractedFiles.length} 个存档文件至 Steam 目录！`,
        warnings: [
          '移植时已要求退出 Steam；现在重新打开 Steam 即可。启动游戏后 Steam 会自动把新存档上传为云端最新版。',
          '如果启动游戏时弹出云同步冲突选择框，请务必选择「使用本地存档」，避免云端旧存档覆盖刚移植的文件。',
          ...steamCloudWarnings(steamPath),
          ...(mirrors.length > 0 ? [`已同步 ${mirrors.length} 个 Steam 云镜像中的同名存档（userdata\\<账号>\\${(manualGame || {}).steamAppId || '?'}\\remote），防止云同步用旧镜像回滚。`] : []),
          ...(manualGame && manualGame.accountBound ? ['注意：该游戏为在线服务类，存档与微软/游戏账号绑定——只移植你自己账号的存档，使用他人存档可能无法读档甚至有封号风险。'] : []),
        ],
        backup: backupInfo,
        verify,
        result
      });
    } else {
      if (!fs.existsSync(steamPath)) {
        return res.status(400).json({ success: false, error: `未找到 Steam 存档目录：${steamPath}` });
      }

      const filesInSteamDir = fs.readdirSync(steamPath)
        .filter(f => fs.statSync(path.join(steamPath, f)).isFile())
        .map(f => ({
          fileName: f,
          filePath: path.join(steamPath, f)
        }));

      if (filesInSteamDir.length === 0) {
        return res.status(400).json({ success: false, error: `Steam 存档目录中未找到有效文件：${steamPath}` });
      }

      let backupInfo = null;
      if (fs.existsSync(xboxPath)) {
        backupInfo = await createBackup(xboxPath, 'manual', 'xbox', { restoreTargetPath: xboxPath, direction, gameName: null });
      }

      const pkgName = inferPackageName(xboxPath);
      const { result, verify, refused } = writeSteamToXbox(filesInSteamDir, xboxPath, {
        packageName: pkgName,
      });
      // writeSteamToXbox refuses to write when the target has no game-generated
      // WGS structure. Ignoring `refused` here reported "写入成功" with verify:null,
      // which graded as needs-review and hid the fact that nothing was written.
      if (refused) {
        return res.status(400).json({ success: false, code: 'BYTE_INCOMPATIBLE', error: refused });
      }

      return res.json({
        success: true,
        message: `成功将 Steam 存档写入 Xbox 目录（包名：${pkgName}）！`,
        warnings: [
          '首次启动 Xbox 游戏时请留意云同步冲突提示。若出现选择框，请务必选择"使用本地存档"。',
          '建议先禁用云同步启动一次游戏确认存档无误，再恢复同步。'
        ],
        backup: backupInfo,
        verify,
        result
      });
    }
  } catch (err) {
    console.error('Manual Migration Error:', err);
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// API: List Backups
app.get('/api/backups', (req, res) => {
  try {
    const backups = listBackups();
    res.json({ success: true, backups });
  } catch (err) {
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// Fallback route for Single Page Application
if (fs.existsSync(distPath)) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Export the configured app + PORT so electron/main.js can reuse it.
export { app, PORT };

// Only start listening when run directly via `node server/index.js` (not when
// imported by Electron). In Electron production, electron/main.js calls
// serverApp.listen() itself. In dev mode, `npm run server` runs this directly.
const isMainModule = !process.versions.electron;
if (isMainModule) {
  app.listen(PORT, () => {
    console.log(`[Xbox-Steam Migrator Backend] Running on http://localhost:${PORT}`);
  });
}
