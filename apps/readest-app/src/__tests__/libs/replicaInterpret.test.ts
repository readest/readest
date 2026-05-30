import { describe, expect, test } from 'vitest';
import { isReplicaRowAlive } from '@/libs/replicaInterpret';
import { hlcPack } from '@/libs/crdt';
import type { Hlc, ReplicaRow } from '@/types/replica';

const NOW = 1_700_000_000_000;
const DEV = 'dev-a';

const baseRow = (overrides: Partial<ReplicaRow> = {}): ReplicaRow => ({
  user_id: 'u1',
  kind: 'dictionary',
  replica_id: 'content-hash-abc',
  fields_jsonb: {},
  manifest_jsonb: null,
  deleted_at_ts: null,
  reincarnation: null,
  updated_at_ts: hlcPack(NOW, 0, DEV) as Hlc,
  schema_version: 1,
  ...overrides,
});

describe('isReplicaRowAlive', () => {
  test('alive when no tombstone and no reincarnation (fresh row)', () => {
    expect(isReplicaRowAlive(baseRow())).toBe(true);
  });

  test('alive when no tombstone (just deleted_at_ts is null)', () => {
    expect(isReplicaRowAlive(baseRow({ reincarnation: 'epoch-1' }))).toBe(true);
  });

  test('dead when tombstoned and no reincarnation token (the user just deleted it)', () => {
    const tombstone = hlcPack(NOW, 0, DEV) as Hlc;
    expect(
      isReplicaRowAlive(
        baseRow({
          deleted_at_ts: tombstone,
          updated_at_ts: tombstone,
          reincarnation: null,
        }),
      ),
    ).toBe(false);
  });

  test('alive when reincarnation token is newer than the tombstone', () => {
    expect(
      isReplicaRowAlive(
        baseRow({
          deleted_at_ts: hlcPack(NOW, 0, DEV) as Hlc,
          reincarnation: 'epoch-1',
          updated_at_ts: hlcPack(NOW + 1000, 0, DEV) as Hlc,
        }),
      ),
    ).toBe(true);
  });

  test('dead when tombstone is newer than the reincarnation (deleted again after revival)', () => {
    expect(
      isReplicaRowAlive(
        baseRow({
          deleted_at_ts: hlcPack(NOW + 5000, 0, DEV) as Hlc,
          reincarnation: 'epoch-1',
          updated_at_ts: hlcPack(NOW + 1000, 0, DEV) as Hlc,
        }),
      ),
    ).toBe(false);
  });

  test('alive when reincarnation == tombstone HLC (edge of order)', () => {
    const t = hlcPack(NOW + 1000, 0, DEV) as Hlc;
    expect(
      isReplicaRowAlive(
        baseRow({
          deleted_at_ts: t,
          reincarnation: 'epoch-1',
          updated_at_ts: t,
        }),
      ),
    ).toBe(true);
  });

  test('dead when reincarnation is set but tombstone is null is impossible — but tolerate gracefully', () => {
    expect(isReplicaRowAlive(baseRow({ deleted_at_ts: null, reincarnation: 'epoch-1' }))).toBe(
      true,
    );
  });
});
