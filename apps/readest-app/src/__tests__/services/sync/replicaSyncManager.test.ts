import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { HlcGenerator, hlcPack } from '@/libs/crdt';
import { SyncError } from '@/libs/errors';
import { ReplicaSyncManager } from '@/services/sync/replicaSyncManager';
import type { Hlc, ReplicaRow } from '@/types/replica';

const NOW = 1_700_000_000_000;
const DEV = 'dev-a';
const HLC_NOW = hlcPack(NOW, 0, DEV) as Hlc;

const makeRow = (id: string, hlcStr: Hlc = HLC_NOW): ReplicaRow => ({
  user_id: 'u1',
  kind: 'dictionary',
  replica_id: id,
  fields_jsonb: { name: { v: id, t: hlcStr, s: DEV } },
  manifest_jsonb: null,
  deleted_at_ts: null,
  reincarnation: null,
  updated_at_ts: hlcStr,
  schema_version: 1,
});

const makeFakeClient = () => ({
  push: vi.fn(async (rows: ReplicaRow[]) => rows),
  pull: vi.fn(async (_kind: string, _since: Hlc | null) => [] as ReplicaRow[]),
  pullBatch: vi.fn(
    async (_cursors: { kind: string; since: Hlc | null }[]) =>
      [] as { kind: string; rows: ReplicaRow[] }[],
  ),
});

