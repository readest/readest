import { describe, expect, test } from 'vitest';
import {
  computeDictionaryReplicaId,
  dictionaryAdapter,
  enumerateDictionaryFiles,
  primaryDictionaryFile,
} from '@/services/sync/adapters/dictionary';
import type { ImportedDictionary } from '@/services/dictionaries/types';

const baseDict = (overrides: Partial<ImportedDictionary> = {}): ImportedDictionary => ({
  id: 'placeholder',
  kind: 'mdict',
  name: 'Webster',
  bundleDir: 'webster-bundle',
  files: { mdx: 'webster.mdx', mdd: ['webster.mdd'] },
  addedAt: 1700000000000,
  ...overrides,
});

describe('dictionaryAdapter contract', () => {
  test('kind is "dictionary"', () => {
    expect(dictionaryAdapter.kind).toBe('dictionary');
  });

  test('schemaVersion is 1', () => {
    expect(dictionaryAdapter.schemaVersion).toBe(1);
  });

  test('binary capability uses BaseDir "Dictionaries"', () => {
    expect(dictionaryAdapter.binary?.localBaseDir).toBe('Dictionaries');
  });

  test('computeId returns the record id (sync passthrough)', async () => {
    const d = baseDict({ id: 'content-hash-xyz' });
    expect(await dictionaryAdapter.computeId(d)).toBe('content-hash-xyz');
  });
});

describe('pack ∘ unpack = identity for the synced subset', () => {
  test('mdict bundle: synced fields round-trip', () => {
    const d = baseDict({
      kind: 'mdict',
      name: 'Webster',
      lang: 'en',
      addedAt: 1700000000000,
    });
    const packed = dictionaryAdapter.pack(d);
    const unpacked = dictionaryAdapter.unpack(packed);
    expect(unpacked.name).toBe('Webster');
    expect(unpacked.lang).toBe('en');
    expect(unpacked.kind).toBe('mdict');
    expect(unpacked.addedAt).toBe(1700000000000);
  });

  test('per-device fields (bundleDir, files) are NOT in the synced fields object', () => {
    const d = baseDict({
      bundleDir: 'device-local-uniqueId-123',
      files: { mdx: 'webster.mdx' },
    });
    const packed = dictionaryAdapter.pack(d);
    expect(packed['bundleDir']).toBeUndefined();
    expect(packed['files']).toBeUndefined();
  });

  test('unavailable / deletedAt are NOT synced as fields (tombstones handle delete)', () => {
    const d = baseDict({ unavailable: true, deletedAt: 999 });
    const packed = dictionaryAdapter.pack(d);
    expect(packed['unavailable']).toBeUndefined();
    expect(packed['deletedAt']).toBeUndefined();
  });

  test('unsupportedReason round-trips', () => {
    const d = baseDict({ unsupported: true, unsupportedReason: 'encrypted MDX' });
    const packed = dictionaryAdapter.pack(d);
    const unpacked = dictionaryAdapter.unpack(packed);
    expect(unpacked.unsupported).toBe(true);
    expect(unpacked.unsupportedReason).toBe('encrypted MDX');
  });
});

describe('primaryDictionaryFile', () => {
  test('mdict → .mdx', () => {
    expect(primaryDictionaryFile(baseDict({ kind: 'mdict', files: { mdx: 'w.mdx' } }))).toBe(
      'w.mdx',
    );
  });

  test('stardict → .ifo', () => {
    expect(
      primaryDictionaryFile(
        baseDict({ kind: 'stardict', files: { ifo: 'w.ifo', dict: 'w.dict.dz' } }),
      ),
    ).toBe('w.ifo');
  });

  test('dict → .dict (or .dict.dz)', () => {
    expect(
      primaryDictionaryFile(
        baseDict({ kind: 'dict', files: { dict: 'w.dict.dz', index: 'w.index' } }),
      ),
    ).toBe('w.dict.dz');
  });

  test('slob → .slob', () => {
    expect(primaryDictionaryFile(baseDict({ kind: 'slob', files: { slob: 'w.slob' } }))).toBe(
      'w.slob',
    );
  });

  test('returns null when no primary file is recorded', () => {
    expect(primaryDictionaryFile(baseDict({ kind: 'mdict', files: {} }))).toBe(null);
  });
});

