import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * WGS (Windows Game Save) Binary Engine
 * Handles parsing containers.index, extracting blob files, and generating new container structures.
 */

// Utility: Read UTF-16LE string from Buffer at offset
function readUtf16LeString(buffer, offset) {
  if (offset + 4 > buffer.length) return { str: '', nextOffset: offset };
  const charLength = buffer.readInt32LE(offset);
  offset += 4;
  
  if (charLength <= 0 || offset + charLength * 2 > buffer.length) {
    return { str: '', nextOffset: offset };
  }
  
  const str = buffer.toString('utf16le', offset, offset + charLength * 2).replace(/\0/g, '');
  return { str, nextOffset: offset + charLength * 2 };
}

// Utility: Write UTF-16LE string into Buffer
function createUtf16LeBuffer(str) {
  const strBuf = Buffer.from(str, 'utf16le');
  const charCount = strBuf.length / 2;
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeInt32LE(charCount, 0);
  return Buffer.concat([lenBuf, strBuf]);
}

// Utility: Atomically copy a file via temp-file + rename so a crash mid-copy
// never leaves a half-written file at the final destination.
function atomicCopyFileSync(src, dest) {
  const tmp = dest + '.tmp.' + process.pid;
  fs.copyFileSync(src, tmp);
  fs.renameSync(tmp, dest);
}

// Utility: Compute MD5 hex digest of a file.
function fileMd5(filePath) {
  return crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex');
}

// Format UUID/GUID bytes to hex string (32 hex characters uppercase).
// Xbox WGS uses Windows "mixed-endian" GUID encoding: first 3 groups are
// little-endian, last 2 are big-endian (like the standard GUID struct).
// The on-disk container directory name is the mixed-endian hex representation.
function uuidBytesToHex(buffer, offset) {
  // Copy first: Buffer.prototype.reverse() mutates in place and subarray()
  // shares memory with the source buffer, so we must not touch the caller's data.
  const b = Buffer.from(buffer.subarray(offset, offset + 16));
  // Windows GUID mixed-endian: first 3 groups little-endian, last 8 bytes big-endian.
  // This matches the on-disk container directory name that Xbox creates.
  const hex =
    b.subarray(0, 4).reverse().toString('hex') +  // DWORD reversed
    b.subarray(4, 6).reverse().toString('hex') +  // WORD reversed
    b.subarray(6, 8).reverse().toString('hex') +  // WORD reversed
    b.subarray(8, 16).toString('hex');             // 8 bytes as-is
  return hex.toUpperCase();
}

// Convert a 32-hex GUID string to a 16-byte Buffer in mixed-endian layout
// (inverse of uuidBytesToHex), matching what Xbox writes to disk.
function hexToUuidBuffer(hexStr) {
  const cleanHex = hexStr.replace(/-/g, '').padStart(32, '0');
  const b = Buffer.from(cleanHex, 'hex');
  const out = Buffer.alloc(16);
  // Reverse the first 3 groups to produce mixed-endian on-disk bytes
  b.subarray(0, 4).reverse().copy(out, 0);
  b.subarray(4, 6).reverse().copy(out, 4);
  b.subarray(6, 8).reverse().copy(out, 6);
  b.subarray(8, 16).copy(out, 8);
  return out;
}

/**
 * Parses a `containers.index` file from Xbox WGS folder.
 * Supports both v4 (our own packed format) and v14 (real Xbox-generated format).
 * @param {string} indexPath Path to `containers.index`
 */
export function parseContainersIndex(indexPath) {
  const detailed = parseContainersIndexDetailed(indexPath);
  return {
    formatVersion: detailed.formatVersion,
    containerCount: detailed.containers.length,
    mainPackageName: detailed.mainPackageName,
    containers: detailed.containers.map(c => ({
      containerName: c.containerName,
      cloudName: c.cloudName,
      seqIndex: c.seqIndex,
      guidHex: c.guidHex,
      filetime: c.filetime,
      size: c.size,
    })),
  };
}

/**
 * Same walk as parseContainersIndex, but also reports each entry's byte
 * offsets. Rewriting the index from parsed values is impossible without loss
 * (the guidStr block, meta token, per-entry leading int64 and the size field's
 * high bytes are all discarded), so an in-place update must patch the original
 * bytes at these offsets instead of regenerating the file.
 * @returns {{ formatVersion: number, mainPackageName: string, buffer: Buffer,
 *             containers: Array<object> }}
 */
