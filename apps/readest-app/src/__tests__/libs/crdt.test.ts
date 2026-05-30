import { describe, expect, test, vi } from 'vitest';
import {
  HlcGenerator,
  hlcCompare,
  hlcPack,
  hlcParse,
  mergeFields,
  mergeReplica,
  removeReplica,
  setField,
  withReincarnation,
} from '@/libs/crdt';
import type { FieldsObject, Hlc, ReplicaRow } from '@/types/replica';

const DEV_A = 'dev-a';
const DEV_B = 'dev-b';

const hlc = (ms: number, counter = 0, dev = DEV_A): Hlc => hlcPack(ms, counter, dev);

const emptyRow = (overrides: Partial<ReplicaRow> = {}): ReplicaRow => ({
  user_id: 'u1',
  kind: 'dictionary',
  replica_id: 'r1',
  fields_jsonb: {},
  manifest_jsonb: null,
  deleted_at_ts: null,
  reincarnation: null,
  updated_at_ts: hlc(0),
  schema_version: 1,
  ...overrides,
});

describe('HLC pack/parse', () => {
  test('roundtrips physicalMs + counter + deviceId', () => {
    const packed = hlcPack(1700000000000, 7, 'device-xyz');
    const parsed = hlcParse(packed);
    expect(parsed.physicalMs).toBe(1700000000000);
    expect(parsed.counter).toBe(7);
    expect(parsed.deviceId).toBe('device-xyz');
  });

  test('format is 13-hex-ms - 8-hex-counter - deviceId', () => {
    const packed = hlcPack(0, 0, 'd');
    expect(packed).toBe('0000000000000-00000000-d');
    const max = hlcPack(0xfffffffffffff, 0xffffffff, 'd');
    expect(max).toBe('fffffffffffff-ffffffff-d');
  });

  test('lexicographic order matches temporal order across 1000 random HLCs', () => {
    const samples: { ms: number; counter: number; packed: Hlc }[] = [];
    for (let i = 0; i < 1000; i++) {
      const ms = Math.floor(Math.random() * 0x100000000);
      const counter = Math.floor(Math.random() * 0x10000);
      samples.push({ ms, counter, packed: hlcPack(ms, counter, DEV_A) });
    }
    const lex = [...samples].sort((a, b) =>
      a.packed < b.packed ? -1 : a.packed > b.packed ? 1 : 0,
    );
    const temporal = [...samples].sort((a, b) => a.ms - b.ms || a.counter - b.counter);
    expect(lex.map((s) => s.packed)).toEqual(temporal.map((s) => s.packed));
  });

  test('compare returns -1, 0, 1', () => {
    expect(hlcCompare(hlc(1), hlc(2))).toBe(-1);
    expect(hlcCompare(hlc(2), hlc(2))).toBe(0);
    expect(hlcCompare(hlc(3), hlc(2))).toBe(1);
  });
});

describe('HlcGenerator', () => {
  test('strictly monotonic across calls in the same ms', () => {
    const now = vi.fn(() => 1000);
    const gen = new HlcGenerator(DEV_A, now);
    const a = gen.next();
    const b = gen.next();
    const c = gen.next();
    expect(hlcCompare(a, b)).toBe(-1);
    expect(hlcCompare(b, c)).toBe(-1);
    expect(hlcParse(a).counter).toBe(0);
    expect(hlcParse(b).counter).toBe(1);
    expect(hlcParse(c).counter).toBe(2);
  });

  test('counter resets when physical clock advances', () => {
    let t = 1000;
    const now = () => t;
    const gen = new HlcGenerator(DEV_A, now);
    gen.next();
    gen.next();
    expect(hlcParse(gen.next()).counter).toBe(2);
    t = 2000;
    expect(hlcParse(gen.next()).counter).toBe(0);
  });

  test('absorbs remote HLC: next() > any observed remote', () => {
    const t = 1000;
    const gen = new HlcGenerator(DEV_A, () => t);
    const remote = hlcPack(5000, 0, DEV_B);
    gen.observe(remote);
    const next = gen.next();
    expect(hlcCompare(remote, next)).toBe(-1);
  });

  test('survives clock regression by holding the higher physical time', () => {
    let t = 5000;
    const gen = new HlcGenerator(DEV_A, () => t);
    const a = gen.next();
    t = 3000;
    const b = gen.next();
    expect(hlcCompare(a, b)).toBe(-1);
  });

  test('serialize/restore preserves state', () => {
    const t = 1000;
    const gen = new HlcGenerator(DEV_A, () => t);
    gen.next();
    gen.next();
    const snapshot = gen.serialize();
    const gen2 = HlcGenerator.restore(snapshot, DEV_A, () => t);
    expect(hlcParse(gen2.next()).counter).toBe(2);
  });
});

