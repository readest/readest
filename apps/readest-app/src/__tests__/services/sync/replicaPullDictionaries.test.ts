import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  pullDictionariesAndApply,
  type PullDictionariesDeps,
} from '@/services/sync/replicaPullDictionaries';
import { hlcPack } from '@/libs/crdt';
import type { Hlc, Manifest, ReplicaRow } from '@/types/replica';
import type { ImportedDictionary } from '@/services/dictionaries/types';

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
    pull: vi.fn(async () => [] as ReplicaRow[]),
    findByContentId,
    applyRemoteDictionary: vi.fn(),
    softDeleteByContentId: vi.fn(),
    createBundleDir: vi.fn(async () => 'fresh-bundle-dir-1'),
    queueReplicaDownload: vi.fn(() => 'transfer-id-1'),
    // Default: no files exist locally, so the orchestrator queues
    // downloads. Tests that exercise the "binaries already on disk"
    // path override this.
    filesExist: vi.fn(async () => false),
  } satisfies PullDictionariesDeps;
  return deps;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pullDictionariesAndApply', () => {
  test('no-op when pull returns no rows', async () => {
    const deps = makeDeps();
    await pullDictionariesAndApply(deps);
    expect(deps.applyRemoteDictionary).not.toHaveBeenCalled();
    expect(deps.queueReplicaDownload).not.toHaveBeenCalled();
  });

  test('skips entirely (no pull) when isAuthenticated returns false', async () => {
    const deps = {
      ...makeDeps(),
      isAuthenticated: vi.fn(async () => false),
    } satisfies PullDictionariesDeps;
    await pullDictionariesAndApply(deps);
    expect(deps.isAuthenticated).toHaveBeenCalledOnce();
    expect(deps.pull).not.toHaveBeenCalled();
    expect(deps.applyRemoteDictionary).not.toHaveBeenCalled();
    expect(deps.queueReplicaDownload).not.toHaveBeenCalled();
  });

  test('hydrateLocalStore runs before pull so applyRemoteDictionary auto-persist does not wipe persisted entries', async () => {
    const order: string[] = [];
    const deps = {
      ...makeDeps(),
      hydrateLocalStore: vi.fn(async () => {
        order.push('hydrate');
      }),
    } satisfies PullDictionariesDeps;
    (deps.pull as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push('pull');
      return [];
    });
    await pullDictionariesAndApply(deps);
    expect(order).toEqual(['hydrate', 'pull']);
  });

  test('proceeds when isAuthenticated returns true', async () => {
    const row = baseRow({ manifest_jsonb: manifest(['x.mdx']) });
    const deps = {
      ...makeDeps(),
      isAuthenticated: vi.fn(async () => true),
    } satisfies PullDictionariesDeps;
    (deps.pull as ReturnType<typeof vi.fn>).mockResolvedValue([row]);
    (deps.findByContentId as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    await pullDictionariesAndApply(deps);
    expect(deps.pull).toHaveBeenCalledOnce();
    expect(deps.applyRemoteDictionary).toHaveBeenCalledOnce();
  });

  test('alive-and-new row: creates bundle dir, applies dict, queues download', async () => {
    const row = baseRow({ manifest_jsonb: manifest(['webster.mdx', 'webster.mdd']) });
    const deps = makeDeps();
    (deps.pull as ReturnType<typeof vi.fn>).mockResolvedValue([row]);
    (deps.findByContentId as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    await pullDictionariesAndApply(deps);

    expect(deps.createBundleDir).toHaveBeenCalledOnce();
    expect(deps.applyRemoteDictionary).toHaveBeenCalledOnce();
    const applied = (deps.applyRemoteDictionary as ReturnType<typeof vi.fn>).mock.calls[0]![0];
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

  test('alive-and-new row WITHOUT manifest: applies dict but skips download (binaries pending server-side)', async () => {
    const row = baseRow({ manifest_jsonb: null });
    const deps = makeDeps();
    (deps.pull as ReturnType<typeof vi.fn>).mockResolvedValue([row]);
    (deps.findByContentId as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    await pullDictionariesAndApply(deps);

    expect(deps.applyRemoteDictionary).toHaveBeenCalledOnce();
    expect(deps.queueReplicaDownload).not.toHaveBeenCalled();
  });

  test('alive-and-already-local row WITH local binaries: does NOT re-create or re-download', async () => {
    const row = baseRow({ manifest_jsonb: manifest(['webster.mdx']) });
    const local = baseDict();
    const deps = makeDeps();
    (deps.pull as ReturnType<typeof vi.fn>).mockResolvedValue([row]);
    (deps.findByContentId as ReturnType<typeof vi.fn>).mockReturnValue(local);
    (deps.filesExist as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    await pullDictionariesAndApply(deps);

    expect(deps.createBundleDir).not.toHaveBeenCalled();
    expect(deps.applyRemoteDictionary).not.toHaveBeenCalled();
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

    await pullDictionariesAndApply(deps);

    expect(deps.createBundleDir).not.toHaveBeenCalled();
    expect(deps.applyRemoteDictionary).not.toHaveBeenCalled();
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

    await pullDictionariesAndApply(deps);

    expect(deps.applyRemoteDictionary).toHaveBeenCalledOnce();
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

    await pullDictionariesAndApply(deps);

    expect(deps.softDeleteByContentId).toHaveBeenCalledWith('content-hash-abc');
    expect(deps.applyRemoteDictionary).not.toHaveBeenCalled();
  });

  test('tombstoned row already gone locally: no-op (idempotent)', async () => {
    const tombstone = hlcPack(NOW + 1000, 0, DEV) as Hlc;
    const row = baseRow({
      deleted_at_ts: tombstone,
      updated_at_ts: tombstone,
      reincarnation: null,
    });
    const deps = makeDeps();
    (deps.pull as ReturnType<typeof vi.fn>).mockResolvedValue([row]);
    (deps.findByContentId as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    await pullDictionariesAndApply(deps);

    expect(deps.softDeleteByContentId).not.toHaveBeenCalled();
    expect(deps.applyRemoteDictionary).not.toHaveBeenCalled();
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

    await pullDictionariesAndApply(deps);

    expect(deps.applyRemoteDictionary).toHaveBeenCalledOnce();
    const applied = (deps.applyRemoteDictionary as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(applied.reincarnation).toBe('epoch-1');
    expect(deps.queueReplicaDownload).toHaveBeenCalledOnce();
  });

  test('malformed row (missing kind): skipped, no apply, no download', async () => {
    const row = baseRow();
    delete (row.fields_jsonb as Record<string, unknown>)['kind'];
    const deps = makeDeps();
    (deps.pull as ReturnType<typeof vi.fn>).mockResolvedValue([row]);

    await pullDictionariesAndApply(deps);

    expect(deps.applyRemoteDictionary).not.toHaveBeenCalled();
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

    await pullDictionariesAndApply(deps);

    expect(deps.applyRemoteDictionary).toHaveBeenCalledTimes(2);
    expect(deps.queueReplicaDownload).toHaveBeenCalledTimes(2);
  });

  test('one malformed row does not block others', async () => {
    const goodRow = baseRow({ manifest_jsonb: manifest(['x.mdx']) });
    const badRow = baseRow({ replica_id: 'hash-bad' });
    delete (badRow.fields_jsonb as Record<string, unknown>)['kind'];
    const deps = makeDeps();
    (deps.pull as ReturnType<typeof vi.fn>).mockResolvedValue([badRow, goodRow]);
    (deps.findByContentId as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    await pullDictionariesAndApply(deps);

    expect(deps.applyRemoteDictionary).toHaveBeenCalledOnce();
  });
});
