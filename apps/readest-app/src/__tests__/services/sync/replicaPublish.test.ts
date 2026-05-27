import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/utils/access', () => ({
  getUserID: vi.fn(),
}));

vi.mock('@/services/sync/replicaSync', () => ({
  getReplicaSync: vi.fn(),
}));

const cryptoMocks = vi.hoisted(() => ({
  isUnlocked: vi.fn(() => true),
  encryptField: vi.fn(async (v: string) => ({ v, kdf: 'mock' })),
}));

vi.mock('@/libs/crypto/session', () => ({
  cryptoSession: {
    isUnlocked: () => cryptoMocks.isUnlocked(),
    encryptField: (v: string) => cryptoMocks.encryptField(v),
    decryptField: vi.fn(),
    forget: vi.fn(),
  },
}));

import { getUserID } from '@/utils/access';
import { getReplicaSync } from '@/services/sync/replicaSync';
import {
  publishReplicaDelete,
  publishReplicaManifest,
  publishReplicaUpsert,
} from '@/services/sync/replicaPublish';
import { clearReplicaAdapters, registerReplicaAdapter } from '@/services/sync/replicaRegistry';
import { dictionaryAdapter } from '@/services/sync/adapters/dictionary';
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

const upsertDict = (dict: ImportedDictionary): Promise<void> =>
  publishReplicaUpsert('dictionary', dict, dict.contentId!, dict.reincarnation);

beforeEach(() => {
  vi.clearAllMocks();
  clearReplicaAdapters();
  registerReplicaAdapter(dictionaryAdapter);
});

afterEach(() => {
  vi.restoreAllMocks();
  clearReplicaAdapters();
});

describe('publishReplicaUpsert (dictionary adapter)', () => {
  test('no-ops when replicaSync is not initialized', async () => {
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue('user-1');
    await upsertDict(baseDict());
  });

  test('no-ops when no adapter registered for the kind', async () => {
    clearReplicaAdapters();
    const ctx = makeFakeCtx();
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(ctx);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue('user-1');
    await upsertDict(baseDict());
    expect(ctx.manager.markDirty).not.toHaveBeenCalled();
  });

  test('no-ops when user not authenticated', async () => {
    const ctx = makeFakeCtx();
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(ctx);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await upsertDict(baseDict());
    expect(ctx.manager.markDirty).not.toHaveBeenCalled();
  });

  test('builds + markDirty a kind=dictionary row keyed by contentId', async () => {
    const ctx = makeFakeCtx();
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(ctx);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue('user-1');
    const dict = baseDict({ name: 'Webster Concise', lang: 'en' });
    await upsertDict(dict);

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
    await upsertDict(baseDict());
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
    await upsertDict(baseDict());
    const row = ctx.manager.markDirty.mock.calls[0]![0] as ReplicaRow;
    const fieldHlcs = Object.values(row.fields_jsonb).map((e) => e.t);
    const maxField = fieldHlcs.reduce((a, b) => (a > b ? a : b));
    expect(row.updated_at_ts >= maxField).toBe(true);
  });

  test('reincarnation token propagates to the row (revives a tombstoned row)', async () => {
    const ctx = makeFakeCtx();
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(ctx);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue('user-1');
    await upsertDict(baseDict({ reincarnation: 'epoch-1' }));
    const row = ctx.manager.markDirty.mock.calls[0]![0] as ReplicaRow;
    expect(row.reincarnation).toBe('epoch-1');
  });

  test('reincarnation defaults to null when absent (first import or live re-import)', async () => {
    const ctx = makeFakeCtx();
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(ctx);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue('user-1');
    await upsertDict(baseDict());
    const row = ctx.manager.markDirty.mock.calls[0]![0] as ReplicaRow;
    expect(row.reincarnation).toBe(null);
  });
});

describe('publishReplicaDelete', () => {
  test('no-ops when replicaSync is not initialized', async () => {
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue('user-1');
    await publishReplicaDelete('dictionary', 'content-hash-abc');
  });

  test('no-ops when user not authenticated', async () => {
    const ctx = makeFakeCtx();
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(ctx);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await publishReplicaDelete('dictionary', 'content-hash-abc');
    expect(ctx.manager.markDirty).not.toHaveBeenCalled();
  });

  test('produces a tombstoned row (deleted_at_ts set)', async () => {
    const ctx = makeFakeCtx();
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(ctx);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue('user-1');
    await publishReplicaDelete('dictionary', 'content-hash-abc');
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
    await publishReplicaDelete('dictionary', 'content-hash-abc');
    const row = ctx.manager.markDirty.mock.calls[0]![0];
    expect(row.updated_at_ts).toBe(row.deleted_at_ts);
  });
});