export function parseContainersIndexDetailed(indexPath) {
  if (!fs.existsSync(indexPath)) {
    throw new Error(`containers.index file not found: ${indexPath}`);
  }

  const buf = fs.readFileSync(indexPath);
  let offset = 0;

  if (buf.length < 8) {
    throw new Error('containers.index file too small');
  }

  const formatVersion = buf.readInt32LE(offset);
  offset += 4;
  const containerCount = buf.readInt32LE(offset);
  offset += 4;

  const containers = [];

  // v14 format has an extra 4-byte unknown field before the package name string.
  if (formatVersion >= 14) {
    offset += 4; // skip unknown header field
  }

  // Metadata block: package name string (length-prefixed UTF-16LE)
  let mainPackageName = '';
  if (offset < buf.length) {
    const pkgResult = readUtf16LeString(buf, offset);
    mainPackageName = pkgResult.str;
    offset = pkgResult.nextOffset;
  }

  for (let i = 0; i < containerCount && offset < buf.length; i++) {
    try {
      const entryStart = offset;
      let containerName = '';
      let cloudName = '';
      let seqIndex = 0;
      let guidHex = '';
      let filetime = 0n;
      let size = 0;
      let seqOffset = -1;
      let guidOffset = -1;
      let filetimeOffset = -1;
      let sizeOffset = -1;

      if (formatVersion >= 14) {
        // v14 container entry layout (reverse-engineered from real Xbox data).
        // Every entry starts with an 8-byte field (FILETIME for the first entry,
        // an opaque int64 for subsequent ones), then optionally a guidStr block
        // that ONLY the first entry carries:
        //   type(4 bytes, value 3) + guidStrLen(4) + guidStr(UTF-16 "xxx-...-xxx")
        //   + unknown(4) + zeroish(4)
        // Entries 2+ skip straight to nameStrLen. We detect the guidStr block by
        // peeking: type (2 or 3) AND the following int32 being a plausible GUID
        // length (32–40 chars), which a real nameStrLen can never be for these
        // files. Real games differ on the type value (Silksong uses 3, Little
        // Nightmares uses 2), so accept both and validate the GUID string shape.
        // The rest is uniform for all entries:
        //   nameStrLen(4) + nameStr(UTF-16) + cloudStrLen(4) + cloudStr(UTF-16)
        //   + metaStrLen(4) + metaStr(UTF-16, e.g. "\"0x8DEF...\"")
        //   + seq(4) + pad(1) + rawGUID(16 mixed-endian) + filetime(8) + size(8)
        // The rawGUID (NOT the guidStr) maps to the container directory name.
        offset += 8; // leading field
        const maybeType = buf.readInt32LE(offset);
        if (maybeType === 2 || maybeType === 3) {
          const maybeGuidLen = buf.readInt32LE(offset + 4);
          if (maybeGuidLen >= 32 && maybeGuidLen <= 40) {
            const guidStrRes = readUtf16LeString(buf, offset + 4);
            const guidStr = guidStrRes.str;
            // Only a real dashed GUID should look like this; a plain short
            // container name would fail this shape check and be treated as nameStrLen.
            if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(guidStr)) {
              offset = guidStrRes.nextOffset;
              offset += 4; // unknown
              offset += 4; // zero field
            }
          }
        }
        const nameRes = readUtf16LeString(buf, offset);
        containerName = nameRes.str;
        offset = nameRes.nextOffset;
        const cloudRes = readUtf16LeString(buf, offset);
        cloudName = cloudRes.str;
        offset = cloudRes.nextOffset;
        const metaRes = readUtf16LeString(buf, offset);
        offset = metaRes.nextOffset;
        if (offset + 8 > buf.length) break;
        seqOffset = offset;
        seqIndex = buf.readInt32LE(offset); offset += 4;
        offset += 1; // pad byte
        if (offset + 16 > buf.length) break;
        guidOffset = offset;
        guidHex = uuidBytesToHex(buf, offset);
        offset += 16;
        if (offset + 16 <= buf.length) {
          filetimeOffset = offset;
          sizeOffset = offset + 8;
          filetime = buf.readBigInt64LE(offset);
          size = buf.readInt32LE(offset + 8);
          offset += 16;
        }
      } else {
        // v4 (our own packed format): name + cloud + 1-byte seq + GUID(16) + filetime(8)+size(4)
        const nameRes = readUtf16LeString(buf, offset);
        containerName = nameRes.str;
        offset = nameRes.nextOffset;
        if (!containerName) break;
        const cloudRes = readUtf16LeString(buf, offset);
        cloudName = cloudRes.str;
        offset = cloudRes.nextOffset;
        seqOffset = offset;
        seqIndex = buf.readUInt8(offset);
        offset += 1;
        if (offset + 16 > buf.length) break;
        guidOffset = offset;
        guidHex = uuidBytesToHex(buf, offset);
        offset += 16;
        if (offset + 16 <= buf.length) {
          filetimeOffset = offset;
          sizeOffset = offset + 8;
          filetime = buf.readBigInt64LE(offset);
          size = buf.readInt32LE(offset + 8);
          offset += 16;
        }
      }

      containers.push({
        containerName,
        cloudName,
        seqIndex,
        guidHex,
        filetime: filetime.toString(),
        size,
        entryStart,
        entryEnd: offset,
        seqOffset,
        guidOffset,
        filetimeOffset,
        sizeOffset,
      });
    } catch (err) {
      console.warn(`Error parsing container entry ${i}:`, err.message);
      break;
    }
  }

  return {
    formatVersion,
    containerCount: containers.length,
    mainPackageName,
    buffer: buf,
    containers,
  };
}