describe('setField', () => {
  test('writes envelope with v, t, s', () => {
    const fields = setField({}, 'name', 'Foo', hlc(100), DEV_A);
    expect(fields['name']).toEqual({ v: 'Foo', t: hlc(100), s: DEV_A });
  });

  test('replaces an existing field with a newer HLC', () => {
    const old = setField({}, 'name', 'Old', hlc(100), DEV_A);
    const next = setField(old, 'name', 'New', hlc(200), DEV_A);
    expect(next['name']).toEqual({ v: 'New', t: hlc(200), s: DEV_A });
  });

  test('returns a new object (immutable)', () => {
    const a: FieldsObject = {};
    const b = setField(a, 'x', 1, hlc(1), DEV_A);
    expect(a).not.toBe(b);
    expect(a).toEqual({});
  });
});

describe('mergeFields (CRDT properties)', () => {
  test('commutativity: merge(a, b) === merge(b, a)', () => {
    const a = setField({}, 'name', 'Foo', hlc(100), DEV_A);
    const b = setField({}, 'enabled', true, hlc(150), DEV_B);
    expect(mergeFields(a, b)).toEqual(mergeFields(b, a));
  });

  test('associativity: merge(merge(a, b), c) === merge(a, merge(b, c))', () => {
    const a = setField({}, 'x', 1, hlc(100), DEV_A);
    const b = setField({}, 'y', 2, hlc(150), DEV_B);
    const c = setField({}, 'z', 3, hlc(200), DEV_A);
    expect(mergeFields(mergeFields(a, b), c)).toEqual(mergeFields(a, mergeFields(b, c)));
  });

  test('idempotence: merge(a, a) === a', () => {
    const a = setField({}, 'name', 'Foo', hlc(100), DEV_A);
    expect(mergeFields(a, a)).toEqual(a);
  });

  test('preserves fields unique to each side', () => {
    const a = setField({}, 'name', 'Foo', hlc(100), DEV_A);
    const b = setField({}, 'enabled', true, hlc(150), DEV_B);
    const merged = mergeFields(a, b);
    expect(merged['name']?.v).toBe('Foo');
    expect(merged['enabled']?.v).toBe(true);
  });

  test('larger HLC wins on same-field collision', () => {
    const a = setField({}, 'name', 'Foo', hlc(100), DEV_A);
    const b = setField({}, 'name', 'Bar', hlc(200), DEV_B);
    expect(mergeFields(a, b)['name']?.v).toBe('Bar');
    expect(mergeFields(b, a)['name']?.v).toBe('Bar');
  });

  test('ties on HLC: deterministic deviceId tiebreak', () => {
    const a = setField({}, 'name', 'Foo', hlcPack(100, 0, 'aaa'), 'aaa');
    const b = setField({}, 'name', 'Bar', hlcPack(100, 0, 'bbb'), 'bbb');
    expect(mergeFields(a, b)).toEqual(mergeFields(b, a));
  });
});

