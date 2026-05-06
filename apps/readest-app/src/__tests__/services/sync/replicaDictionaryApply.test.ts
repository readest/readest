import { describe, expect, test } from 'vitest';
import {
  buildLocalDictFromRow,
  filesFromManifest,
  unwrapDictionaryFields,
} from '@/services/sync/replicaDictionaryApply';
import { hlcPack } from '@/libs/crdt';
import type { Hlc, Manifest, ReplicaRow } from '@/types/replica';

const NOW = 1_700_000_000_000;
const DEV = 'dev-a';

const baseRow = (overrides: Partial<ReplicaRow> = {}): ReplicaRow => ({
  user_id: 'u1',
  kind: 'dictionary',
  replica_id: 'content-hash-abc',
  fields_jsonb: {
    name: { v: 'Webster', t: hlcPack(NOW, 0, DEV) as Hlc, s: DEV },
    kind: { v: 'mdict', t: hlcPack(NOW, 1, DEV) as Hlc, s: DEV },
    lang: { v: 'en', t: hlcPack(NOW, 2, DEV) as Hlc, s: DEV },
    addedAt: { v: 1700000000000, t: hlcPack(NOW, 3, DEV) as Hlc, s: DEV },
  },
  manifest_jsonb: null,
  deleted_at_ts: null,
  reincarnation: null,
  updated_at_ts: hlcPack(NOW, 3, DEV) as Hlc,
  schema_version: 1,
  ...overrides,
});

const manifest = (
  files: { filename: string; byteSize?: number; partialMd5?: string }[],
): Manifest => ({
  files: files.map((f) => ({
    filename: f.filename,
    byteSize: f.byteSize ?? 0,
    partialMd5: f.partialMd5 ?? '',
  })),
  schemaVersion: 1,
});

describe('unwrapDictionaryFields', () => {
  test('extracts plain values from envelope fields', () => {
    const row = baseRow();
    expect(unwrapDictionaryFields(row.fields_jsonb)).toEqual({
      name: 'Webster',
      kind: 'mdict',
      lang: 'en',
      addedAt: 1700000000000,
    });
  });

  test('returns undefined for missing fields', () => {
    const row = baseRow();
    delete (row.fields_jsonb as Record<string, unknown>)['lang'];
    expect(unwrapDictionaryFields(row.fields_jsonb).lang).toBeUndefined();
  });

  test('handles unsupportedReason if present', () => {
    const row = baseRow();
    row.fields_jsonb['unsupportedReason'] = {
      v: 'encrypted',
      t: hlcPack(NOW, 4, DEV) as Hlc,
      s: DEV,
    };
    row.fields_jsonb['unsupported'] = { v: true, t: hlcPack(NOW, 5, DEV) as Hlc, s: DEV };
    const fields = unwrapDictionaryFields(row.fields_jsonb);
    expect(fields.unsupported).toBe(true);
    expect(fields.unsupportedReason).toBe('encrypted');
  });
});

describe('filesFromManifest', () => {
  test('mdict manifest: classifies mdx + mdd + css', () => {
    const m = manifest([
      { filename: 'webster.mdx' },
      { filename: 'webster.mdd' },
      { filename: 'webster.1.mdd' },
      { filename: 'webster.css' },
    ]);
    expect(filesFromManifest(m, 'mdict')).toEqual({
      mdx: 'webster.mdx',
      mdd: ['webster.mdd', 'webster.1.mdd'],
      css: ['webster.css'],
    });
  });

  test('stardict manifest: classifies ifo + idx + dict + syn (skips offsets)', () => {
    const m = manifest([
      { filename: 'd.ifo' },
      { filename: 'd.idx' },
      { filename: 'd.dict.dz' },
      { filename: 'd.syn' },
    ]);
    expect(filesFromManifest(m, 'stardict')).toEqual({
      ifo: 'd.ifo',
      idx: 'd.idx',
      dict: 'd.dict.dz',
      syn: 'd.syn',
    });
  });

  test('dict manifest: classifies dict + index', () => {
    const m = manifest([{ filename: 'w.dict.dz' }, { filename: 'w.index' }]);
    expect(filesFromManifest(m, 'dict')).toEqual({
      dict: 'w.dict.dz',
      index: 'w.index',
    });
  });

  test('slob manifest: classifies single .slob', () => {
    const m = manifest([{ filename: 'w.slob' }]);
    expect(filesFromManifest(m, 'slob')).toEqual({ slob: 'w.slob' });
  });

  test('null manifest returns empty files object', () => {
    expect(filesFromManifest(null, 'mdict')).toEqual({});
  });

  test('empty manifest returns empty files object', () => {
    expect(filesFromManifest(manifest([]), 'mdict')).toEqual({});
  });
});