/**
 * Parses individual container manifest (e.g. `container.1` or `container.4`).
 * Supports two formats:
 *  - v4 compact (our own packed format): header(8) + per-file name(UTF-16LE
 *    length-prefixed) + blobGUID(16)
 *  - v14 fixed-width (real Xbox): header(8) + per-file entry of 160 bytes:
 *    name(128 bytes, UTF-16LE null-padded) + blobGUID(16 mixed-endian) + 16
 *    bytes padding/timestamps. The blobGUID maps to the blob file on disk.
 * @param {string} containerFolderPath Path to the GUID folder inside `wgs/`
 */
export function parseContainerFolderFiles(containerFolderPath) {
  if (!fs.existsSync(containerFolderPath)) {
    return [];
  }

  const entries = fs.readdirSync(containerFolderPath);
  // Find container manifest file (container.1, container.4, etc.)
  const manifestFile = entries.find(e => /^container\.\d+$/.test(e));

  if (!manifestFile) {
    // If no manifest file found, list blobs directly
    const blobFiles = entries.filter(f => /^[0-9A-Fa-f]{32}$/.test(f));
    return blobFiles.map((b, idx) => ({
      logicalFileName: `blob_${idx}.sav`,
      blobGuid: b.toUpperCase(),
      blobPath: path.join(containerFolderPath, b)
    }));
  }

  const manifestPath = path.join(containerFolderPath, manifestFile);
  const buf = fs.readFileSync(manifestPath);
  if (buf.length < 8) return [];

  const version = buf.readInt32LE(0);
  const fileCount = buf.readInt32LE(4);
  let offset = 8;

  const mappedFiles = [];

  // Real Xbox container.4 manifests are version 4 but use 160-byte fixed-width
  // entries, while our own packer's compact format is also version 4 with
  // length-prefixed string names. Distinguish by total size:
  // fixed-width ⟺ (buf.length - 8) === fileCount * 160.
  const fixedWidth = fileCount > 0 && (buf.length - 8) === fileCount * 160;

  if (fixedWidth) {
    // fixed-width 160-byte entries: name(128B UTF-16LE null-padded) + blobGUID(16 mixed-endian) + 16B tail
    const ENTRY_SIZE = 160;
    for (let i = 0; i < fileCount && offset + ENTRY_SIZE <= buf.length; i++) {
      // Read name: UTF-16LE until null or end of 128-byte name field
      let name = '';
      const nameEnd = offset + 128;
      for (let o = offset; o < nameEnd; o += 2) {
        if (o + 1 >= buf.length) break;
        const ch = buf.readUInt16LE(o);
        if (ch === 0) break;
        name += String.fromCharCode(ch);
      }
      // blobGUID at offset + 128 (16 bytes, mixed-endian). Some games (e.g.
      // Little Nightmares) store the actual blob GUID at offset + 144 instead;
      // both fields are identical in most games, so pick whichever of the two
      // candidate GUIDs actually exists as a blob file on disk.
      const blobGuid128 = uuidBytesToHex(buf, offset + 128);
      const blobGuid144 = uuidBytesToHex(buf, offset + 144);
      const blobGuid =
        fs.existsSync(path.join(containerFolderPath, blobGuid144))
          ? blobGuid144
          : blobGuid128;
      const blobPath = path.join(containerFolderPath, blobGuid);

      mappedFiles.push({
        logicalFileName: name || `file_${i}.dat`,
        blobGuid,
        blobPath: fs.existsSync(blobPath) ? blobPath : null
      });
      offset += ENTRY_SIZE;
    }
  } else {
    // v4: compact format — per-file: name(UTF-16LE length-prefixed) + blobGUID(16)
    for (let i = 0; i < fileCount && offset < buf.length; i++) {
      const fileNameRes = readUtf16LeString(buf, offset);
      const logicalFileName = fileNameRes.str;
      offset = fileNameRes.nextOffset;

      if (offset + 16 > buf.length) break;
      const blobGuid = uuidBytesToHex(buf, offset);
      offset += 16;

      const blobPath = path.join(containerFolderPath, blobGuid);
      mappedFiles.push({
        logicalFileName: logicalFileName || `file_${i}.dat`,
        blobGuid,
        blobPath: fs.existsSync(blobPath) ? blobPath : null
      });
    }
  }

  return mappedFiles;
}

