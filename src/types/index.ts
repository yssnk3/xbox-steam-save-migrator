export interface GameItem {
  id: string;
  name: string;
  steamAppId: string;
  steamSaveRelPath: string;
  xboxPackageName: string;
  category: 'A' | 'B' | 'C';
  saveFilePattern: string;
  iconUrl?: string;
  notes?: string;
  processNames?: string[];
  isSteamDetected: boolean;
  steamSavePath: string;
  steamLastModified: string | null;
  steamSaveSize: number;
  steamFileCount: number;
  isXboxDetected: boolean;
  xboxWgsPath: string;
  xboxPackageFolder: string | null;
  xboxLastModified: string | null;
  xboxSaveSize: number;
  canSync: boolean;
  /** Per-game steam filename normalization (backend-only extras, optional). */
  steamFileRenameMap?: Record<string, string>;
  steamStripVersionSuffix?: boolean;
  /** Confidence of the resolved Steam save path: 'exact' or 'wildcard'. */
  steamPathConfidence?: string;
}

/** Post-migration "what actually landed where" audit report. */
export interface VerifyReport {
  ok: boolean;
  targetPath: string;
  note: string;
  files?: {
    name: string;
    original: string;
    size: number;
    path: string;
    /** true = on-disk MD5 matches source blob; false = mismatch; 'n/a' = no source hash to compare. */
    md5Match?: boolean | 'n/a';
  }[];
  containers?: number;
  indexExists?: boolean;
  blobs?: {
    name: string;
    /** Steam-side file whose bytes were written into this slot. */
    source?: string;
    exists: boolean;
    sizeOk: boolean;
    md5Match?: boolean | 'n/a';
    blobPath?: string;
  }[];
  /** 'in-place' preserved the game's own container structure; 'rebuild' created it. */
  mode?: 'in-place' | 'rebuild';
  /** Xbox containers deliberately not written (game backups, or no matching Steam file). */
  skippedContainers?: { container: string; reason: string; logicalFiles?: string[] }[];
  /** Steam saves with no matching slot in the Xbox structure — their progress did NOT transfer. */
  unusedSteamFiles?: string[];
  /** Version-suffixed rolling backups (user1_1.0.30000.dat) — no Xbox slot exists and none is needed. */
  historyBackups?: string[];
}

/** Identification info attached to an identify-and-migrate result. */
export interface IdentifiedInfo {
  side?: string;
  gameId?: string | null;
  name?: string | null;
  confidence?: 'high' | 'medium' | 'low' | null;
  /** Category-C "识别专用" games have no verified steam↔xbox layout. */
  identifyOnly?: boolean;
  /** Measured byte-incompatible across platforms — Steam→Xbox writing is blocked server-side. */
  byteIncompatible?: boolean;
  /** Direct transfer impossible — an external conversion tool is required (Palworld). */
  needsConversionTool?: boolean | string | null;
  /** Online-service games bind progress to the account — only migrate your own saves. */
  accountBound?: boolean;
}

export interface BackupItem {
  fileName: string;
  filePath: string;
  size: number;
  createdAt: string;
}

/** Read-only portability prediction for one direction (dry-run, no writes). */
export interface DirectionPortability {
  direction: 'steam_to_xbox' | 'xbox_to_steam';
  verdict: 'ok' | 'partial' | 'refused' | 'needs-launch' | 'no-source' | 'empty' | 'error' | 'unknown';
  reasons: string[];
  willWrite?: { slot: string; source: string; size: number }[];
  unusedSteamFiles?: string[];
  skippedContainers?: { container: string; reason: string }[];
  historyBackups?: string[];
  targetContainers?: number | null;
  files?: { name: string; original?: string; container?: string; size: number; exists: boolean; sizeOk: boolean }[];
  mirrors?: string[];
}

export interface PortabilityReport {
  game: { id: string; name: string; category?: string; needsConversionTool?: string | null; accountBound?: boolean; identifyOnly?: boolean };
  steamPath?: string | null;
  xboxPath?: string | null;
  steamToXbox: DirectionPortability;
  xboxToSteam: DirectionPortability;
  note?: string;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
}
