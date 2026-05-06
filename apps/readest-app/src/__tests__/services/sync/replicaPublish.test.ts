import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/utils/access', () => ({
  getUserID: vi.fn(),
}));

vi.mock('@/services/sync/replicaSync', () => ({
  getReplicaSync: vi.fn(),
}));

import { getUserID } from '@/utils/access';
import { getReplicaSync } from '@/services/sync/replicaSync';
import {
  publishDictionaryDelete,
  publishDictionaryManifest,
  publishDictionaryUpsert,
} from '@/services/sync/replicaPublish';
import type { ImportedDictionary } from '@/services/dictionaries/types';
import { HlcGenerator, hlcPack } from '@/libs/crdt';
import type { Hlc, ReplicaRow } from '@/types/replica';

const NOW = 1_700_000_000_000;
const DEV = 'dev-a';

const baseDict = (overrides: Partial<ImportedDictionary> = {}): ImportedDictionary => ({
  id: 'bundle-dir-xyz',
  contentId: 'content-hash-abc',
  kind: 'mdict',
  name: 'Webster',
  bundleDir: 'bundle-dir-xyz',
  files: { mdx: 'webster.mdx' },
  addedAt: NOW,
  ...overrides,
});

const makeFakeCtx = () => {
  const hlc = new HlcGenerator(DEV, () => NOW);
  const manager = {
    markDirty: vi.fn(),
    flush: vi.fn(),
    pull: vi.fn(),
    startAutoSync: vi.fn(),
    stopAutoSync: vi.fn(),
    pendingCount: vi.fn(() => 0),
    pendingKeys: vi.fn(() => []),
  };
  return { manager, hlc, deviceId: DEV };
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('publishDictionaryUpsert', () => {
  test('no-ops when replicaSync is not initialized', async () => {
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue('user-1');
    await publishDictionaryUpsert(baseDict());
  });

  test('no-ops when contentId is absent (legacy bundle)', async () => {
    const ctx = makeFakeCtx();
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(ctx);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue('user-1');
    await publishDictionaryUpsert(baseDict({ contentId: undefined }));
    expect(ctx.manager.markDirty).not.toHaveBeenCalled();
  });

  test('no-ops when user not authenticated', async () => {
    const ctx = makeFakeCtx();
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(ctx);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await publishDictionaryUpsert(baseDict());
    expect(ctx.manager.markDirty).not.toHaveBeenCalled();
  });

  test('builds + markDirty a kind=dictionary row keyed by contentId', async () => {
    const ctx = makeFakeCtx();
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(ctx);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue('user-1');
    const dict = baseDict({ name: 'Webster Concise', lang: 'en' });
    await publishDictionaryUpsert(dict);

    expect(ctx.manager.markDirty).toHaveBeenCalledOnce();
    const row = ctx.manager.markDirty.mock.calls[0]![0];
    expect(row.user_id).toBe('user-1');
    expect(row.kind).toBe('dictionary');
    expect(row.replica_id).toBe('content-hash-abc');
    expect(row.fields_jsonb['name']?.v).toBe('Webster Concise');
    expect(row.fields_jsonb['lang']?.v).toBe('en');
    expect(row.fields_jsonb['kind']?.v).toBe('mdict');
    expect(row.deleted_at_ts).toBe(null);
    expect(row.schema_version).toBe(1);
  });

  test('every field gets a fresh HLC stamp + deviceId', async () => {
    const ctx = makeFakeCtx();
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(ctx);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue('user-1');
    await publishDictionaryUpsert(baseDict());
    const row = ctx.manager.markDirty.mock.calls[0]![0] as ReplicaRow;
    for (const env of Object.values(row.fields_jsonb)) {
      expect(env.s).toBe(DEV);
      expect(env.t).toMatch(/^[0-9a-f]+-[0-9a-f]+-dev-a$/);
    }
  });

  test('updated_at_ts is the maximum of all field HLCs', async () => {
    const ctx = makeFakeCtx();
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(ctx);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue('user-1');
    await publishDictionaryUpsert(baseDict());
    const row = ctx.manager.markDirty.mock.calls[0]![0] as ReplicaRow;
    const fieldHlcs = Object.values(row.fields_jsonb).map((e) => e.t);
    const maxField = fieldHlcs.reduce((a, b) => (a > b ? a : b));
    expect(row.updated_at_ts >= maxField).toBe(true);
  });

  test('reincarnation field on the dict propagates to the row (revives a tombstoned row)', async () => {
    const ctx = makeFakeCtx();
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(ctx);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue('user-1');
    await publishDictionaryUpsert(baseDict({ reincarnation: 'epoch-1' }));
    const row = ctx.manager.markDirty.mock.calls[0]![0] as ReplicaRow;
    expect(row.reincarnation).toBe('epoch-1');
  });

  test('reincarnation defaults to null when absent on the dict (first import or live re-import)', async () => {
    const ctx = makeFakeCtx();
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(ctx);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue('user-1');
    await publishDictionaryUpsert(baseDict());
    const row = ctx.manager.markDirty.mock.calls[0]![0] as ReplicaRow;
    expect(row.reincarnation).toBe(null);
  });
});

describe('publishDictionaryDelete', () => {
  test('no-ops when replicaSync is not initialized', async () => {
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue('user-1');
    await publishDictionaryDelete('content-hash-abc');
  });

  test('no-ops when user not authenticated', async () => {
    const ctx = makeFakeCtx();
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(ctx);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await publishDictionaryDelete('content-hash-abc');
    expect(ctx.manager.markDirty).not.toHaveBeenCalled();
  });

  test('produces a tombstoned row (deleted_at_ts set)', async () => {
    const ctx = makeFakeCtx();
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(ctx);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue('user-1');
    await publishDictionaryDelete('content-hash-abc');
    expect(ctx.manager.markDirty).toHaveBeenCalledOnce();
    const row = ctx.manager.markDirty.mock.calls[0]![0];
    expect(row.replica_id).toBe('content-hash-abc');
    expect(row.kind).toBe('dictionary');
    expect(row.deleted_at_ts).not.toBe(null);
  });

  test('tombstone HLC matches updated_at_ts (remove-wins ordering)', async () => {
    const ctx = makeFakeCtx();
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(ctx);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue('user-1');
    await publishDictionaryDelete('content-hash-abc');
    const row = ctx.manager.markDirty.mock.calls[0]![0];
    expect(row.updated_at_ts).toBe(row.deleted_at_ts);
  });
});
describe('publishDictionaryManifest', () => {
  test('no-ops when replicaSync is not initialized', async () => {
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue('user-1');
    await publishDictionaryManifest('content-hash-abc', []);
  });

  test('no-ops when user not authenticated', async () => {
    const ctx = makeFakeCtx();
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(ctx);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await publishDictionaryManifest('content-hash-abc', []);
    expect(ctx.manager.markDirty).not.toHaveBeenCalled();
  });

  test('produces a row with manifest_jsonb populated and empty fields_jsonb', async () => {
    const ctx = makeFakeCtx();
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(ctx);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue('user-1');
    const files = [
      { filename: 'webster.mdx', byteSize: 1_000_000, partialMd5: 'abc123' },
      { filename: 'webster.mdd', byteSize: 5_000_000, partialMd5: 'def456' },
    ];
    await publishDictionaryManifest('content-hash-abc', files);
    expect(ctx.manager.markDirty).toHaveBeenCalledOnce();
    const row = ctx.manager.markDirty.mock.calls[0]![0] as ReplicaRow;
    expect(row.replica_id).toBe('content-hash-abc');
    expect(row.kind).toBe('dictionary');
    expect(row.manifest_jsonb).toEqual({ files, schemaVersion: 1 });
    expect(row.fields_jsonb).toEqual({});
    expect(row.deleted_at_ts).toBe(null);
  });

  test('manifest publish preserves reincarnation when provided', async () => {
    const ctx = makeFakeCtx();
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(ctx);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue('user-1');
    await publishDictionaryManifest('content-hash-abc', [], 'epoch-1');
    const row = ctx.manager.markDirty.mock.calls[0]![0] as ReplicaRow;
    expect(row.reincarnation).toBe('epoch-1');
  });

  test('manifest with no files is valid (e.g., metadata-only refresh)', async () => {
    const ctx = makeFakeCtx();
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(ctx);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue('user-1');
    await publishDictionaryManifest('content-hash-abc', []);
    const row = ctx.manager.markDirty.mock.calls[0]![0] as ReplicaRow;
    expect(row.manifest_jsonb?.files).toEqual([]);
  });
});

// Suppress unused import lint when running standalone
void hlcPack;
void ({} as Hlc);
