import { VerifyReport, IdentifiedInfo } from '../types';

/**
 * Grade a migration result into one of three user-visible outcomes.
 * The whole point of "显示成功但实际没生效" is that the UI said 成功 when the
 * audit report wasn't clean — so the grading is driven by verify.ok, NOT by
 * the HTTP success flag:
 *   - 'success'       verify passed and the game was confidently identified.
 *   - 'needs-review'  files landed + verify passed, but the identification was
 *                     low-confidence or the game is Category-C "识别专用"
 *                     (no verified steam↔xbox layout) — game may not read it.
 *   - 'failed'        verify failed (missing/0-byte files, MD5 mismatch, or
 *                     no blobs landed) — migration did NOT actually take effect.
 */
export type MigrationOutcome = 'success' | 'needs-review' | 'failed';

export function migrationOutcome(
  verify?: VerifyReport | null,
  identified?: IdentifiedInfo | null
): MigrationOutcome {
  if (!verify) return 'needs-review'; // no audit report (legacy) → treat conservatively
  if (!verify.ok) return 'failed';

  const lowConfidence = identified?.confidence === 'low' || identified?.confidence === 'medium';
  const identifyOnly = Boolean(identified?.identifyOnly);
  // Steam saves with no matching Xbox container did not transfer at all, and a
  // freshly rebuilt structure uses guessed container names the game may ignore.
  const partialTransfer = Boolean(verify.unusedSteamFiles && verify.unusedSteamFiles.length > 0);
  const rebuiltStructure = verify.mode === 'rebuild';
  if (lowConfidence || identifyOnly || partialTransfer || rebuiltStructure) return 'needs-review';
  return 'success';
}

/** One-line human summary for the outcome, for toast/log use. */
export function outcomeText(
  outcome: MigrationOutcome,
  gameName?: string | null,
  verify?: VerifyReport | null
): string {
  const subject = gameName ? `《${gameName}》` : '存档';
  switch (outcome) {
    case 'success':
      return `${subject}文件已写入游戏读取路径 ✓（能否真正读档，请进游戏确认一次）`;
    case 'needs-review': {
      const unused = verify?.unusedSteamFiles || [];
      if (unused.length > 0) {
        return `${subject}已写入，但有 ${unused.length} 个存档文件在对端找不到对应存档位（${unused.slice(0, 3).join('、')}${unused.length > 3 ? ' 等' : ''}），这部分进度未移植——请进游戏确认`;
      }
      if (verify?.mode === 'rebuild') {
        return `${subject}已写入，但对端此前没有存档结构，容器名只能按文件名推断，游戏可能读不到——建议先在对端游戏里存一次档再重试`;
      }
      return `${subject}文件已写入，但识别置信度低或该游戏未实测，可能无法被游戏读取——请务必进游戏读档确认`;
    }
    case 'failed':
      return `${subject}移植校验未通过，文件可能并未真正生效！请查看日志，必要时用备份恢复`;
  }
}