import { FailureContext, VerifyReport, GameItem } from '../types';
import { ApiError } from '../services/api';

/**
 * Build the failure context handed to the AI assistant.
 *
 * Two failure shapes exist in this app:
 *  1. HTTP/network failure — thrown by apiFetch as ApiError, carrying code+context.
 *  2. Silent verify failure — HTTP 200 with success:true but verify.ok === false.
 * Both funnel into one context object so the modal and the backend see the same
 * structure regardless of which path produced the failure.
 */
export function buildFailureContext(
  source: { error: unknown } | {
    verify?: VerifyReport | null;
    message?: string;
    backup?: { backupPath?: string; backupFileName?: string } | null;
  },
  opts: {
    game?: GameItem | null;
    gameName?: string | null;
    direction?: string | null;
    /** 显式传入的错误码（优先于从 ApiError 里取） */
    code?: string | null;
    stage: string;
    warnings?: string[];
  },
): FailureContext {
  const base: FailureContext = {
    stage: opts.stage,
    gameId: opts.game?.id || null,
    gameName: opts.gameName || opts.game?.name || null,
    direction: opts.direction || null,
    steamPath: opts.game?.steamSavePath || null,
    xboxPath: opts.game?.xboxWgsPath || null,
    warnings: opts.warnings || [],
    backupPath: 'backup' in source ? source.backup?.backupPath || null : null,
    backupFileName: 'backup' in source ? source.backup?.backupFileName || null : null,
  };

  // Thrown error path
  if ('error' in source) {
    const err = source.error;
    if (err instanceof ApiError) {
      return {
        ...base,
        ...(err.context || {}),
        stage: err.context?.stage || opts.stage,
        code: opts.code || err.code || err.context?.code || null,
        error: err.message,
      };
    }
    return {
      ...base,
      code: opts.code || null,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Silent verify-failure path
  return {
    ...base,
    code: opts.code || 'VERIFY_FAILED',
    error: source.message || '落盘校验未通过：写入的文件缺失、为 0 字节，或 MD5 与来源不一致',
    verify: source.verify || null,
  };
}
