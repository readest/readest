import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const cryptoMocks = vi.hoisted(() => ({
  isUnlocked: vi.fn(() => false),
  decryptField: vi.fn(),
}));
vi.mock('@/libs/crypto/session', () => ({
  cryptoSession: {
    isUnlocked: () => cryptoMocks.isUnlocked(),
    decryptField: (...args: unknown[]) => cryptoMocks.decryptField(...args),
    encryptField: vi.fn(),
    forget: vi.fn(),
  },
}));

const passphraseMocks = vi.hoisted(() => ({
  ensure: vi.fn(async () => {}),
}));
vi.mock('@/services/sync/passphraseGate', () => ({
  ensurePassphraseUnlocked: () => passphraseMocks.ensure(),
}));

import { replicaPullAndApply, type PullAndApplyDeps } from '@/services/sync/replicaPullAndApply';
import { dictionaryAdapter } from '@/services/sync/adapters/dictionary';
import { opdsCatalogAdapter } from '@/services/sync/adapters/opdsCatalog';
import { hlcPack } from '@/libs/crdt';
import type { CipherEnvelope, Hlc, Manifest, ReplicaRow } from '@/types/replica';
import type { ImportedDictionary } from '@/services/dictionaries/types';
import type { OPDSCatalog } from '@/types/opds';
import { useSettingsStore } from '@/store/settingsStore';
import type { SystemSettings } from '@/types/settings';

const NOW = 1_700_000_000_000;
const DEV = 'dev-a';

const baseRow = (overrides: Partial<ReplicaRow> = {}): ReplicaRow => ({
  user_id: 'u1',
  kind: 'dictionary',
  replica_id: 'content-hash-abc',
  fields_jsonb: {
    name: { v: 'Webster', t: hlcPack(NOW, 0, DEV) as Hlc, s: DEV },
    kind: { v: 'mdict', t: hlcPack(NOW, 1, DEV) as Hlc, s: DEV },
    addedAt: { v: NOW, t: hlcPack(NOW, 2, DEV) as Hlc, s: DEV },
  },
  manifest_jsonb: null,
  deleted_at_ts: null,
  reincarnation: null,
  updated_at_ts: hlcPack(NOW, 2, DEV) as Hlc,
  schema_version: 1,
  ...overrides,
});

const manifest = (filenames: string[]): Manifest => ({
  files: filenames.map((filename) => ({ filename, byteSize: 1, partialMd5: 'x' })),
  schemaVersion: 1,
});

const baseDict = (overrides: Partial<ImportedDictionary> = {}): ImportedDictionary => ({
  id: 'local-1',
  contentId: 'content-hash-abc',
  kind: 'mdict',
  name: 'Webster',
  bundleDir: 'local-1',
  files: { mdx: 'webster.mdx' },
  addedAt: NOW,
  ...overrides,
});