const makeManager = (clientOverrides: Partial<ReturnType<typeof makeFakeClient>> = {}) => {
  const client = { ...makeFakeClient(), ...clientOverrides };
  const hlc = new HlcGenerator(DEV, () => NOW);
  const cursors = new Map<string, Hlc>();
  const manager = new ReplicaSyncManager({
    hlc,
    client,
    debounceMs: 5000,
    cursorStore: {
      get: (k) => cursors.get(k) ?? null,
      set: (k, v) => {
        cursors.set(k, v);
      },
    },
  });
  return { manager, client, hlc, cursors };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ReplicaSyncManager.markDirty + flush', () => {
  test('markDirty alone does not push', async () => {
    const { manager, client } = makeManager();
    manager.markDirty(makeRow('r1'));
    await Promise.resolve();
    expect(client.push).not.toHaveBeenCalled();
  });

  test('markDirty then 5s debounce fires push', async () => {
    const { manager, client } = makeManager();
    manager.markDirty(makeRow('r1'));
    await vi.advanceTimersByTimeAsync(4999);
    expect(client.push).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(client.push).toHaveBeenCalledOnce();
    expect(client.push.mock.calls[0]![0]).toHaveLength(1);
  });

  test('successive markDirty resets the debounce window', async () => {
    const { manager, client } = makeManager();
    manager.markDirty(makeRow('r1'));
    await vi.advanceTimersByTimeAsync(4000);
    manager.markDirty(makeRow('r2'));
    await vi.advanceTimersByTimeAsync(4000);
    expect(client.push).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1100);
    expect(client.push).toHaveBeenCalledOnce();
    expect(client.push.mock.calls[0]![0]).toHaveLength(2);
  });

  test('flush() pushes immediately', async () => {
    const { manager, client } = makeManager();
    manager.markDirty(makeRow('r1'));
    manager.markDirty(makeRow('r2'));
    await manager.flush();
    expect(client.push).toHaveBeenCalledOnce();
    expect(client.push.mock.calls[0]![0]).toHaveLength(2);
  });

  test('flush() with no dirty rows is a no-op', async () => {
    const { manager, client } = makeManager();
    await manager.flush();
    expect(client.push).not.toHaveBeenCalled();
  });

  test('same replica re-marked dirty: only the latest row pushes', async () => {
    const { manager, client } = makeManager();
    manager.markDirty(makeRow('r1', hlcPack(NOW, 0, DEV) as Hlc));
    manager.markDirty(makeRow('r1', hlcPack(NOW, 1, DEV) as Hlc));
    await manager.flush();
    const pushed = client.push.mock.calls[0]![0];
    expect(pushed).toHaveLength(1);
    expect(pushed[0]!.fields_jsonb['name']!.t).toBe(hlcPack(NOW, 1, DEV));
  });

  test('same replica metadata + manifest rows coalesce before push', async () => {
    const { manager, client } = makeManager();
    const fieldsHlc = hlcPack(NOW, 0, DEV) as Hlc;
    const manifestHlc = hlcPack(NOW, 1, DEV) as Hlc;
    manager.markDirty(makeRow('r1', fieldsHlc));
    manager.markDirty({
      ...makeRow('r1', manifestHlc),
      fields_jsonb: {},
      manifest_jsonb: {
        schemaVersion: 1,
        files: [{ filename: 'webster.mdx', byteSize: 1000, partialMd5: 'a'.repeat(32) }],
      },
      reincarnation: 'epoch-1',
    });

    await manager.flush();

    const pushed = client.push.mock.calls[0]![0];
    expect(pushed).toHaveLength(1);
    expect(pushed[0]!.fields_jsonb['name']?.v).toBe('r1');
    expect(pushed[0]!.manifest_jsonb?.files).toHaveLength(1);
    expect(pushed[0]!.reincarnation).toBe('epoch-1');
    expect(pushed[0]!.updated_at_ts).toBe(manifestHlc);
  });

  test('coalescing metadata after manifest preserves the manifest', async () => {
    const { manager, client } = makeManager();
    const manifestHlc = hlcPack(NOW, 0, DEV) as Hlc;
    const metadataHlc = hlcPack(NOW, 1, DEV) as Hlc;
    manager.markDirty({
      ...makeRow('r1', manifestHlc),
      manifest_jsonb: {
        schemaVersion: 1,
        files: [{ filename: 'webster.mdx', byteSize: 1000, partialMd5: 'a'.repeat(32) }],
      },
    });
    manager.markDirty({
      ...makeRow('r1', metadataHlc),
      fields_jsonb: { name: { v: 'Renamed', t: metadataHlc, s: DEV } },
      manifest_jsonb: null,
    });

    await manager.flush();

    const pushed = client.push.mock.calls[0]![0];
    expect(pushed[0]!.fields_jsonb['name']?.v).toBe('Renamed');
    expect(pushed[0]!.manifest_jsonb?.files).toHaveLength(1);
    expect(pushed[0]!.updated_at_ts).toBe(metadataHlc);
  });

  test('coalescing metadata with null reincarnation stays null when no token exists', async () => {
    const { manager, client } = makeManager();
    const revivedHlc = hlcPack(NOW, 0, DEV) as Hlc;
    const metadataHlc = hlcPack(NOW, 1, DEV) as Hlc;
    manager.markDirty(makeRow('r1', revivedHlc));
    manager.markDirty({
      ...makeRow('r1', metadataHlc),
      fields_jsonb: { name: { v: 'Renamed', t: metadataHlc, s: DEV } },
      reincarnation: null,
    });

    await manager.flush();

    const pushed = client.push.mock.calls[0]![0];
    expect(pushed[0]!.fields_jsonb['name']?.v).toBe('Renamed');
    expect(pushed[0]!.reincarnation).toBe(null);
  });

  test('coalescing metadata after a reincarnated row preserves the token', async () => {
    const { manager, client } = makeManager();
    const revivedHlc = hlcPack(NOW, 0, DEV) as Hlc;
    const metadataHlc = hlcPack(NOW, 1, DEV) as Hlc;
    manager.markDirty({ ...makeRow('r1', revivedHlc), reincarnation: 'epoch-1' });
    manager.markDirty({
      ...makeRow('r1', metadataHlc),
      fields_jsonb: { name: { v: 'Renamed', t: metadataHlc, s: DEV } },
      reincarnation: null,
    });

    await manager.flush();

    const pushed = client.push.mock.calls[0]![0];
    expect(pushed[0]!.fields_jsonb['name']?.v).toBe('Renamed');
    expect(pushed[0]!.reincarnation).toBe('epoch-1');
  });

  test('flush() clears the dirty set on success', async () => {
    const { manager, client } = makeManager();
    manager.markDirty(makeRow('r1'));
    await manager.flush();
    expect(client.push).toHaveBeenCalledOnce();
    await manager.flush();
    expect(client.push).toHaveBeenCalledOnce();
  });

  test('push rejection: dirty set is preserved for retry', async () => {
    const client = {
      ...makeFakeClient(),
      push: vi.fn(async (_rows: ReplicaRow[]): Promise<ReplicaRow[]> => {
        throw new SyncError('SERVER', 'simulated outage');
      }),
    };
    const { manager } = makeManager(client);
    manager.markDirty(makeRow('r1'));
    await expect(manager.flush()).rejects.toThrow(/simulated outage/);
    client.push.mockResolvedValueOnce([makeRow('r1')]);
    await manager.flush();
    expect(client.push).toHaveBeenCalledTimes(2);
  });

  // A backend whose kind allowlist predates this client 422s the WHOLE push
  // when a single row carries an unknown kind. The queue is only cleared on
  // success, so without per-kind isolation that one row wedges every other
  // kind's writes for the rest of the session.
  test('UNKNOWN_KIND push: known kinds still land, the unknown kind stays queued', async () => {
    const known = makeRow('r1');
    const unknown = { ...makeRow('r2'), kind: 'abs_server' };
    const client = {
      ...makeFakeClient(),
      push: vi.fn(async (rows: ReplicaRow[]): Promise<ReplicaRow[]> => {
        if (rows.some((r) => r.kind === 'abs_server')) {
          throw new SyncError('UNKNOWN_KIND', 'kind=abs_server is not in the server allowlist', {
            status: 422,
          });
        }
        return rows;
      }),
    };
    const { manager } = makeManager(client);
    manager.markDirty(known);
    manager.markDirty(unknown);

    await manager.flush();

    // Batch attempt + one retry per kind.
    const pushedKinds = client.push.mock.calls.map((call) => call[0]!.map((r) => r.kind));
    expect(pushedKinds).toContainEqual(['dictionary']);
    expect(manager.pendingKeys()).toEqual([{ kind: 'abs_server', replicaId: 'r2' }]);

    // The rejected kind is dropped from later batches, so it can never
    // poison another push.
    client.push.mockClear();
    manager.markDirty(makeRow('r3'));
    await manager.flush();
    expect(client.push).toHaveBeenCalledOnce();
    expect(client.push.mock.calls[0]![0]!.map((r) => r.kind)).toEqual(['dictionary']);
  });
});