/**
 * Extract Xbox WGS saves to a target directory with standard file structure.
 * @param {string} wgsFolderPath Full path to `%LOCALAPPDATA%\Packages\...\wgs\<XUID_GUID>\`
 * @param {string} targetOutputDir Directory where extracted Steam-compatible files will be placed
 */
export function extractWgsToFolder(wgsFolderPath, targetOutputDir) {
  const indexPath = path.join(wgsFolderPath, 'containers.index');
  if (!fs.existsSync(indexPath)) {
    throw new Error('containers.index not found in WGS folder');
  }

  const parsedIndex = parseContainersIndex(indexPath);
  const extractedFiles = [];
  const usedNames = new Set();

  if (!fs.existsSync(targetOutputDir)) {
    fs.mkdirSync(targetOutputDir, { recursive: true });
  }

  for (const container of parsedIndex.containers) {
    const containerFolderPath = path.join(wgsFolderPath, container.guidHex);
    if (!fs.existsSync(containerFolderPath)) continue;

    const mappedFiles = parseContainerFolderFiles(containerFolderPath);
    for (const fileMap of mappedFiles) {
      if (fileMap.blobPath && fs.existsSync(fileMap.blobPath)) {
        // Output file location. Several games give every container's blob the
        // same logical name (e.g. "Data"), which would collide and overwrite.
        // Qualify with the container name only on collision to stay unambiguous.
        let destFileName = fileMap.logicalFileName || `${container.containerName}.sav`;
        if (usedNames.has(destFileName)) {
          destFileName = `${container.containerName}_${destFileName}`;
        }
        usedNames.add(destFileName);
        const destPath = path.join(targetOutputDir, destFileName);
        
        // Atomic write: temp file → rename (crash-safe).
        atomicCopyFileSync(fileMap.blobPath, destPath);
        extractedFiles.push({
          containerName: container.containerName,
          logicalFileName: destFileName,
          size: fs.statSync(destPath).size,
          extractedPath: destPath,
          md5: fileMd5(fileMap.blobPath)
        });
      }
    }
  }

  return {
    totalContainers: parsedIndex.containers.length,
    extractedFiles,
    targetOutputDir
  };
}

/**
 * Steam-side versioned history files (user1_1.0.30000.dat) are the game's own
 * rolling backups, not independent slots. The Xbox side has no such containers,
 * so they can never transfer — listing them as "进度未移植" alarmed users over
 * nothing. Treated separately from genuinely unmatched saves.
 */
const VERSION_SUFFIX_RE = /^(.+?)_\d+(?:\.\d+)*(\.[^.]+)$/;

/**
 * Resolve which Steam file should replace an Xbox container's logical file.
 *
 * Deliberately NAME-DERIVED ONLY — this is the universal matching contract:
 *   1) exact same name on both sides (the game itself uses this name on both
 *      platforms, so the content correspondence is the game's own design), or
 *   2) a version-qualified Xbox slot (user1_1.0.30000.dat) fed by the bare
 *      current save (user1.dat) — derived from the game's own naming scheme.
 * No human-entered cross-name mappings (sharedData.dat ↔ shared.dat etc.):
 * inventing correspondences between DIFFERENT names is what wrote Steam bytes
 * into Silksong's sharedData container and black-screened the game. A slot
 * with no name-derived source is simply left untouched and reported.
 *
 * @param {string} xboxLogicalName e.g. "sharedData.dat"
 * @param {Map<string, {fileName: string, filePath: string}>} sources by lowercase name
 * @param {Map<string, {fileName: string, filePath: string}>} sourcesByCore
 *   steam files indexed by "core name" — the filename without extension and
 *   without a leading platform id (1483014080_LNEESaveSlot1.sav → lneesaveslot1).
 *   Used for the slot-name channel below.
 */
