import { describe, expect, test } from 'vitest';
import { computeTextureContentId, textureAdapter } from '@/services/sync/adapters/texture';
import { hlcPack } from '@/libs/crdt';
import type { CustomTexture } from '@/styles/textures';
import type { Hlc, ReplicaRow } from '@/types/replica';

const NOW = 1_700_000_000_000;
const DEV = 'dev-a';
const HLC = hlcPack(NOW, 0, DEV) as Hlc;

const baseTexture = (overrides: Partial<CustomTexture> = {}): CustomTexture => ({
  id: 'placeholder',
  name: 'Marble Texture',
  path: 'bundle-1/marble.jpg',
  bundleDir: 'bundle-1',
  contentId: 'content-hash-tex-1',
  byteSize: 51200,
  downloadedAt: NOW,
  ...overrides,
});

describe('textureAdapter contract', () => {
  test('kind is "texture"', () => {
    expect(textureAdapter.kind).toBe('texture');
  });

  test('schemaVersion is 1', () => {
    expect(textureAdapter.schemaVersion).toBe(1);
  });

  test('binary capability uses BaseDir "Images"', () => {
    expect(textureAdapter.binary?.localBaseDir).toBe('Images');
  });

  test('computeId returns the contentId when set', async () => {
    const t = baseTexture({ contentId: 'content-hash-xyz' });
    expect(await textureAdapter.computeId(t)).toBe('content-hash-xyz');
  });
});

describe('pack ∘ unpack = identity for the synced subset', () => {
  test('synced fields round-trip', () => {
    const t = baseTexture({
      name: 'Oak Wood',
      byteSize: 99999,
      downloadedAt: NOW,
    });
    const packed = textureAdapter.pack(t);
    const unpacked = textureAdapter.unpack(packed);
    expect(unpacked.name).toBe('Oak Wood');
    expect(unpacked.byteSize).toBe(99999);
    expect(unpacked.downloadedAt).toBe(NOW);
  });

  test('per-device fields (path, bundleDir) are NOT in the synced fields object', () => {
    const t = baseTexture({ bundleDir: 'device-local-uniqueId-123', path: 'bundleDir/marble.jpg' });
    const packed = textureAdapter.pack(t);
    expect(packed['bundleDir']).toBeUndefined();
    expect(packed['path']).toBeUndefined();
  });

  test('unavailable / deletedAt are NOT synced (tombstones handle delete)', () => {
    const t = baseTexture({ unavailable: true, deletedAt: 999 });
    const packed = textureAdapter.pack(t);
    expect(packed['unavailable']).toBeUndefined();
    expect(packed['deletedAt']).toBeUndefined();
  });
});

describe('unpackRow', () => {
  const baseRow = (overrides: Partial<ReplicaRow> = {}): ReplicaRow => ({
    user_id: 'u1',
    kind: 'texture',
    replica_id: 'content-hash-tex-1',
    fields_jsonb: {
      name: { v: 'Marble', t: HLC, s: DEV },
      byteSize: { v: 51200, t: HLC, s: DEV },
    },
    manifest_jsonb: {
      files: [{ filename: 'marble.jpg', byteSize: 51200, partialMd5: 'x' }],
      schemaVersion: 1,
    },
    deleted_at_ts: null,
    reincarnation: null,
    updated_at_ts: HLC,
    schema_version: 1,
    ...overrides,
  });

  test('builds a placeholder texture with bundleDir + path + unavailable=true', () => {
    const texture = textureAdapter.unpackRow(baseRow(), 'fresh-bundle');
    expect(texture).not.toBe(null);
    expect(texture!.id).toBe('fresh-bundle');
    expect(texture!.bundleDir).toBe('fresh-bundle');
    expect(texture!.contentId).toBe('content-hash-tex-1');
    expect(texture!.path).toBe('fresh-bundle/marble.jpg');
    expect(texture!.unavailable).toBe(true);
    expect(texture!.name).toBe('Marble');
    expect(texture!.byteSize).toBe(51200);
  });

  test('returns null when name is missing', () => {
    const row = baseRow();
    delete (row.fields_jsonb as Record<string, unknown>)['name'];
    expect(textureAdapter.unpackRow(row, 'b')).toBe(null);
  });

  test('returns null when manifest is absent (no filename to construct path)', () => {
    expect(textureAdapter.unpackRow(baseRow({ manifest_jsonb: null }), 'b')).toBe(null);
  });

  test('reincarnation token propagates', () => {
    const texture = textureAdapter.unpackRow(baseRow({ reincarnation: 'epoch-1' }), 'b');
    expect(texture?.reincarnation).toBe('epoch-1');
  });
});

describe('binary.enumerateFiles', () => {
  test('returns one entry with logical filename + lfp + byteSize', () => {
    const t = baseTexture({ path: 'b1/marble.jpg', byteSize: 51200 });
    const out = textureAdapter.binary!.enumerateFiles(t);
    expect(out).toEqual([{ logical: 'marble.jpg', lfp: 'b1/marble.jpg', byteSize: 51200 }]);
  });

  test('handles legacy flat-path textures (no slash)', () => {
    const t = baseTexture({ path: 'paper.png', bundleDir: undefined, byteSize: 30000 });
    const out = textureAdapter.binary!.enumerateFiles(t);
    expect(out).toEqual([{ logical: 'paper.png', lfp: 'paper.png', byteSize: 30000 }]);
  });
});

describe('computeTextureContentId', () => {
  test('deterministic over (partialMd5, byteSize, filename)', () => {
    const a = computeTextureContentId('abc123', 1024, 'marble.jpg');
    const b = computeTextureContentId('abc123', 1024, 'marble.jpg');
    expect(a).toBe(b);
  });

  test('different partialMd5 → different id', () => {
    expect(computeTextureContentId('abc', 1024, 'a.jpg')).not.toBe(
      computeTextureContentId('def', 1024, 'a.jpg'),
    );
  });

  test('different byteSize → different id', () => {
    expect(computeTextureContentId('abc', 1024, 'a.jpg')).not.toBe(
      computeTextureContentId('abc', 2048, 'a.jpg'),
    );
  });

  test('different filename → different id', () => {
    expect(computeTextureContentId('abc', 1024, 'a.jpg')).not.toBe(
      computeTextureContentId('abc', 1024, 'b.jpg'),
    );
  });

  test('returns 32-hex md5', () => {
    expect(computeTextureContentId('abc', 1024, 'a.jpg')).toMatch(/^[0-9a-f]{32}$/);
  });
});