describe('buildLocalDictFromRow', () => {
  test('builds a complete ImportedDictionary from a row + bundleDir', () => {
    const row = baseRow({
      manifest_jsonb: manifest([
        { filename: 'webster.mdx', byteSize: 1000 },
        { filename: 'webster.mdd', byteSize: 5000 },
      ]),
    });
    const dict = buildLocalDictFromRow(row, 'local-bundle-1');
    expect(dict).not.toBe(null);
    expect(dict!.id).toBe('local-bundle-1');
    expect(dict!.contentId).toBe('content-hash-abc');
    expect(dict!.kind).toBe('mdict');
    expect(dict!.name).toBe('Webster');
    expect(dict!.lang).toBe('en');
    expect(dict!.addedAt).toBe(1700000000000);
    expect(dict!.bundleDir).toBe('local-bundle-1');
    expect(dict!.files).toEqual({ mdx: 'webster.mdx', mdd: ['webster.mdd'] });
    expect(dict!.unavailable).toBe(true);
  });

  test('null manifest produces an empty files object (still unavailable)', () => {
    const row = baseRow({ manifest_jsonb: null });
    const dict = buildLocalDictFromRow(row, 'b');
    expect(dict!.files).toEqual({});
    expect(dict!.unavailable).toBe(true);
  });

  test('returns null when fields are malformed (missing kind)', () => {
    const row = baseRow();
    delete (row.fields_jsonb as Record<string, unknown>)['kind'];
    expect(buildLocalDictFromRow(row, 'b')).toBe(null);
  });

  test('returns null when fields are malformed (missing name)', () => {
    const row = baseRow();
    delete (row.fields_jsonb as Record<string, unknown>)['name'];
    expect(buildLocalDictFromRow(row, 'b')).toBe(null);
  });

  test('propagates reincarnation token from the row to the dict', () => {
    const row = baseRow({ reincarnation: 'epoch-1' });
    expect(buildLocalDictFromRow(row, 'b')!.reincarnation).toBe('epoch-1');
  });

  test('propagates unsupported flags', () => {
    const row = baseRow();
    row.fields_jsonb['unsupported'] = { v: true, t: hlcPack(NOW, 4, DEV) as Hlc, s: DEV };
    row.fields_jsonb['unsupportedReason'] = {
      v: 'encrypted MDX',
      t: hlcPack(NOW, 5, DEV) as Hlc,
      s: DEV,
    };
    const dict = buildLocalDictFromRow(row, 'b')!;
    expect(dict.unsupported).toBe(true);
    expect(dict.unsupportedReason).toBe('encrypted MDX');
  });

  test('falls back to current time when addedAt missing', () => {
    const row = baseRow();
    delete (row.fields_jsonb as Record<string, unknown>)['addedAt'];
    const before = Date.now();
    const dict = buildLocalDictFromRow(row, 'b')!;
    const after = Date.now();
    expect(dict.addedAt).toBeGreaterThanOrEqual(before);
    expect(dict.addedAt).toBeLessThanOrEqual(after);
  });
});