function findSourceForLogicalName(xboxLogicalName, sources, sourcesByCore) {
  const lower = String(xboxLogicalName || '').toLowerCase();
  if (!lower) return null;

  // 1) Same name on both sides — the common case.
  if (sources.has(lower)) return sources.get(lower);

  // 2) Version-suffixed Xbox slot fed by the bare Steam save. Applies to
  //    rollback/restore containers too: the game keeps those slots in sync
  //    with the live save, so the migrated save must land there as well.
  const m = VERSION_SUFFIX_RE.exec(lower);
  if (m) {
    const bare = m[1] + m[2];
    if (sources.has(bare)) return sources.get(bare);
  }

  // 3) Slot-name channel: some games (Little Nightmares) put the slot identity
  //    in the CONTAINER name while every blob inside is generically named
  //    "Data". Match the container name against the core (extension + leading
  //    platform-id stripped) form of a Steam filename — still a name-derived
  //    correspondence, no invented mappings.
  const core = lower.replace(/\.[^.]+$/, '').replace(/^\d+_/, '');
  if (core && sourcesByCore && sourcesByCore.has(core)) return sourcesByCore.get(core);
  return null;
}

/**
 * Steam -> Xbox migration that PRESERVES the target's existing WGS structure.
 *
 * The previous approach deleted every container directory and rebuilt them from
 * Steam file names. That silently produced containers the game never asked for:
 * Silksong stores its save in a container literally named `save1` holding
 * `user1.dat`, but rebuilding from the Steam file produced a container named
 * `user1`. The bytes landed, every check passed, and the game still saw no save.
 *
 * Here the target's real containers, container GUIDs, blob GUIDs, cloud names,
 * manifests and entry layout are all left alone; only the blob bytes of matched
 * logical files are replaced, plus the FILETIME stamps the cloud compares.
 * The index's `size` and `seq` fields are deliberately NOT touched: real Xbox
 * writes 0/1 in `size` (it is not a byte count) and `seq` is constant per game
 * (257 for Silksong, 260 for Little Nightmares), so both look like format flags
 * rather than counters, and inventing values there risks a cloud conflict.
 *
 * UNIVERSAL SLOT MATCHING (no per-game config): a blob is written iff its
 * logical file name resolves to a Steam file — exact name, or a version-suffix
 * slot fed by the bare save. Matching applies to EVERY container, rollback
 * containers included: the game keeps those copies in sync with the live save,
 * so the migrated save must land there too (tutorial-verified on Silksong).
 * Slots with no name-derived source — a game's shared/settings containers, a
 * rollback container's other slots — are never touched, which is precisely the
 * rule that keeps Silksong's sharedData pristine without any game-specific
 * configuration.
 *
 * @param {Array<{fileName: string, filePath: string}>} inputFiles Steam-side saves
 * @param {string} targetWgsFolderPath Existing `wgs/<XUID_GUID>/` directory
 * @param {{ dryRun?: boolean }} [options] dryRun runs the EXACT same matching
 *   and returns the same report, but writes nothing (no blob copy, no mtime
 *   touches, no index patch). Used by the portability test / preview UI.
 */