describe('publishReplicaManifest', () => {
  test('no-ops when replicaSync is not initialized', async () => {
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue('user-1');
    await publishReplicaManifest('dictionary', 'content-hash-abc', []);
  });

  test('no-ops when user not authenticated', async () => {
    const ctx = makeFakeCtx();
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(ctx);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await publishReplicaManifest('dictionary', 'content-hash-abc', []);
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
    await publishReplicaManifest('dictionary', 'content-hash-abc', files);
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
    await publishReplicaManifest('dictionary', 'content-hash-abc', [], 'epoch-1');
    const row = ctx.manager.markDirty.mock.calls[0]![0] as ReplicaRow;
    expect(row.reincarnation).toBe('epoch-1');
  });

  test('manifest with no files is valid (e.g., metadata-only refresh)', async () => {
    const ctx = makeFakeCtx();
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(ctx);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue('user-1');
    await publishReplicaManifest('dictionary', 'content-hash-abc', []);
    const row = ctx.manager.markDirty.mock.calls[0]![0] as ReplicaRow;
    expect(row.manifest_jsonb?.files).toEqual([]);
  });
});

describe('publishReplica* sync category gate', () => {
  // When the user disables a category (e.g., dictionary) the publish
  // path is a silent no-op. The local store stays mutable; the data
  // just doesn't fan out to the server. Re-enabling resumes pushes
  // automatically — no manual flush required.
  const disableCategory = async (category: string): Promise<void> => {
    const { useSettingsStore } = await import('@/store/settingsStore');
    useSettingsStore.setState({
      settings: { syncCategories: { [category]: false } } as never,
    } as never);
  };

  const restoreCategories = async (): Promise<void> => {
    const { useSettingsStore } = await import('@/store/settingsStore');
    useSettingsStore.setState({ settings: undefined } as never);
  };

  afterEach(async () => {
    await restoreCategories();
  });

  test('publishReplicaUpsert is a no-op when its kind is disabled', async () => {
    await disableCategory('dictionary');
    const ctx = makeFakeCtx();
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(ctx);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue('user-1');
    await upsertDict(baseDict());
    expect(ctx.manager.markDirty).not.toHaveBeenCalled();
  });

  test('publishReplicaDelete is a no-op when its kind is disabled', async () => {
    await disableCategory('dictionary');
    const ctx = makeFakeCtx();
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(ctx);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue('user-1');
    await publishReplicaDelete('dictionary', 'content-hash-abc');
    expect(ctx.manager.markDirty).not.toHaveBeenCalled();
  });

  test('publishReplicaManifest is a no-op when its kind is disabled', async () => {
    await disableCategory('dictionary');
    const ctx = makeFakeCtx();
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(ctx);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue('user-1');
    await publishReplicaManifest('dictionary', 'content-hash-abc', []);
    expect(ctx.manager.markDirty).not.toHaveBeenCalled();
  });

  test('settings is force-enabled when dictionary is on (dependency cascade)', async () => {
    // settings: false but dictionary: true (the dependent) → settings
    // must still publish, otherwise dictionary cross-device sync breaks.
    const { useSettingsStore } = await import('@/store/settingsStore');
    useSettingsStore.setState({
      settings: { syncCategories: { settings: false, dictionary: true } } as never,
    } as never);
    const ctx = makeFakeCtx();
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(ctx);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue('user-1');
    const { settingsAdapter } = await import('@/services/sync/adapters/settings');
    registerReplicaAdapter(settingsAdapter);
    await publishReplicaUpsert('settings', { name: 'singleton', patch: {} }, 'singleton');
    expect(ctx.manager.markDirty).toHaveBeenCalled();
  });

  test('settings publish is gated when both settings AND its dependent (dictionary) are off', async () => {
    const { useSettingsStore } = await import('@/store/settingsStore');
    useSettingsStore.setState({
      settings: { syncCategories: { settings: false, dictionary: false } } as never,
    } as never);
    const ctx = makeFakeCtx();
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(ctx);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue('user-1');
    const { settingsAdapter } = await import('@/services/sync/adapters/settings');
    registerReplicaAdapter(settingsAdapter);
    await publishReplicaUpsert('settings', { name: 'singleton', patch: {} }, 'singleton');
    expect(ctx.manager.markDirty).not.toHaveBeenCalled();
  });
});