describe('enumerateDictionaryFiles', () => {
  test('mdict bundle: mdx + mdd[] + css[]', () => {
    const d = baseDict({
      kind: 'mdict',
      bundleDir: 'b1',
      files: {
        mdx: 'webster.mdx',
        mdd: ['webster.mdd', 'webster.1.mdd'],
        css: ['webster.css'],
      },
    });
    const files = enumerateDictionaryFiles(d);
    expect(files.map((f) => f.logical)).toEqual([
      'webster.mdx',
      'webster.mdd',
      'webster.1.mdd',
      'webster.css',
    ]);
    expect(files.every((f) => f.lfp.startsWith('b1/'))).toBe(true);
  });

  test('stardict bundle: ifo + idx + dict + syn (skips offset sidecars)', () => {
    const d = baseDict({
      kind: 'stardict',
      bundleDir: 's1',
      files: {
        ifo: 'd.ifo',
        idx: 'd.idx',
        dict: 'd.dict.dz',
        syn: 'd.syn',
        idxOffsets: 'd.idx.offsets',
        synOffsets: 'd.syn.offsets',
      },
    });
    const files = enumerateDictionaryFiles(d);
    expect(files.map((f) => f.logical).sort()).toEqual(['d.dict.dz', 'd.idx', 'd.ifo', 'd.syn']);
  });

  test('dict bundle: dict + index', () => {
    const d = baseDict({
      kind: 'dict',
      bundleDir: 'dd',
      files: { dict: 'w.dict.dz', index: 'w.index' },
    });
    const files = enumerateDictionaryFiles(d);
    expect(files.map((f) => f.logical).sort()).toEqual(['w.dict.dz', 'w.index']);
  });

  test('slob bundle: single .slob file', () => {
    const d = baseDict({ kind: 'slob', bundleDir: 'sl', files: { slob: 'w.slob' } });
    const files = enumerateDictionaryFiles(d);
    expect(files.map((f) => f.logical)).toEqual(['w.slob']);
  });

  test('absent files are skipped', () => {
    const d = baseDict({ kind: 'mdict', bundleDir: 'b', files: { mdx: 'm.mdx' } });
    const files = enumerateDictionaryFiles(d);
    expect(files.map((f) => f.logical)).toEqual(['m.mdx']);
  });
});

describe('computeDictionaryReplicaId', () => {
  test('deterministic over (partialMd5, byteSize, sorted filenames)', () => {
    const a = computeDictionaryReplicaId('abc123', 1024, ['x.mdx', 'x.mdd']);
    const b = computeDictionaryReplicaId('abc123', 1024, ['x.mdd', 'x.mdx']);
    expect(a).toBe(b);
  });

  test('different partialMd5 → different id', () => {
    const a = computeDictionaryReplicaId('abc', 1024, ['x.mdx']);
    const b = computeDictionaryReplicaId('def', 1024, ['x.mdx']);
    expect(a).not.toBe(b);
  });

  test('different byteSize → different id', () => {
    const a = computeDictionaryReplicaId('abc', 1024, ['x.mdx']);
    const b = computeDictionaryReplicaId('abc', 2048, ['x.mdx']);
    expect(a).not.toBe(b);
  });

  test('different filename set → different id', () => {
    const a = computeDictionaryReplicaId('abc', 1024, ['x.mdx']);
    const b = computeDictionaryReplicaId('abc', 1024, ['x.mdx', 'x.mdd']);
    expect(a).not.toBe(b);
  });

  test('returns 32-hex md5', () => {
    const id = computeDictionaryReplicaId('abc', 1024, ['x.mdx']);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });
});
