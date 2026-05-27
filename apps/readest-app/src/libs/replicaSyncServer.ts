import { hlcParse } from '@/libs/crdt';
import { isAllowedKind, validateRow } from '@/libs/replicaSchemas';
import type { Hlc, ReplicaRow } from '@/types/replica';
import type { SyncErrorCode } from '@/libs/errors';

export const HLC_SKEW_TOLERANCE_MS = 60_000;
export const MAX_PUSH_BATCH = 100;
// Cap the batched-pull cursor list. Today there are 5 kinds; this leaves
// generous headroom for future replica kinds while keeping the request
// body bounded so a malicious caller can't burn server time on
// pathological queries.
export const MAX_PULL_BATCH = 50;

export interface PushReplicasBody {
  rows: ReplicaRow[];
}

export type PushValidation =
  | { ok: true; rows: ReplicaRow[] }
  | { ok: false; status: number; code: SyncErrorCode; message: string; offendingIndex?: number };

export const clampHlcSkew = (hlc: Hlc, nowMs: number): boolean => {
  const { physicalMs } = hlcParse(hlc);
  return Math.abs(physicalMs - nowMs) <= HLC_SKEW_TOLERANCE_MS;
};

export const validatePushBatch = (body: unknown, userId: string, nowMs: number): PushValidation => {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, status: 400, code: 'VALIDATION', message: 'body must be an object' };
  }
  const rows = (body as PushReplicasBody).rows;
  if (!Array.isArray(rows)) {
    return { ok: false, status: 400, code: 'VALIDATION', message: 'body.rows must be an array' };
  }
  if (rows.length === 0) {
    return { ok: true, rows: [] };
  }
  if (rows.length > MAX_PUSH_BATCH) {
    return {
      ok: false,
      status: 413,
      code: 'VALIDATION',
      message: `batch size ${rows.length} exceeds MAX_PUSH_BATCH=${MAX_PUSH_BATCH}`,
    };
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.user_id !== userId) {
      return {
        ok: false,
        status: 403,
        code: 'AUTH',
        message: `row[${i}].user_id does not match authenticated user`,
        offendingIndex: i,
      };
    }
    if (!isAllowedKind(row.kind)) {
      return {
        ok: false,
        status: 422,
        code: 'UNKNOWN_KIND',
        message: `row[${i}].kind=${row.kind} is not in the server allowlist`,
        offendingIndex: i,
      };
    }
    const v = validateRow(row);
    if (!v.ok) {
      return {
        ok: false,
        status: 422,
        code: v.code,
        message: `row[${i}] ${v.message}`,
        offendingIndex: i,
      };
    }
    if (!clampHlcSkew(row.updated_at_ts, nowMs)) {
      return {
        ok: false,
        status: 409,
        code: 'CLOCK_SKEW',
        message: `row[${i}].updated_at_ts physical time is outside ±${HLC_SKEW_TOLERANCE_MS}ms of server`,
        offendingIndex: i,
      };
    }
    if (row.deleted_at_ts && !clampHlcSkew(row.deleted_at_ts, nowMs)) {
      return {
        ok: false,
        status: 409,
        code: 'CLOCK_SKEW',
        message: `row[${i}].deleted_at_ts physical time is outside ±${HLC_SKEW_TOLERANCE_MS}ms of server`,
        offendingIndex: i,
      };
    }
  }
  return { ok: true, rows };
};

export interface PullParams {
  kind: string;
  since: Hlc | null;
}

export type PullValidation =
  | { ok: true; params: PullParams }
  | { ok: false; status: number; code: SyncErrorCode; message: string };

export const validatePullParams = (kind: string | null, since: string | null): PullValidation => {
  if (!kind) {
    return { ok: false, status: 400, code: 'VALIDATION', message: 'kind query parameter required' };
  }
  if (!isAllowedKind(kind)) {
    return {
      ok: false,
      status: 422,
      code: 'UNKNOWN_KIND',
      message: `kind=${kind} is not in the server allowlist`,
    };
  }
  return {
    ok: true,
    params: {
      kind,
      since: since ? (since as Hlc) : null,
    },
  };
};

export interface PullBatchEntry {
  kind: string;
  since: Hlc | null;
}

export interface PullBatchBody {
  cursors: PullBatchEntry[];
}

export type PullBatchValidation =
  | { ok: true; params: PullBatchBody }
  | { ok: false; status: number; code: SyncErrorCode; message: string; offendingIndex?: number };

/**
 * Validate the batched-pull body. Same per-row checks as the per-kind
 * GET (`isAllowedKind`), but applied to every cursor entry.
 */
export const validatePullBatch = (body: unknown): PullBatchValidation => {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, status: 400, code: 'VALIDATION', message: 'body must be an object' };
  }
  const cursors = (body as PullBatchBody).cursors;
  if (!Array.isArray(cursors)) {
    return { ok: false, status: 400, code: 'VALIDATION', message: 'body.cursors must be an array' };
  }
  if (cursors.length === 0) {
    return { ok: true, params: { cursors: [] } };
  }
  if (cursors.length > MAX_PULL_BATCH) {
    return {
      ok: false,
      status: 413,
      code: 'VALIDATION',
      message: `cursors.length ${cursors.length} exceeds MAX_PULL_BATCH=${MAX_PULL_BATCH}`,
    };
  }
  const seen = new Set<string>();
  for (let i = 0; i < cursors.length; i++) {
    const c = cursors[i]!;
    if (typeof c.kind !== 'string' || c.kind.length === 0) {
      return {
        ok: false,
        status: 400,
        code: 'VALIDATION',
        message: `cursors[${i}].kind must be a non-empty string`,
        offendingIndex: i,
      };
    }
    if (!isAllowedKind(c.kind)) {
      return {
        ok: false,
        status: 422,
        code: 'UNKNOWN_KIND',
        message: `cursors[${i}].kind=${c.kind} is not in the server allowlist`,
        offendingIndex: i,
      };
    }
    if (seen.has(c.kind)) {
      return {
        ok: false,
        status: 400,
        code: 'VALIDATION',
        message: `cursors[${i}].kind=${c.kind} is duplicated in the batch`,
        offendingIndex: i,
      };
    }
    seen.add(c.kind);
    if (c.since !== null && typeof c.since !== 'string') {
      return {
        ok: false,
        status: 400,
        code: 'VALIDATION',
        message: `cursors[${i}].since must be a string or null`,
        offendingIndex: i,
      };
    }
  }
  return { ok: true, params: { cursors } };
};
