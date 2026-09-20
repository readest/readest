import { afterEach, expect, it, vi } from 'vitest';
import { HlcGenerator } from '@/libs/crdt';
import { createBookshelf } from '@/services/bookshelves/definitions';
import { ReplicaSyncManager } from '@/services/sync/replicaSyncManager';
import type { ReplicaRow } from '@/types/replica';

afterEach(() => vi.useRealTimers());
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
    canPushRow: async (row) => row.user_id === account,
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
