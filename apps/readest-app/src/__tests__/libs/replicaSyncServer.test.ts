import { describe, expect, test } from 'vitest';
import {
  HLC_SKEW_TOLERANCE_MS,
  MAX_PULL_BATCH,
  MAX_PUSH_BATCH,
  clampHlcSkew,
  validatePullBatch,
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
    const result = validatePullParams('not_a_kind', null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(422);
      expect(result.code).toBe('UNKNOWN_KIND');
    }
  });
});

describe('validatePullBatch', () => {
  test('accepts an empty cursors array', () => {
    const result = validatePullBatch({ cursors: [] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.params.cursors).toEqual([]);
  });

  test('accepts mixed since values (string + null) for allowed kinds', () => {
    const result = validatePullBatch({
      cursors: [
        { kind: 'dictionary', since: '0000000000064-00000000-dev-a' },
        { kind: 'font', since: null },
        { kind: 'settings', since: null },
      ],
    });
    expect(result.ok).toBe(true);
  });

  test('rejects body that is not an object', () => {
    const result = validatePullBatch(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  test('rejects body where cursors is not an array', () => {
    const result = validatePullBatch({ cursors: 'not-an-array' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  test('rejects unknown kind in cursors', () => {
    const result = validatePullBatch({ cursors: [{ kind: 'not_a_kind', since: null }] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(422);
      expect(result.code).toBe('UNKNOWN_KIND');
      expect(result.offendingIndex).toBe(0);
    }
  });

  test('rejects since that is not a string or null', () => {
    const result = validatePullBatch({
      cursors: [{ kind: 'dictionary', since: 1234 as unknown as null }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.offendingIndex).toBe(0);
    }
  });

  test('rejects duplicated kind in the same batch', () => {
    // Avoids ambiguity in the response — a server merging two queries
    // for the same kind would have to pick one, and the client has no
    // way to express which `since` won.
    const result = validatePullBatch({
      cursors: [
        { kind: 'dictionary', since: null },
        { kind: 'dictionary', since: '0000000000064-00000000-dev-a' },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.offendingIndex).toBe(1);
    }
  });

  test('rejects oversized batches with status 413', () => {
    const cursors = Array.from({ length: MAX_PULL_BATCH + 1 }, () => ({
      kind: 'dictionary',
      since: null,
    }));
    const result = validatePullBatch({ cursors });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(413);
  });
});