describe('publishReplicaUpsert credentials gate', () => {
  // The 'credentials' meta-toggle defaults OFF. When OFF, the publish
  // pipeline must drop adapter.encryptedFields from the packed row so
  // sensitive fields (OPDS username/password, kosync credentials,
  // readwise/hardcover tokens) never leave the device. Plaintext fields
  // (catalog name/url, etc.) still ship — the row itself isn't gated,
  // only its encrypted slots.
  const setCredentialsCategory = async (enabled: boolean | undefined): Promise<void> => {
    const { useSettingsStore } = await import('@/store/settingsStore');
    const map = enabled === undefined ? {} : { credentials: enabled };
    useSettingsStore.setState({
      settings: { syncCategories: map } as never,
    } as never);
  };

  const restoreSettings = async (): Promise<void> => {
    const { useSettingsStore } = await import('@/store/settingsStore');
    useSettingsStore.setState({ settings: undefined } as never);
  };

  afterEach(async () => {
    await restoreSettings();
    cryptoMocks.isUnlocked.mockReset();
    cryptoMocks.isUnlocked.mockReturnValue(true);
    cryptoMocks.encryptField.mockReset();
    cryptoMocks.encryptField.mockImplementation(async (v: string) => ({ v, kdf: 'mock' }));
  });

  test('drops encryptedFields from the packed row when credentials sync is OFF (default)', async () => {
    // No syncCategories map at all → credentials defaults OFF.
    await setCredentialsCategory(undefined);
    const { opdsCatalogAdapter } = await import('@/services/sync/adapters/opdsCatalog');
    registerReplicaAdapter(opdsCatalogAdapter);
    const ctx = makeFakeCtx();
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(ctx);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue('user-1');

    await publishReplicaUpsert(
      'opds_catalog',
      {
        id: 'cat-1',
        name: 'Project Gutenberg',
        url: 'https://example.com/opds',
        username: 'alice',
        password: 'hunter2',
      },
      'cat-content-id',
    );

    expect(ctx.manager.markDirty).toHaveBeenCalledOnce();
    const row = ctx.manager.markDirty.mock.calls[0]![0] as ReplicaRow;
    // Plaintext metadata still ships
    expect(row.fields_jsonb['name']?.v).toBe('Project Gutenberg');
    expect(row.fields_jsonb['url']?.v).toBe('https://example.com/opds');
    // Encrypted fields are dropped entirely (no plaintext leak, no cipher attempt)
    expect(row.fields_jsonb['username']).toBeUndefined();
    expect(row.fields_jsonb['password']).toBeUndefined();
    // Crypto session was never invoked — credentials OFF short-circuited
    // the field set before the middleware could even check unlock state.
    expect(cryptoMocks.encryptField).not.toHaveBeenCalled();
  });

  test('drops encryptedFields when credentials sync is explicitly disabled', async () => {
    await setCredentialsCategory(false);
    const { opdsCatalogAdapter } = await import('@/services/sync/adapters/opdsCatalog');
    registerReplicaAdapter(opdsCatalogAdapter);
    const ctx = makeFakeCtx();
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(ctx);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue('user-1');

    await publishReplicaUpsert(
      'opds_catalog',
      { id: 'cat-1', name: 'PG', url: 'u', username: 'alice', password: 'pw' },
      'cat-content-id',
    );

    const row = ctx.manager.markDirty.mock.calls[0]![0] as ReplicaRow;
    expect(row.fields_jsonb['username']).toBeUndefined();
    expect(row.fields_jsonb['password']).toBeUndefined();
  });

  test('encrypts the fields normally when credentials sync is ON', async () => {
    await setCredentialsCategory(true);
    const { opdsCatalogAdapter } = await import('@/services/sync/adapters/opdsCatalog');
    registerReplicaAdapter(opdsCatalogAdapter);
    const ctx = makeFakeCtx();
    (getReplicaSync as ReturnType<typeof vi.fn>).mockReturnValue(ctx);
    (getUserID as ReturnType<typeof vi.fn>).mockResolvedValue('user-1');

    await publishReplicaUpsert(
      'opds_catalog',
      { id: 'cat-1', name: 'PG', url: 'u', username: 'alice', password: 'pw' },
      'cat-content-id',
    );

    const row = ctx.manager.markDirty.mock.calls[0]![0] as ReplicaRow;
    // Encrypted slots present (cipher envelope shape from our mock)
    expect(row.fields_jsonb['username']?.v).toEqual({ v: 'alice', kdf: 'mock' });
    expect(row.fields_jsonb['password']?.v).toEqual({ v: 'pw', kdf: 'mock' });
    expect(cryptoMocks.encryptField).toHaveBeenCalledTimes(2);
  });
});

// Suppress unused import lint when running standalone
void hlcPack;
void ({} as Hlc);