describe('removeReplica + mergeReplica (tombstones)', () => {
  test('removeReplica sets deleted_at_ts and bumps updated_at_ts', () => {
    const row = emptyRow({
      fields_jsonb: setField({}, 'name', 'Foo', hlc(100), DEV_A),
      updated_at_ts: hlc(100),
    });
    const tombstoned = removeReplica(row, hlc(200));
    expect(tombstoned.deleted_at_ts).toBe(hlc(200));
    expect(tombstoned.updated_at_ts).toBe(hlc(200));
  });

  test('field write does NOT revive a tombstoned row (remove-wins)', () => {
    const tombstoned = emptyRow({
      deleted_at_ts: hlc(100),
      updated_at_ts: hlc(100),
    });
    const fieldWrite = emptyRow({
      fields_jsonb: setField({}, 'name', 'Resurrected!', hlc(200), DEV_B),
      updated_at_ts: hlc(200),
    });
    const merged = mergeReplica(tombstoned, fieldWrite);
    expect(merged.deleted_at_ts).toBe(hlc(100));
    expect(merged.fields_jsonb['name']?.v).toBe('Resurrected!');
  });

  test('reincarnation token swaps the row to alive', () => {
    const tombstoned = emptyRow({
      deleted_at_ts: hlc(100),
      updated_at_ts: hlc(100),
    });
    const reborn = withReincarnation(tombstoned, 'epoch-1');
    expect(reborn.reincarnation).toBe('epoch-1');
    expect(reborn.deleted_at_ts).toBe(null);
  });

  test('mergeReplica updated_at_ts = max(field HLCs, tombstone HLC)', () => {
    const a = emptyRow({
      fields_jsonb: setField({}, 'name', 'Foo', hlc(100), DEV_A),
      updated_at_ts: hlc(100),
    });
    const b = emptyRow({
      fields_jsonb: setField({}, 'enabled', true, hlc(300), DEV_B),
      updated_at_ts: hlc(300),
    });
    const merged = mergeReplica(a, b);
    expect(merged.updated_at_ts).toBe(hlc(300));
  });

  test('manifest-only merge advances updated_at_ts so pull cursors see it', () => {
    const metadata = emptyRow({
      fields_jsonb: setField({}, 'name', 'Foo', hlc(100), DEV_A),
      manifest_jsonb: null,
      updated_at_ts: hlc(100),
    });
    const manifest = emptyRow({
      fields_jsonb: {},
      manifest_jsonb: {
        schemaVersion: 1,
        files: [{ filename: 'foo.mdx', byteSize: 1000, partialMd5: 'a'.repeat(32) }],
      },
      updated_at_ts: hlc(200),
    });
    const merged = mergeReplica(metadata, manifest);
    expect(merged.fields_jsonb['name']?.v).toBe('Foo');
    expect(merged.manifest_jsonb?.files).toHaveLength(1);
    expect(merged.updated_at_ts).toBe(hlc(200));
  });

  test('metadata-only merge does not clear an existing manifest', () => {
    const withManifest = emptyRow({
      fields_jsonb: setField({}, 'name', 'Foo', hlc(100), DEV_A),
      manifest_jsonb: {
        schemaVersion: 1,
        files: [{ filename: 'foo.mdx', byteSize: 1000, partialMd5: 'a'.repeat(32) }],
      },
      updated_at_ts: hlc(200),
    });
    const metadataOnly = emptyRow({
      fields_jsonb: setField({}, 'name', 'Renamed', hlc(300), DEV_A),
      manifest_jsonb: null,
      updated_at_ts: hlc(300),
    });
    const merged = mergeReplica(withManifest, metadataOnly);
    expect(merged.fields_jsonb['name']?.v).toBe('Renamed');
    expect(merged.manifest_jsonb?.files).toHaveLength(1);
    expect(merged.updated_at_ts).toBe(hlc(300));
  });

  test('two tombstones: keep the larger HLC', () => {
    const a = emptyRow({ deleted_at_ts: hlc(100), updated_at_ts: hlc(100) });
    const b = emptyRow({ deleted_at_ts: hlc(200), updated_at_ts: hlc(200) });
    expect(mergeReplica(a, b).deleted_at_ts).toBe(hlc(200));
    expect(mergeReplica(b, a).deleted_at_ts).toBe(hlc(200));
  });

  test('mergeReplica is commutative', () => {
    const a = emptyRow({
      fields_jsonb: setField({}, 'name', 'Foo', hlc(100), DEV_A),
      updated_at_ts: hlc(100),
    });
    const b = emptyRow({
      fields_jsonb: setField({}, 'enabled', true, hlc(200), DEV_B),
      updated_at_ts: hlc(200),
    });
    expect(mergeReplica(a, b)).toEqual(mergeReplica(b, a));
  });

  test('mergeReplica is idempotent', () => {
    const a = emptyRow({
      fields_jsonb: setField({}, 'name', 'Foo', hlc(100), DEV_A),
      updated_at_ts: hlc(100),
    });
    expect(mergeReplica(a, a)).toEqual(a);
  });
});

describe('mergeReplica reincarnation interactions', () => {
  test('reincarnation field merges per-field LWW (later epoch wins)', () => {
    const a = emptyRow({ reincarnation: 'epoch-1', deleted_at_ts: null, updated_at_ts: hlc(100) });
    const b = emptyRow({ reincarnation: 'epoch-2', deleted_at_ts: null, updated_at_ts: hlc(200) });
    expect(mergeReplica(a, b).reincarnation).toBe('epoch-2');
  });

  test('metadata-only row with null reincarnation does not clear an existing token', () => {
    const revived = emptyRow({
      reincarnation: 'epoch-1',
      deleted_at_ts: hlc(100),
      updated_at_ts: hlc(200),
    });
    const rename = emptyRow({
      fields_jsonb: setField({}, 'name', 'Renamed', hlc(300), DEV_A),
      reincarnation: null,
      deleted_at_ts: null,
      updated_at_ts: hlc(300),
    });
    const merged = mergeReplica(revived, rename);
    expect(merged.fields_jsonb['name']?.v).toBe('Renamed');
    expect(merged.reincarnation).toBe('epoch-1');
    expect(mergeReplica(rename, revived).reincarnation).toBe('epoch-1');
  });

  test('newer tombstone clears an existing reincarnation token', () => {
    const revived = emptyRow({
      reincarnation: 'epoch-1',
      deleted_at_ts: hlc(100),
      updated_at_ts: hlc(200),
    });
    const deleted = emptyRow({
      reincarnation: null,
      deleted_at_ts: hlc(300),
      updated_at_ts: hlc(300),
    });
    const merged = mergeReplica(revived, deleted);
    expect(merged.deleted_at_ts).toBe(hlc(300));
    expect(merged.reincarnation).toBe(null);
  });

  test('older duplicate tombstone does not clear a later reincarnation token', () => {
    const revived = emptyRow({
      reincarnation: 'epoch-1',
      deleted_at_ts: hlc(100),
      updated_at_ts: hlc(200),
    });
    const duplicateDelete = emptyRow({
      reincarnation: null,
      deleted_at_ts: hlc(100),
      updated_at_ts: hlc(100),
    });
    expect(mergeReplica(revived, duplicateDelete).reincarnation).toBe('epoch-1');
  });
});