describe('ReplicaSyncManager.pull', () => {
  test('passes cursor + advances on success', async () => {
    const r1 = makeRow('r1', hlcPack(NOW + 100, 0, DEV) as Hlc);
    const r2 = makeRow('r2', hlcPack(NOW + 200, 0, DEV) as Hlc);
    const client = {
      ...makeFakeClient(),
      pull: vi.fn(async () => [r1, r2]),
    };
    const { manager, cursors } = makeManager(client);
    const result = await manager.pull('dictionary');
    expect(result).toEqual([r1, r2]);
    expect(client.pull).toHaveBeenCalledWith('dictionary', null);
    expect(cursors.get('dictionary')).toBe(r2.updated_at_ts);
  });

  test('subsequent pull uses advanced cursor', async () => {
    const r1 = makeRow('r1', hlcPack(NOW + 100, 0, DEV) as Hlc);
    const client = {
      ...makeFakeClient(),
      pull: vi.fn().mockResolvedValueOnce([r1]).mockResolvedValueOnce([]),
    };
    const { manager } = makeManager(client);
    await manager.pull('dictionary');
    await manager.pull('dictionary');
    expect(client.pull).toHaveBeenNthCalledWith(2, 'dictionary', r1.updated_at_ts);
  });

  test('pull observes remote HLCs into local generator', async () => {
    const remoteHlc = hlcPack(NOW + 60_000, 7, 'dev-other') as Hlc;
    const client = {
      ...makeFakeClient(),
      pull: vi.fn(async () => [makeRow('r1', remoteHlc)]),
    };
    const { manager, hlc } = makeManager(client);
    await manager.pull('dictionary');
    const next = hlc.next();
    expect(next > remoteHlc).toBe(true);
  });

  test('empty pull does not advance cursor', async () => {
    const client = {
      ...makeFakeClient(),
      pull: vi.fn(async () => []),
    };
    const { manager, cursors } = makeManager(client);
    await manager.pull('dictionary');
    expect(cursors.get('dictionary')).toBeUndefined();
  });

  test('pull with { since: null } bypasses an existing cursor', async () => {
    const r1 = makeRow('r1', hlcPack(NOW + 100, 0, DEV) as Hlc);
    const client = {
      ...makeFakeClient(),
      pull: vi.fn().mockResolvedValueOnce([r1]).mockResolvedValueOnce([r1]),
    };
    const { manager } = makeManager(client);
    await manager.pull('dictionary');
    // After the first pull, the cursor is at r1.updated_at_ts. A normal
    // second pull would pass that cursor; the boot pull explicitly
    // requests since=null to do a full re-sync.
    await manager.pull('dictionary', { since: null });
    expect(client.pull).toHaveBeenNthCalledWith(2, 'dictionary', null);
  });

  test('full pull still advances the cursor when rows arrive', async () => {
    const r1 = makeRow('r1', hlcPack(NOW + 100, 0, DEV) as Hlc);
    const r2 = makeRow('r2', hlcPack(NOW + 200, 0, DEV) as Hlc);
    const client = {
      ...makeFakeClient(),
      pull: vi.fn(async () => [r1, r2]),
    };
    const { manager, cursors } = makeManager(client);
    await manager.pull('dictionary', { since: null });
    expect(cursors.get('dictionary')).toBe(r2.updated_at_ts);
  });
});

