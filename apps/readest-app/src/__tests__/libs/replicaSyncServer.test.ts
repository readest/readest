import { describe, expect, test } from 'vitest';
import {
  HLC_SKEW_TOLERANCE_MS,
  MAX_PUSH_BATCH,
  clampHlcSkew,
  validatePullParams,
  validatePushBatch,
} from '@/libs/replicaSyncServer';
import { hlcPack } from '@/libs/crdt';
import type { Hlc, ReplicaRow } from '@/types/replica';

const USER = 'u1';
const NOW = 1_700_000_000_000;
const HLC_NOW = hlcPack(NOW, 0, 'dev-a') as Hlc;

const baseRow = (overrides: Partial<ReplicaRow> = {}): ReplicaRow => ({
  user_id: USER,
  kind: 'dictionary',
  replica_id: 'r1',
  fields_jsonb: {
    name: { v: 'Webster', t: HLC_NOW, s: 'dev-a' },
  },
  manifest_jsonb: null,
  deleted_at_ts: null,
  reincarnation: null,
  updated_at_ts: HLC_NOW,
  schema_version: 1,
  ...overrides,
});

describe('clampHlcSkew', () => {
  test('accepts HLC within tolerance', () => {
    expect(clampHlcSkew(hlcPack(NOW + 1000, 0, 'd') as Hlc, NOW)).toBe(true);
    expect(clampHlcSkew(hlcPack(NOW - 1000, 0, 'd') as Hlc, NOW)).toBe(true);
    expect(clampHlcSkew(hlcPack(NOW + HLC_SKEW_TOLERANCE_MS, 0, 'd') as Hlc, NOW)).toBe(true);
  });

  test('rejects HLC beyond tolerance', () => {
    expect(clampHlcSkew(hlcPack(NOW + HLC_SKEW_TOLERANCE_MS + 1, 0, 'd') as Hlc, NOW)).toBe(false);
    expect(clampHlcSkew(hlcPack(NOW - HLC_SKEW_TOLERANCE_MS - 1, 0, 'd') as Hlc, NOW)).toBe(false);
  });

  test('far-future HLC is rejected', () => {
    expect(clampHlcSkew(hlcPack(NOW + 1_000_000_000, 0, 'd') as Hlc, NOW)).toBe(false);
  });
});

describe('validatePushBatch', () => {
  test('accepts an empty batch', () => {
    const result = validatePushBatch({ rows: [] }, USER, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toEqual([]);
  });

  test('accepts a single valid row', () => {
    const result = validatePushBatch({ rows: [baseRow()] }, USER, NOW);
    expect(result.ok).toBe(true);
  });

  test('rejects body that is not an object', () => {
    const result = validatePushBatch(null, USER, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.code).toBe('VALIDATION');
    }
  });

  test('rejects body without rows array', () => {
    const result = validatePushBatch({ wrong: 'shape' }, USER, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  test('rejects batch above MAX_PUSH_BATCH', () => {
    const rows = Array.from({ length: MAX_PUSH_BATCH + 1 }, (_, i) =>
      baseRow({ replica_id: `r${i}` }),
    );
    const result = validatePushBatch({ rows }, USER, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(413);
      expect(result.code).toBe('VALIDATION');
    }
  });

  test('rejects row with mismatched user_id (cross-account write attempt)', () => {
    const result = validatePushBatch({ rows: [baseRow({ user_id: 'attacker' })] }, USER, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.code).toBe('AUTH');
      expect(result.offendingIndex).toBe(0);
    }
  });

  test('rejects row with kind not in allowlist', () => {
    const result = validatePushBatch({ rows: [baseRow({ kind: 'evil' })] }, USER, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(422);
      expect(result.code).toBe('UNKNOWN_KIND');
    }
  });

  test('rejects row with HLC outside skew tolerance', () => {
    const farFuture = hlcPack(NOW + 1_000_000, 0, 'd') as Hlc;
    const result = validatePushBatch({ rows: [baseRow({ updated_at_ts: farFuture })] }, USER, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.code).toBe('CLOCK_SKEW');
    }
  });

  test('reports the offending index for downstream telemetry', () => {
    const rows = [
      baseRow({ replica_id: 'r0' }),
      baseRow({ replica_id: 'r1', kind: 'evil' }),
      baseRow({ replica_id: 'r2' }),
    ];
    const result = validatePushBatch({ rows }, USER, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.offendingIndex).toBe(1);
  });
});

describe('validatePullParams', () => {
  test('accepts kind=dictionary with no since', () => {
    const result = validatePullParams('dictionary', null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.params.since).toBe(null);
  });

  test('accepts kind=dictionary with a since cursor', () => {
    const result = validatePullParams('dictionary', '0000000000064-00000000-dev-a');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.params.since).toBe('0000000000064-00000000-dev-a');
  });

  test('rejects missing kind', () => {
    const result = validatePullParams(null, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  test('rejects unknown kind', () => {
    const result = validatePullParams('opds_catalog', null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(422);
      expect(result.code).toBe('UNKNOWN_KIND');
    }
  });
});