export function updateWgsInPlace(inputFiles, targetWgsFolderPath, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const indexPath = path.join(targetWgsFolderPath, 'containers.index');
  const parsed = parseContainersIndexDetailed(indexPath);
  if (parsed.containers.length === 0) {
    throw new Error('目标 containers.index 未解析出任何容器，无法执行结构保留式更新');
  }

  // Platform bookkeeping and editor backups are not saves.
  const JUNK_SOURCE_RE = /\.(bak\d*|tmp|old)$|^(steam_autocloud|remotecache|sharedconfig)\.vdf$/i;
  const sources = new Map();
  const sourcesByCore = new Map();
  for (const f of inputFiles) {
    if (!f || !f.fileName || !f.filePath) continue;
    if (JUNK_SOURCE_RE.test(f.fileName)) continue;
    if (!fs.existsSync(f.filePath)) continue;
    const lower = f.fileName.toLowerCase();
    sources.set(lower, f);
    // Core form: filename without extension, without a leading platform id
    // (1483014080_LNEESaveSlot1.sav → lneesaveslot1). The container-slot
    // matching channel resolves against this.
    const core = lower.replace(/\.[^.]+$/, '').replace(/^\d+_/, '');
    if (core && !sourcesByCore.has(core)) sourcesByCore.set(core, f);
  }

  const now = new Date();
  const filetime = BigInt(now.getTime()) * 10000n + 116444736000000000n;
  const patched = Buffer.from(parsed.buffer); // copy; patch only known offsets

  const usedSources = new Set();
  const updated = [];
  const skippedContainers = [];

  for (const container of parsed.containers) {
    const dir = path.join(targetWgsFolderPath, container.guidHex);
    if (!fs.existsSync(dir)) {
      skippedContainers.push({ container: container.containerName, reason: '容器目录不存在（索引与磁盘不一致）' });
      continue;
    }

    const mapped = parseContainerFolderFiles(dir);
    let touched = false;
    for (const m of mapped) {
      if (!m.blobPath) continue; // manifest points at a missing blob
      // Logical-name first; when a game stores every blob under a generic
      // logical name ("Data") but names the slot by CONTAINER (Little
      // Nightmares), fall back to the container name as the slot identity.
      let src = findSourceForLogicalName(m.logicalFileName, sources, sourcesByCore);
      if (!src) src = findSourceForLogicalName(container.containerName, sources, sourcesByCore);
      if (!src) continue;
      if (!dryRun) {
        atomicCopyFileSync(src.filePath, m.blobPath);
        try { fs.utimesSync(m.blobPath, now, now); } catch {}
      }
      usedSources.add(src.fileName.toLowerCase());
      updated.push({
        container: container.containerName,
        logicalFileName: m.logicalFileName,
        sourceFileName: src.fileName,
        blobPath: m.blobPath,
        // dryRun reports the SOURCE size/md5 (nothing is written yet); a real
        // write reports the on-disk blob that the copy just produced.
        size: dryRun ? fs.statSync(src.filePath).size : (fs.existsSync(m.blobPath) ? fs.statSync(m.blobPath).size : 0),
        srcMd5: fileMd5(src.filePath),
      });
      touched = true;
    }

    if (touched && !dryRun) {
      // H-03: refresh the FILETIME the cloud compares, plus manifest/dir mtimes.
      if (container.filetimeOffset >= 0) {
        patched.writeBigInt64LE(filetime, container.filetimeOffset);
      }
      try {
        const manifest = fs.readdirSync(dir).find(e => /^container\.\d+$/i.test(e));
        if (manifest) fs.utimesSync(path.join(dir, manifest), now, now);
      } catch {}
      try { fs.utimesSync(dir, now, now); } catch {}
    } else if (touched === false) {
      skippedContainers.push({
        container: container.containerName,
        logicalFiles: mapped.map(m => m.logicalFileName),
        reason: '未找到可对应的 Steam 存档文件',
      });
    }
  }

  // Write the patched index atomically so a crash can't truncate it.
  // dryRun leaves the target untouched entirely.
  if (!dryRun) {
    const tmpIndex = indexPath + '.tmp.' + process.pid;
    fs.writeFileSync(tmpIndex, patched);
    fs.renameSync(tmpIndex, indexPath);
    try { fs.utimesSync(indexPath, now, now); } catch {}
  }

  // Split leftovers: version-suffixed history backups are expected to have no
  // Xbox slot (informational); anything else genuinely didn't transfer.
  const unusedSteamFiles = [];
  const historyBackups = [];
  for (const s of sources.values()) {
    if (usedSources.has(s.fileName.toLowerCase())) continue;
    if (VERSION_SUFFIX_RE.test(s.fileName)) historyBackups.push(s.fileName);
    else unusedSteamFiles.push(s.fileName);
  }

  return {
    mode: dryRun ? 'dry-run' : 'in-place',
    targetWgsFolderPath,
    containersCount: parsed.containers.length,
    updated,
    skippedContainers,
    unusedSteamFiles,
    historyBackups,
  };
}

/**
 * Read-only portability preview: identical matching to a real write, zero
 * side effects. Returns the same report shape (mode: 'dry-run').
 */
export function previewWgsUpdate(inputFiles, targetWgsFolderPath) {
  return updateWgsInPlace(inputFiles, targetWgsFolderPath, { dryRun: true });
}

