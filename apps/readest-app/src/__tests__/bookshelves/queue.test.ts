import { afterEach, expect, it, vi } from 'vitest';
import { HlcGenerator, hlcPack, hlcParse } from '@/libs/crdt';
import { createBookshelf } from '@/services/bookshelves/definitions';
import { ReplicaSyncManager } from '@/services/sync/replicaSyncManager';
import { __resetReplicaSyncForTests, initReplicaSync } from '@/services/sync/replicaSync';
import { journalBookshelfOperation, readPendingBookshelves } from '@/services/bookshelves/journal';
import { InMemoryHlcStore } from '@/libs/hlcStore';
import { __resetSettledEventsForTests } from '@/utils/event';
import type { Hlc, ReplicaRow } from '@/types/replica';

vi.mock('@/utils/access', () => ({ getUserID: async () => 'account' }));
vi.mock('@/services/sync/syncCategories', () => ({ isSyncCategoryEnabled: () => true }));

afterEach(() => {
  vi.useRealTimers();
  __resetReplicaSyncForTests();
  __resetSettledEventsForTests();
  localStorage.clear();
});
it('keeps pending built-in edits separate when accounts switch without restarting', async () => {
  vi.useFakeTimers();
  let account = 'account-a';
  const push = vi.fn().mockResolvedValue([]);
  const acknowledged = vi.fn();
  const hlc = new HlcGenerator('device');
  const manager = new ReplicaSyncManager({
    hlc,
    client: { push, pull: vi.fn(), pullBatch: vi.fn() },
    cursorStore: { get: () => null, set: vi.fn() },
    prepareRow: async (row) => (row.user_id === account ? row : null),
    onAcknowledged: acknowledged,
  });
  const row = (userId: string): ReplicaRow => {
    const t = hlc.next();
    return {
      user_id: userId,
      kind: 'bookshelf',
      replica_id: 'default',
      fields_jsonb: { definition: { v: createBookshelf(userId, 'default'), t, s: 'device' } },
      updated_at_ts: t,
      deleted_at_ts: null,
      manifest_jsonb: null,
      reincarnation: null,
      schema_version: 1,
    };
  };
  const first = row(account);
  manager.markDirty(first);
  account = 'account-b';
  const second = row(account);
  manager.markDirty(second);
  await manager.flush();
  expect(push).toHaveBeenLastCalledWith([second]);
  expect(acknowledged).toHaveBeenCalledExactlyOnceWith(second);
  account = 'account-a';
  await manager.flush();
  expect(push).toHaveBeenLastCalledWith([first]);
  expect(acknowledged).toHaveBeenLastCalledWith(first);
});
// The server rejects the whole batch when a row-level stamp is more than a
// minute off its clock, so a shelf edit journaled offline used to be refused on
// every retry for the rest of the install's life.
it('restamps a stale journaled edit at push time and settles its journal entry', async () => {
  const stale = hlcPack(Date.now() - 120_000, 0, 'device') as Hlc;
  const deletion: ReplicaRow = {
    user_id: 'account',
    kind: 'bookshelf',
    replica_id: '00000000-0000-4000-8000-000000000001',
    fields_jsonb: {
      definition: {
        v: createBookshelf('Custom', '00000000-0000-4000-8000-000000000001'),
        t: stale,
        s: 'device',
      },
    },
    updated_at_ts: stale,
    deleted_at_ts: stale,
    manifest_jsonb: null,
    reincarnation: null,
    schema_version: 1,
  };
  journalBookshelfOperation(deletion);
  const push = vi.fn(async (rows: ReplicaRow[]) => rows);
  const ctx = initReplicaSync({
    deviceId: 'device',
    cursorStore: { get: () => null, set: vi.fn() },
    hlcStore: new InMemoryHlcStore(),
    client: { push, pull: vi.fn(), pullBatch: vi.fn() } as never,
  });
  ctx.manager.markDirty(deletion);

  await ctx.manager.flush();

  const sent = push.mock.calls[0]![0]![0]!;
  expect(hlcParse(sent.updated_at_ts).physicalMs).toBeGreaterThan(
    hlcParse(stale).physicalMs + 60_000,
  );
  expect(sent.deleted_at_ts).toBe(sent.updated_at_ts);
  // Field envelopes keep their own stamps so LWW still orders by edit time.
  expect(sent.fields_jsonb['definition']!.t).toBe(stale);
  expect(readPendingBookshelves()).toEqual([]);
});
