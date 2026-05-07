import { afterEach, describe, expect, test } from 'vitest';
import {
  clearReplicaAdapters,
  getReplicaAdapter,
  listReplicaAdapters,
  registerReplicaAdapter,
} from '@/services/sync/replicaRegistry';
import type { ReplicaAdapter } from '@/services/sync/replicaRegistry';

interface DictRecord {
  id: string;
  name: string;
  enabled: boolean;
}

const dictionaryAdapter: ReplicaAdapter<DictRecord> = {
  kind: 'dictionary',
  schemaVersion: 1,
  pack: (r) => ({ id: r.id, name: r.name, enabled: r.enabled }),
  unpack: (f) => ({ id: String(f['id']), name: String(f['name']), enabled: Boolean(f['enabled']) }),
  computeId: async (r: DictRecord) => r.id,
  unpackRow: () => null,
};

afterEach(() => clearReplicaAdapters());

describe('replicaRegistry', () => {
  test('register + get round-trip', () => {
    registerReplicaAdapter(dictionaryAdapter);
    const got = getReplicaAdapter('dictionary');
    expect(got).toBe(dictionaryAdapter);
  });

  test('unknown kind returns undefined', () => {
    expect(getReplicaAdapter('not-a-kind')).toBeUndefined();
  });

  test('double registration throws (defensive against doubly-imported modules)', () => {
    registerReplicaAdapter(dictionaryAdapter);
    expect(() => registerReplicaAdapter(dictionaryAdapter)).toThrow(/already registered/i);
  });

  test('listReplicaAdapters returns all registered kinds', () => {
    registerReplicaAdapter(dictionaryAdapter);
    expect(listReplicaAdapters().map((a) => a.kind)).toEqual(['dictionary']);
  });

  test('pack ∘ unpack = identity for sample adapter', () => {
    registerReplicaAdapter(dictionaryAdapter);
    const adapter = getReplicaAdapter<DictRecord>('dictionary')!;
    const original: DictRecord = { id: 'd1', name: 'Webster', enabled: true };
    const packed = adapter.pack(original);
    const unpacked = adapter.unpack(packed);
    expect(unpacked).toEqual(original);
  });

  test('clearReplicaAdapters empties the registry (test-only)', () => {
    registerReplicaAdapter(dictionaryAdapter);
    clearReplicaAdapters();
    expect(getReplicaAdapter('dictionary')).toBeUndefined();
    expect(listReplicaAdapters()).toEqual([]);
  });
});