/**
 * True when the target already carries a readable WGS structure that should be
 * updated in place rather than rebuilt from scratch.
 */
export function hasExistingWgsStructure(targetWgsFolderPath) {
  try {
    const indexPath = path.join(targetWgsFolderPath, 'containers.index');
    if (!fs.existsSync(indexPath) || fs.statSync(indexPath).size <= 16) return false;
    const parsed = parseContainersIndexDetailed(indexPath);
    return parsed.containers.some(c => fs.existsSync(path.join(targetWgsFolderPath, c.guidHex)));
  } catch {
    return false;
  }
}

/**
 * Pack save files into Xbox WGS format from scratch (containers, blobs,
 * container.4, containers.index). Used only when the target has no existing
 * structure to preserve — see updateWgsInPlace for the normal path.
 * Emits the same v14 layout a real Xbox/PC-Game-Pass game writes, so the game can read it back:
 *  - container folder per GUID (mixed-endian), blob file per GUID inside it
 *  - container.4 manifest with fixed-width 160-byte entries (name(128B) + blobGUID(16B) + dupGUID(16B))
 *  - containers.index v14 with the first entry carrying the guidStr block
 * @param {Array<{fileName: string, filePath: string}>} inputFiles List of save files to pack
 * @param {string} targetWgsFolderPath Path to the Xbox `wgs/<XUID_GUID>/` target directory
 * @param {string} packageName Package Family Name
 */