const makeDeps = () => {
  const findByContentId = vi.fn((_id: string): ImportedDictionary | undefined => undefined);
  const deps = {
    adapter: dictionaryAdapter,
    pull: vi.fn(async () => [] as ReplicaRow[]),
    findByContentId,
    applyRemote: vi.fn<(record: ImportedDictionary) => void>(),
    softDeleteByContentId: vi.fn(),
    createBundleDir: vi.fn(async () => 'fresh-bundle-dir-1'),
    queueReplicaDownload: vi.fn(() => 'transfer-id-1'),
    // Default: no files exist locally, so the orchestrator queues
    // downloads. Tests that exercise the "binaries already on disk"
    // path override this.
    filesExist: vi.fn(async () => false),
  } satisfies PullAndApplyDeps<ImportedDictionary>;
  return deps;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('replicaPullAndApply (dictionary adapter)', () => {
  test('no-op when pull returns no rows', async () => {
    const deps = makeDeps();
    await replicaPullAndApply(deps);
    expect(deps.applyRemote).not.toHaveBeenCalled();
    expect(deps.queueReplicaDownload).not.toHaveBeenCalled();
  });

  test('skips entirely (no pull) when isAuthenticated returns false', async () => {
    const deps = {
      ...makeDeps(),
      isAuthenticated: vi.fn(async () => false),
    } satisfies PullAndApplyDeps<ImportedDictionary>;
    await replicaPullAndApply(deps);
    expect(deps.isAuthenticated).toHaveBeenCalledOnce();
    expect(deps.pull).not.toHaveBeenCalled();
    expect(deps.applyRemote).not.toHaveBeenCalled();
    expect(deps.queueReplicaDownload).not.toHaveBeenCalled();
  });

  test('hydrateLocalStore runs before pull so applyRemote auto-persist does not wipe persisted entries', async () => {
    const order: string[] = [];
    const deps = {
      ...makeDeps(),
      hydrateLocalStore: vi.fn(async () => {
        order.push('hydrate');
      }),
    } satisfies PullAndApplyDeps<ImportedDictionary>;
    (deps.pull as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push('pull');
      return [];
    });
    await replicaPullAndApply(deps);
    expect(order).toEqual(['hydrate', 'pull']);
  });

  test('proceeds when isAuthenticated returns true', async () => {
    const row = baseRow({ manifest_jsonb: manifest(['x.mdx']) });
    const deps = {
      ...makeDeps(),
      isAuthenticated: vi.fn(async () => true),
    } satisfies PullAndApplyDeps<ImportedDictionary>;
    (deps.pull as ReturnType<typeof vi.fn>).mockResolvedValue([row]);
    (deps.findByContentId as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    await replicaPullAndApply(deps);
    expect(deps.pull).toHaveBeenCalledOnce();
    expect(deps.applyRemote).toHaveBeenCalledOnce();
  });

  test('alive-and-new row: creates bundle dir, applies dict, queues download', async () => {
    const row = baseRow({ manifest_jsonb: manifest(['webster.mdx', 'webster.mdd']) });
    const deps = makeDeps();
    (deps.pull as ReturnType<typeof vi.fn>).mockResolvedValue([row]);
    (deps.findByContentId as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    await replicaPullAndApply(deps);

    expect(deps.createBundleDir).toHaveBeenCalledOnce();
    expect(deps.applyRemote).toHaveBeenCalledOnce();
    const applied = (deps.applyRemote as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(applied.contentId).toBe('content-hash-abc');
    expect(applied.bundleDir).toBe('fresh-bundle-dir-1');
    expect(applied.unavailable).toBe(true);

    expect(deps.queueReplicaDownload).toHaveBeenCalledOnce();
    const downloadArgs = (deps.queueReplicaDownload as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(downloadArgs![0]).toBe('content-hash-abc');
    expect(downloadArgs![1]).toBe('Webster');
    expect(downloadArgs![2]).toEqual([
      { logical: 'webster.mdx', lfp: 'fresh-bundle-dir-1/webster.mdx', byteSize: 1 },
      { logical: 'webster.mdd', lfp: 'fresh-bundle-dir-1/webster.mdd', byteSize: 1 },
    ]);
    expect(downloadArgs![3]).toBe('fresh-bundle-dir-1');
  });

  test('alive-and-already-local WITHOUT manifest: queues local binary upload to repair the row', async () => {
    // Row exists on the server with manifest_jsonb=null — typically the
    // device that originally wrote the metadata never managed to upload
    // the binaries (e.g., TransferManager not ready, transient error).
    // On the next pull we reconcile by re-queuing the upload from the
    // device that owns the local copy.
    const row = baseRow({ manifest_jsonb: null });
    const local = baseDict();
    const queueLocalBinaryUpload = vi.fn<(record: ImportedDictionary) => Promise<void>>(
      async () => {},
    );
    const deps = {
      ...makeDeps(),
      queueLocalBinaryUpload,
    } satisfies PullAndApplyDeps<ImportedDictionary>;
    (deps.pull as ReturnType<typeof vi.fn>).mockResolvedValue([row]);
    (deps.findByContentId as ReturnType<typeof vi.fn>).mockReturnValue(local);

    await replicaPullAndApply(deps);

    expect(queueLocalBinaryUpload).toHaveBeenCalledOnce();
    expect(queueLocalBinaryUpload).toHaveBeenCalledWith(local);
    expect(deps.applyRemote).not.toHaveBeenCalled();
    expect(deps.queueReplicaDownload).not.toHaveBeenCalled();
  });

  test('alive-and-new-row WITHOUT manifest: does NOT queue an upload (no local copy)', async () => {
    // No local record → nothing to upload. The other device will
    // commit the manifest and we'll pick it up on a later pull.
    const row = baseRow({ manifest_jsonb: null });
    const queueLocalBinaryUpload = vi.fn<(record: ImportedDictionary) => Promise<void>>(
      async () => {},
    );
    const deps = {
      ...makeDeps(),
      queueLocalBinaryUpload,
    } satisfies PullAndApplyDeps<ImportedDictionary>;
    (deps.pull as ReturnType<typeof vi.fn>).mockResolvedValue([row]);
    (deps.findByContentId as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    await replicaPullAndApply(deps);

    expect(queueLocalBinaryUpload).not.toHaveBeenCalled();
    expect(deps.applyRemote).toHaveBeenCalledOnce();
  });

  test('alive-and-new row WITHOUT manifest: applies dict but skips download (binaries pending server-side)', async () => {
    const row = baseRow({ manifest_jsonb: null });
    const deps = makeDeps();
    (deps.pull as ReturnType<typeof vi.fn>).mockResolvedValue([row]);
    (deps.findByContentId as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    await replicaPullAndApply(deps);

    expect(deps.applyRemote).toHaveBeenCalledOnce();
    expect(deps.queueReplicaDownload).not.toHaveBeenCalled();
  });

  test('alive-and-already-local row WITH local binaries: does NOT re-create or re-download', async () => {
    const row = baseRow({ manifest_jsonb: manifest(['webster.mdx']) });
    const local = baseDict();
    const deps = makeDeps();
    (deps.pull as ReturnType<typeof vi.fn>).mockResolvedValue([row]);
    (deps.findByContentId as ReturnType<typeof vi.fn>).mockReturnValue(local);
    (deps.filesExist as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    await replicaPullAndApply(deps);

    expect(deps.createBundleDir).not.toHaveBeenCalled();
    expect(deps.applyRemote).not.toHaveBeenCalled();
    expect(deps.filesExist).toHaveBeenCalledWith('local-1', ['webster.mdx']);
    expect(deps.queueReplicaDownload).not.toHaveBeenCalled();
  });

  test('alive-and-already-local row WITH binaries missing: re-downloads into the existing bundleDir', async () => {
    const row = baseRow({ manifest_jsonb: manifest(['webster.mdx', 'webster.mdd']) });
    const local = baseDict();
    const deps = makeDeps();
    (deps.pull as ReturnType<typeof vi.fn>).mockResolvedValue([row]);
    (deps.findByContentId as ReturnType<typeof vi.fn>).mockReturnValue(local);
    // Default filesExist returns false → recovery path.

    await replicaPullAndApply(deps);

    expect(deps.createBundleDir).not.toHaveBeenCalled();
    expect(deps.applyRemote).not.toHaveBeenCalled();
    expect(deps.queueReplicaDownload).toHaveBeenCalledOnce();
    const downloadArgs = (deps.queueReplicaDownload as ReturnType<typeof vi.fn>).mock.calls[0];
    // bundleDir is the existing local entry's, NOT a fresh one.
    expect(downloadArgs![3]).toBe('local-1');
    expect(downloadArgs![2]).toEqual([
      { logical: 'webster.mdx', lfp: 'local-1/webster.mdx', byteSize: 1 },
      { logical: 'webster.mdd', lfp: 'local-1/webster.mdd', byteSize: 1 },
    ]);
  });

  test('alive-and-new row WITH binaries already on disk: applies but does NOT queue download', async () => {
    const row = baseRow({ manifest_jsonb: manifest(['webster.mdx']) });
    const deps = makeDeps();
    (deps.pull as ReturnType<typeof vi.fn>).mockResolvedValue([row]);
    (deps.findByContentId as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    (deps.filesExist as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    await replicaPullAndApply(deps);

    expect(deps.applyRemote).toHaveBeenCalledOnce();
    expect(deps.queueReplicaDownload).not.toHaveBeenCalled();
  });

  test('tombstoned row (no reincarnation): soft-delete the local entry if alive', async () => {
    const tombstone = hlcPack(NOW + 1000, 0, DEV) as Hlc;
    const row = baseRow({
      deleted_at_ts: tombstone,
      updated_at_ts: tombstone,
      reincarnation: null,
    });
    const local = baseDict();
    const deps = makeDeps();
    (deps.pull as ReturnType<typeof vi.fn>).mockResolvedValue([row]);
    (deps.findByContentId as ReturnType<typeof vi.fn>).mockReturnValue(local);

    await replicaPullAndApply(deps);

    expect(deps.softDeleteByContentId).toHaveBeenCalledWith('content-hash-abc');
    expect(deps.applyRemote).not.toHaveBeenCalled();
  });

  test('tombstoned row with no local entry: still invokes softDelete so the store can scrub provider-side state', async () => {
    // Device B fresh-install path: settings replica seeded
    // providerOrder/providerEnabled with a contentId that the dict
    // replica then arrived as tombstoned for. We need softDeleteByContentId
    // to fire so the dict store can clean those provider-side entries
    // even though there's no local record to flip a deletedAt flag on.
    const tombstone = hlcPack(NOW + 1000, 0, DEV) as Hlc;
    const row = baseRow({
      deleted_at_ts: tombstone,
      updated_at_ts: tombstone,
      reincarnation: null,
    });
    const deps = makeDeps();
    (deps.pull as ReturnType<typeof vi.fn>).mockResolvedValue([row]);
    (deps.findByContentId as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    await replicaPullAndApply(deps);

    expect(deps.softDeleteByContentId).toHaveBeenCalledWith('content-hash-abc');
    expect(deps.applyRemote).not.toHaveBeenCalled();
  });

  test('tombstoned row, local already soft-deleted: still invokes softDelete (lets store scrub stale provider state)', async () => {
    // Real-world bug: a re-pulled tombstone whose local entry is already
    // deletedAt would skip the softDelete call entirely, so any stale
    // providerOrder/providerEnabled entries (left behind by a prior
    // partial cleanup) never got pruned.
    const tombstone = hlcPack(NOW + 1000, 0, DEV) as Hlc;
    const row = baseRow({
      deleted_at_ts: tombstone,
      updated_at_ts: tombstone,
      reincarnation: null,
    });
    const local = baseDict({ deletedAt: NOW + 500 });
    const deps = makeDeps();
    (deps.pull as ReturnType<typeof vi.fn>).mockResolvedValue([row]);
    (deps.findByContentId as ReturnType<typeof vi.fn>).mockReturnValue(local);

    await replicaPullAndApply(deps);

    expect(deps.softDeleteByContentId).toHaveBeenCalledWith('content-hash-abc');
    expect(deps.applyRemote).not.toHaveBeenCalled();
  });

  test('reincarnated row (alive again): treated as alive — creates locally if absent', async () => {
    const tombstone = hlcPack(NOW, 0, DEV) as Hlc;
    const row = baseRow({
      deleted_at_ts: tombstone,
      reincarnation: 'epoch-1',
      manifest_jsonb: manifest(['webster.mdx']),
      updated_at_ts: hlcPack(NOW + 1000, 0, DEV) as Hlc,
    });
    const deps = makeDeps();
    (deps.pull as ReturnType<typeof vi.fn>).mockResolvedValue([row]);
    (deps.findByContentId as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    await replicaPullAndApply(deps);

    expect(deps.applyRemote).toHaveBeenCalledOnce();
    const applied = (deps.applyRemote as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(applied.reincarnation).toBe('epoch-1');
    expect(deps.queueReplicaDownload).toHaveBeenCalledOnce();
  });

  test('malformed row (missing kind): skipped, no apply, no download', async () => {
    const row = baseRow();
    delete (row.fields_jsonb as Record<string, unknown>)['kind'];
    const deps = makeDeps();
    (deps.pull as ReturnType<typeof vi.fn>).mockResolvedValue([row]);

    await replicaPullAndApply(deps);

    expect(deps.applyRemote).not.toHaveBeenCalled();
    expect(deps.queueReplicaDownload).not.toHaveBeenCalled();
  });

  test('multiple rows: each applied independently', async () => {
    const r1 = baseRow({
      replica_id: 'hash-A',
      fields_jsonb: {
        ...baseRow().fields_jsonb,
        name: { v: 'Dict A', t: hlcPack(NOW, 0, DEV) as Hlc, s: DEV },
      },
      manifest_jsonb: manifest(['a.mdx']),
    });
    const r2 = baseRow({
      replica_id: 'hash-B',
      fields_jsonb: {
        ...baseRow().fields_jsonb,
        name: { v: 'Dict B', t: hlcPack(NOW, 0, DEV) as Hlc, s: DEV },
      },
      manifest_jsonb: manifest(['b.mdx']),
    });
    const deps = makeDeps();
    (deps.pull as ReturnType<typeof vi.fn>).mockResolvedValue([r1, r2]);
    (deps.findByContentId as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    let bundleCounter = 0;
    (deps.createBundleDir as ReturnType<typeof vi.fn>).mockImplementation(
      async () => `bundle-${++bundleCounter}`,
    );

    await replicaPullAndApply(deps);

    expect(deps.applyRemote).toHaveBeenCalledTimes(2);
    expect(deps.queueReplicaDownload).toHaveBeenCalledTimes(2);
  });

  test('one malformed row does not block others', async () => {
    const goodRow = baseRow({ manifest_jsonb: manifest(['x.mdx']) });
    const badRow = baseRow({ replica_id: 'hash-bad' });
    delete (badRow.fields_jsonb as Record<string, unknown>)['kind'];
    const deps = makeDeps();
    (deps.pull as ReturnType<typeof vi.fn>).mockResolvedValue([badRow, goodRow]);
    (deps.findByContentId as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    await replicaPullAndApply(deps);

    expect(deps.applyRemote).toHaveBeenCalledOnce();
  });
});

describe('replicaPullAndApply credentials category gate (opds adapter)', () => {
  const cipher: CipherEnvelope = {
    c: 'CIPHERTEXT',
    i: 'IV',
    s: 'SALTID',
    alg: 'AES-GCM',
    h: 'INTEGRITY',
  };

  const setCredentialsCategory = (enabled: boolean | undefined): void => {
    const map = enabled === undefined ? {} : { credentials: enabled };
    useSettingsStore.setState({
      settings: { syncCategories: map } as never,
    } as never);
  };

  const opdsRow = (): ReplicaRow => ({
    user_id: 'u1',
    kind: 'opds_catalog',
    replica_id: 'opds-content-1',
    fields_jsonb: {
      name: { v: 'Project Gutenberg', t: hlcPack(NOW, 0, DEV) as Hlc, s: DEV },
      url: { v: 'https://example.com/opds', t: hlcPack(NOW, 1, DEV) as Hlc, s: DEV },
      // Cipher envelopes wrapped in CRDT field envelopes — same shape
      // the publish path emits when credentials sync is on.
      username: { v: cipher, t: hlcPack(NOW, 2, DEV) as Hlc, s: DEV },
      password: { v: cipher, t: hlcPack(NOW, 3, DEV) as Hlc, s: DEV },
    },
    manifest_jsonb: null,
    deleted_at_ts: null,
    reincarnation: null,
    updated_at_ts: hlcPack(NOW, 3, DEV) as Hlc,
    schema_version: 1,
  });

  const makeOpdsDeps = (): PullAndApplyDeps<OPDSCatalog> => {
    const findByContentId = vi.fn((_id: string): OPDSCatalog | undefined => undefined);
    return {
      adapter: opdsCatalogAdapter,
      pull: vi.fn(async () => [] as ReplicaRow[]),
      findByContentId,
      applyRemote: vi.fn<(record: OPDSCatalog) => void>(),
      softDeleteByContentId: vi.fn(),
      // Metadata-only kind — these are required by the type but unused here.
      createBundleDir: vi.fn(async () => ''),
      queueReplicaDownload: vi.fn(() => null),
      filesExist: vi.fn(async () => true),
    } satisfies PullAndApplyDeps<OPDSCatalog>;
  };

  beforeEach(() => {
    cryptoMocks.isUnlocked.mockReset();
    cryptoMocks.isUnlocked.mockReturnValue(false);
    cryptoMocks.decryptField.mockReset();
    passphraseMocks.ensure.mockReset();
    passphraseMocks.ensure.mockResolvedValue(undefined);
  });

  afterEach(() => {
    useSettingsStore.setState({ settings: undefined as unknown as SystemSettings } as never);
  });

  test('strips cipher fields and never prompts when credentials sync is OFF (default)', async () => {
    setCredentialsCategory(undefined); // default OFF
    const deps = makeOpdsDeps();
    (deps.pull as ReturnType<typeof vi.fn>).mockResolvedValue([opdsRow()]);

    await replicaPullAndApply(deps);

    // Plaintext metadata applied — the row itself isn't gated.
    expect(deps.applyRemote).toHaveBeenCalledOnce();
    const applied = (deps.applyRemote as ReturnType<typeof vi.fn>).mock.calls[0]![0] as OPDSCatalog;
    expect(applied.name).toBe('Project Gutenberg');
    expect(applied.url).toBe('https://example.com/opds');
    // Cipher payloads were stripped before unpack — no plaintext, no
    // ciphertext bleeds through to the local store.
    expect(applied.username).toBeUndefined();
    expect(applied.password).toBeUndefined();

    // Passphrase gate was NEVER prompted — there were no cipher fields
    // left to decrypt by the time captureCipherTexts ran.
    expect(passphraseMocks.ensure).not.toHaveBeenCalled();
    // Decrypt was NEVER attempted — credentials gate short-circuited
    // before the middleware ran.
    expect(cryptoMocks.decryptField).not.toHaveBeenCalled();
  });

  test('strips cipher fields when credentials sync is explicitly OFF', async () => {
    setCredentialsCategory(false);
    const deps = makeOpdsDeps();
    (deps.pull as ReturnType<typeof vi.fn>).mockResolvedValue([opdsRow()]);

    await replicaPullAndApply(deps);

    const applied = (deps.applyRemote as ReturnType<typeof vi.fn>).mock.calls[0]![0] as OPDSCatalog;
    expect(applied.username).toBeUndefined();
    expect(applied.password).toBeUndefined();
    expect(passphraseMocks.ensure).not.toHaveBeenCalled();
  });

  test('prompts and decrypts as before when credentials sync is ON', async () => {
    setCredentialsCategory(true);
    cryptoMocks.isUnlocked.mockReturnValue(false);
    // Simulate the gate flipping to unlocked after prompt.
    passphraseMocks.ensure.mockImplementation(async () => {
      cryptoMocks.isUnlocked.mockReturnValue(true);
    });
    cryptoMocks.decryptField.mockImplementation(async (env: unknown) => {
      // Pretend the username decrypts to 'alice' and the password to 'pw'.
      const c = (env as CipherEnvelope).c;
      return c === 'CIPHERTEXT' ? 'plain' : 'plain';
    });

    const deps = makeOpdsDeps();
    (deps.pull as ReturnType<typeof vi.fn>).mockResolvedValue([opdsRow()]);

    await replicaPullAndApply(deps);

    // Gate prompted (cipher present + locked + cipher fingerprint not seen).
    expect(passphraseMocks.ensure).toHaveBeenCalledTimes(1);
    expect(cryptoMocks.decryptField).toHaveBeenCalledTimes(2);
  });
});
