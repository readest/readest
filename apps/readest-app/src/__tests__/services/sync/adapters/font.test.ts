import { describe, expect, test } from 'vitest';
import { computeFontContentId, fontAdapter } from '@/services/sync/adapters/font';
import { hlcPack } from '@/libs/crdt';
import type { CustomFont } from '@/styles/fonts';
import type { Hlc, ReplicaRow } from '@/types/replica';

const NOW = 1_700_000_000_000;
const DEV = 'dev-a';
const HLC = hlcPack(NOW, 0, DEV) as Hlc;

const baseFont = (overrides: Partial<CustomFont> = {}): CustomFont => ({
  id: 'placeholder',
  name: 'Inter Regular',
  path: 'bundle-1/Inter-Regular.ttf',
  bundleDir: 'bundle-1',
  contentId: 'content-hash-123',
  byteSize: 102400,
  family: 'Inter',
  style: 'normal',
  weight: 400,
  variable: false,
  downloadedAt: NOW,
  ...overrides,
});

describe('fontAdapter contract', () => {
  test('kind is "font"', () => {
    expect(fontAdapter.kind).toBe('font');
  });

  test('schemaVersion is 1', () => {
    expect(fontAdapter.schemaVersion).toBe(1);
  });

  test('binary capability uses BaseDir "Fonts"', () => {
    expect(fontAdapter.binary?.localBaseDir).toBe('Fonts');
  });

  test('computeId returns the contentId when set', async () => {
    const f = baseFont({ contentId: 'content-hash-xyz' });
    expect(await fontAdapter.computeId(f)).toBe('content-hash-xyz');
  });
});

describe('pack ∘ unpack = identity for the synced subset', () => {
  test('synced fields round-trip', () => {
    const f = baseFont({
      name: 'Inter Bold',
      family: 'Inter',
      style: 'normal',
      weight: 700,
      variable: false,
      byteSize: 99999,
      downloadedAt: NOW,
    });
    const packed = fontAdapter.pack(f);
    const unpacked = fontAdapter.unpack(packed);
    expect(unpacked.name).toBe('Inter Bold');
    expect(unpacked.family).toBe('Inter');
    expect(unpacked.style).toBe('normal');
    expect(unpacked.weight).toBe(700);
    expect(unpacked.variable).toBeUndefined();
    expect(unpacked.byteSize).toBe(99999);
    expect(unpacked.downloadedAt).toBe(NOW);
  });

  test('per-device fields (path, bundleDir) are NOT in the synced fields object', () => {
    const f = baseFont({ bundleDir: 'device-local-uniqueId-123', path: 'bundleDir/Inter.ttf' });
    const packed = fontAdapter.pack(f);
    expect(packed['bundleDir']).toBeUndefined();
    expect(packed['path']).toBeUndefined();
  });

  test('unavailable / deletedAt are NOT synced (tombstones handle delete)', () => {
    const f = baseFont({ unavailable: true, deletedAt: 999 });
    const packed = fontAdapter.pack(f);
    expect(packed['unavailable']).toBeUndefined();
    expect(packed['deletedAt']).toBeUndefined();
  });

  test('variable=true round-trips', () => {
    const f = baseFont({ variable: true });
    const packed = fontAdapter.pack(f);
    const unpacked = fontAdapter.unpack(packed);
    expect(unpacked.variable).toBe(true);
  });
});

describe('unpackRow', () => {
  const baseRow = (overrides: Partial<ReplicaRow> = {}): ReplicaRow => ({
    user_id: 'u1',
    kind: 'font',
    replica_id: 'content-hash-123',
    fields_jsonb: {
      name: { v: 'Inter Bold', t: HLC, s: DEV },
      family: { v: 'Inter', t: HLC, s: DEV },
      weight: { v: 700, t: HLC, s: DEV },
      byteSize: { v: 102400, t: HLC, s: DEV },
    },
    manifest_jsonb: {
      files: [{ filename: 'Inter-Bold.ttf', byteSize: 102400, partialMd5: 'x' }],
      schemaVersion: 1,
    },
    deleted_at_ts: null,
    reincarnation: null,
    updated_at_ts: HLC,
    schema_version: 1,
    ...overrides,
  });

  test('builds a placeholder font with bundleDir + path + unavailable=true', () => {
    const font = fontAdapter.unpackRow(baseRow(), 'fresh-bundle');
    expect(font).not.toBe(null);
    expect(font!.id).toBe('fresh-bundle');
    expect(font!.bundleDir).toBe('fresh-bundle');
    expect(font!.contentId).toBe('content-hash-123');
    expect(font!.path).toBe('fresh-bundle/Inter-Bold.ttf');
    expect(font!.unavailable).toBe(true);
    expect(font!.name).toBe('Inter Bold');
    expect(font!.family).toBe('Inter');
    expect(font!.weight).toBe(700);
    expect(font!.byteSize).toBe(102400);
  });

  test('returns null when name is missing', () => {
    const row = baseRow();
    delete (row.fields_jsonb as Record<string, unknown>)['name'];
    expect(fontAdapter.unpackRow(row, 'b')).toBe(null);
  });

  test('returns null when manifest is absent (no filename to construct path)', () => {
    expect(fontAdapter.unpackRow(baseRow({ manifest_jsonb: null }), 'b')).toBe(null);
  });

  test('reincarnation token propagates', () => {
    const font = fontAdapter.unpackRow(baseRow({ reincarnation: 'epoch-1' }), 'b');
    expect(font?.reincarnation).toBe('epoch-1');
  });
});

describe('binary.enumerateFiles', () => {
  test('returns one entry with logical filename + lfp + byteSize', () => {
    const f = baseFont({ path: 'b1/Inter-Bold.ttf', byteSize: 102400 });
    const out = fontAdapter.binary!.enumerateFiles(f);
    expect(out).toEqual([
      { logical: 'Inter-Bold.ttf', lfp: 'b1/Inter-Bold.ttf', byteSize: 102400 },
    ]);
  });

  test('handles legacy flat-path fonts (no slash)', () => {
    const f = baseFont({ path: 'Inter-Regular.ttf', bundleDir: undefined, byteSize: 50000 });
    const out = fontAdapter.binary!.enumerateFiles(f);
    expect(out).toEqual([
      { logical: 'Inter-Regular.ttf', lfp: 'Inter-Regular.ttf', byteSize: 50000 },
    ]);
  });
});

describe('computeFontContentId', () => {
  test('deterministic over (partialMd5, byteSize, filename)', () => {
    const a = computeFontContentId('abc123', 1024, 'Inter.ttf');
    const b = computeFontContentId('abc123', 1024, 'Inter.ttf');
    expect(a).toBe(b);
  });

  test('different partialMd5 → different id', () => {
    expect(computeFontContentId('abc', 1024, 'a.ttf')).not.toBe(
      computeFontContentId('def', 1024, 'a.ttf'),
    );
  });

  test('different byteSize → different id', () => {
    expect(computeFontContentId('abc', 1024, 'a.ttf')).not.toBe(
      computeFontContentId('abc', 2048, 'a.ttf'),
    );
  });

  test('different filename → different id', () => {
    expect(computeFontContentId('abc', 1024, 'a.ttf')).not.toBe(
      computeFontContentId('abc', 1024, 'b.ttf'),
    );
  });

  test('returns 32-hex md5', () => {
    expect(computeFontContentId('abc', 1024, 'a.ttf')).toMatch(/^[0-9a-f]{32}$/);
  });
});