export function packFolderToWgs(inputFiles, targetWgsFolderPath, packageName = 'GamePassSave') {
  if (!fs.existsSync(targetWgsFolderPath)) {
    fs.mkdirSync(targetWgsFolderPath, { recursive: true });
  }

  // Reuse existing container GUIDs per container name so cloud sync doesn't see
  // a brand-new container on every pack. Preserves the same directory GUIDs.
  const existingGuids = new Map();
  const indexPath = path.join(targetWgsFolderPath, 'containers.index');
  if (fs.existsSync(indexPath)) {
    try {
      const parsed = parseContainersIndex(indexPath);
      for (const c of parsed.containers) existingGuids.set(c.containerName, c.guidHex);
    } catch (err) {
      console.warn('Failed to read existing containers.index for GUID reuse:', err.message);
    }
  }

  // Clean up old container directories (32-hex GUID folders) to prevent orphan
  // containers from accumulating across repeated packs. Preserves containers.index.
  try {
    for (const entry of fs.readdirSync(targetWgsFolderPath)) {
      if (/^[0-9A-Fa-f]{32}$/.test(entry)) {
        const oldDir = path.join(targetWgsFolderPath, entry);
        if (fs.statSync(oldDir).isDirectory()) {
          fs.rmSync(oldDir, { recursive: true, force: true });
        }
      }
    }
  } catch (err) {
    console.warn('Failed to clean old container dirs:', err.message);
  }

  const containers = [];
  const now = new Date();
  // Windows FILETIME: 100-nanosecond intervals since 1601-01-01 UTC
  const filetime = BigInt(now.getTime()) * 10000n + 116444736000000000n;

  for (const file of inputFiles) {
    if (!fs.existsSync(file.filePath)) continue;

    const containerName = file.fileName.replace(/\.[^/.]+$/, ""); // strip extension for container name

    // Reuse the container GUID when one already exists for this name.
    let containerGuidBytes;
    if (existingGuids.has(containerName)) {
      containerGuidBytes = hexToUuidBuffer(existingGuids.get(containerName));
    } else {
      containerGuidBytes = crypto.randomBytes(16);
    }
    const containerGuid = uuidBytesToHex(containerGuidBytes, 0); // mixed-endian dir name
    const blobGuidBytes = crypto.randomBytes(16);
    const blobGuid = uuidBytesToHex(blobGuidBytes, 0);

    const containerDir = path.join(targetWgsFolderPath, containerGuid);
    fs.mkdirSync(containerDir, { recursive: true });

    // Copy raw save file bytes to blob GUID file — atomic crash-safe write.
    const blobPath = path.join(containerDir, blobGuid);
    atomicCopyFileSync(file.filePath, blobPath);

    // container.4 manifest — real Xbox fixed-width layout:
    // header(8: version=4 + file count) + per-file 160B entry:
    // name(128B UTF-16LE null-padded) + blobGUID(16 raw bytes) + dupGUID(16 raw bytes)
    const containerManifestPath = path.join(containerDir, 'container.4');
    const headerBuf = Buffer.alloc(8);
    headerBuf.writeInt32LE(4, 0); // manifest version
    headerBuf.writeInt32LE(1, 4); // file count = 1

    const nameField = Buffer.alloc(128); // UTF-16LE, null-padded to 128B
    const nameBytes = Buffer.from(file.fileName, 'utf16le');
    nameBytes.copy(nameField, 0, 0, Math.min(nameBytes.length, 128));

    // blobGUID written as raw bytes so uuidBytesToHex reproduces the blob file name.
    const containerManifestBuf = Buffer.concat([headerBuf, nameField, blobGuidBytes, blobGuidBytes]);
    const manifestTmp = containerManifestPath + '.tmp.' + process.pid;
    fs.writeFileSync(manifestTmp, containerManifestBuf);
    fs.renameSync(manifestTmp, containerManifestPath);

    // H-03: Four-way timestamp sync — blob, container.4, container folder, containers.index
    // must all share the same LastWriteTimeUtc so Xbox cloud doesn't see a stale local copy.
    fs.utimesSync(blobPath, now, now);
    fs.utimesSync(containerManifestPath, now, now);
    fs.utimesSync(containerDir, now, now);

    const fileSize = fs.statSync(file.filePath).size;

    containers.push({
      containerName,
      cloudName: file.fileName,
      guidHex: containerGuid,
      guidBytes: containerGuidBytes, // raw bytes for writing to containers.index
      size: fileSize,
      seqIndex: 260,
      blobPath // for verify: the actual blob file written
    });
  }

  // Generate containers.index (v14 layout to match real Xbox output)
  const indexHeaderBuf = Buffer.alloc(12);
  indexHeaderBuf.writeInt32LE(14, 0); // format version
  indexHeaderBuf.writeInt32LE(containers.length, 4);
  indexHeaderBuf.writeInt32LE(0, 8); // unknown header field

  const pkgBuf = createUtf16LeBuffer(packageName);

  const containerBufs = [];
  for (let i = 0; i < containers.length; i++) {
    const c = containers[i];
    const parts = [];

    // Every entry starts with an 8-byte leading field.
    const leadBuf = Buffer.alloc(8);
    leadBuf.writeBigInt64LE(filetime, 0);
    parts.push(leadBuf);

    // Only the FIRST entry carries the guidStr block (type=3 + guidStr + flags + zero),
    // mirroring what real Xbox writes. Subsequent entries go straight to nameStrLen.
    if (i === 0) {
      const typeBuf = Buffer.alloc(4);
      typeBuf.writeInt32LE(3, 0);
      const syncGuid = uuidBytesToHex(crypto.randomBytes(16), 0).toLowerCase();
      const dashed = `${syncGuid.slice(0, 8)}-${syncGuid.slice(8, 12)}-${syncGuid.slice(12, 16)}-${syncGuid.slice(16, 20)}-${syncGuid.slice(20)}`;
      const guidStrBuf = createUtf16LeBuffer(dashed);
      const flagsBuf = Buffer.alloc(4);
      flagsBuf.writeInt32LE(268435456, 0);
      const zeroBuf = Buffer.alloc(4);
      parts.push(typeBuf, guidStrBuf, flagsBuf, zeroBuf);
    }

    parts.push(createUtf16LeBuffer(c.containerName));
    parts.push(createUtf16LeBuffer(c.cloudName));
    parts.push(createUtf16LeBuffer('"0x0"')); // meta token
    const seqBuf = Buffer.alloc(4);
    seqBuf.writeInt32LE(c.seqIndex, 0);
    parts.push(seqBuf);
    parts.push(Buffer.alloc(1)); // pad byte
    parts.push(c.guidBytes); // raw GUID bytes → mixed-endian dir name

    const tailBuf = Buffer.alloc(16);
    tailBuf.writeBigInt64LE(filetime, 0); // FILETIME
    tailBuf.writeInt32LE(c.size, 8);
    parts.push(tailBuf);

    containerBufs.push(Buffer.concat(parts));
  }

  const finalIndexBuf = Buffer.concat([indexHeaderBuf, pkgBuf, ...containerBufs]);
  fs.writeFileSync(indexPath, finalIndexBuf);
  // H-03: sync containers.index timestamp too
  fs.utimesSync(indexPath, now, now);

  return {
    containersCount: containers.length,
    targetWgsFolderPath,
    blobs: containers.map(c => ({ name: c.cloudName, blobPath: c.blobPath, size: c.size }))
  };
}