describe('ReplicaSyncManager.pullMany (batched incremental)', () => {
  test("one pullBatch round-trip per call, with each kind's persisted cursor", async () => {
    // Seed cursors so we can verify each kind\'s cursor reaches the
    // batched request — this is the core saving over per-kind GETs.
    const dictCursor = hlcPack(NOW + 50, 0, DEV) as Hlc;
    const fontCursor = hlcPack(NOW + 60, 0, DEV) as Hlc;
    const client = makeFakeClient();
    const { manager, cursors } = makeManager(client);
    cursors.set('dictionary', dictCursor);
    cursors.set('font', fontCursor);
    // texture has no cursor yet — should arrive as null (initial pull).

    await manager.pullMany(['dictionary', 'font', 'texture']);

    expect(client.pullBatch).toHaveBeenCalledTimes(1);
    expect(client.pull).not.toHaveBeenCalled();
    const cursorsArg = client.pullBatch.mock.calls[0]![0];
    expect(cursorsArg).toEqual([
      { kind: 'dictionary', since: dictCursor },
      { kind: 'font', since: fontCursor },
      { kind: 'texture', since: null },
    ]);
  });

  test("advances each kind's cursor independently from its own rows", async () => {
    const dictRow = makeRow('d1', hlcPack(NOW + 1000, 0, DEV) as Hlc);
    const fontRow = makeRow('f1', hlcPack(NOW + 2000, 0, DEV) as Hlc);
    const client = {
      ...makeFakeClient(),
      pullBatch: vi.fn(async () => [
        { kind: 'dictionary', rows: [dictRow] as ReplicaRow[] },
        { kind: 'font', rows: [fontRow] as ReplicaRow[] },
        { kind: 'texture', rows: [] as ReplicaRow[] },
      ]),
    };
    const { manager, cursors } = makeManager(client);
    const result = await manager.pullMany(['dictionary', 'font', 'texture']);

    expect(cursors.get('dictionary')).toBe(dictRow.updated_at_ts);
    expect(cursors.get('font')).toBe(fontRow.updated_at_ts);
    // Empty result must NOT advance the cursor (would skip future rows).
    expect(cursors.get('texture')).toBeUndefined();

    // Returned map covers every requested kind, including empty ones.
    expect(result.get('dictionary')).toEqual([dictRow]);
    expect(result.get('font')).toEqual([fontRow]);
    expect(result.get('texture')).toEqual([]);
  });

  test('observes remote HLCs into the local generator (cross-device clock)', async () => {
    const remoteHlc = hlcPack(NOW + 90_000, 3, 'dev-other') as Hlc;
    const client = {
      ...makeFakeClient(),
      pullBatch: vi.fn(async () => [
        { kind: 'dictionary', rows: [makeRow('r1', remoteHlc)] as ReplicaRow[] },
      ]),
    };
    const { manager, hlc } = makeManager(client);
    await manager.pullMany(['dictionary']);
    const next = hlc.next();
    // Local generator must be ahead of the observed remote stamp.
    expect(next > remoteHlc).toBe(true);
  });

  test('empty kinds list short-circuits without hitting the wire', async () => {
    const client = makeFakeClient();
    const { manager } = makeManager(client);
    const result = await manager.pullMany([]);
    expect(result.size).toBe(0);
    expect(client.pullBatch).not.toHaveBeenCalled();
  });

  // One kind the backend's allowlist predates 422s the entire batched pull,
  // which used to take every OTHER kind's sync down with it (the caller
  // bails on the rejection). Fall back to per-kind pulls so the known kinds
  // still land, and remember the offender.
  test('UNKNOWN_KIND batch: falls back per kind and omits the rejected kind', async () => {
    const dictRow = makeRow('d1');
    const client = {
      ...makeFakeClient(),
      pullBatch: vi.fn(
        async (
          _cursors: { kind: string; since: Hlc | null }[],
        ): Promise<{ kind: string; rows: ReplicaRow[] }[]> => {
          throw new SyncError('UNKNOWN_KIND', 'cursors[1].kind=abs_server', { status: 422 });
        },
      ),
      pull: vi.fn(async (kind: string, _since: Hlc | null) => {
        if (kind === 'abs_server') {
          throw new SyncError('UNKNOWN_KIND', 'kind=abs_server', { status: 422 });
        }
        return [dictRow] as ReplicaRow[];
      }),
    };
    const { manager } = makeManager(client);

    const result = await manager.pullMany(['dictionary', 'abs_server']);

    expect(result.get('dictionary')).toEqual([dictRow]);
    // Absent, NOT an empty array: the backend told us nothing about this
    // kind, which must never read as "the server has no rows".
    expect(result.has('abs_server')).toBe(false);

    // Later batches route around the rejected kind entirely.
    client.pullBatch.mockClear();
    client.pullBatch.mockResolvedValue([{ kind: 'dictionary', rows: [] as ReplicaRow[] }]);
    await manager.pullMany(['dictionary', 'abs_server']);
    expect(client.pullBatch).toHaveBeenCalledOnce();
    expect(client.pullBatch.mock.calls[0]![0]!.map((c) => c.kind)).toEqual(['dictionary']);
  });
});
