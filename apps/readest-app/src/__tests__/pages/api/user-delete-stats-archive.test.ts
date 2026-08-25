import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// DELETE /api/user/delete must also remove the user's reading-statistics
// archive objects in R2 (stats/v1/{user_id}/...). Postgres rows cascade with
// the auth user; R2 objects do not. Order: (1) queue the user id in
// stat_archive_orphans as a durable tombstone (500 before anything destructive
// if even that fails), (2) delete the identity (compensating the tombstone if
// that fails; the compaction sweep also skips living users), (3) delete the
// prefix immediately, best-effort; the tombstone makes the cleanup reliable.

const deleteUserMock = vi.fn();
const orphanUpsertMock = vi.fn();
const orphanDeleteEqMock = vi.fn();
vi.mock('@/utils/cors', () => ({
  corsAllMethods: {},
  runMiddleware: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: vi.fn().mockResolvedValue({ user: { id: 'u1' }, token: 'tok' }),
}));
vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({
    auth: { admin: { deleteUser: deleteUserMock } },
    from: (table: string) => ({
      upsert: (...a: unknown[]) => orphanUpsertMock(table, ...a),
      delete: () => ({ eq: (...a: unknown[]) => orphanDeleteEqMock(table, ...a) }),
    }),
  }),
}));
let cfEnv: Record<string, unknown> = {};
vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => ({ env: cfEnv }),
}));

import handler from '@/pages/api/user/delete';

const bucket = { get: vi.fn(), put: vi.fn(), list: vi.fn(), delete: vi.fn() };
const events: string[] = [];

const call = async () => {
  const req = {
    method: 'DELETE',
    headers: { authorization: 'Bearer tok' },
  } as unknown as NextApiRequest;
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  await handler(req, res as unknown as NextApiResponse);
  return res;
};

beforeEach(() => {
  events.length = 0;
  deleteUserMock.mockReset().mockImplementation(async () => {
    events.push('deleteUser');
    return { error: null };
  });
  orphanUpsertMock.mockReset().mockImplementation(async (table: string) => {
    events.push(`queue:${table}`);
    return { error: null };
  });
  orphanDeleteEqMock.mockReset().mockImplementation(async (table: string) => {
    events.push(`unqueue:${table}`);
    return { error: null };
  });
  bucket.list.mockReset().mockResolvedValue({ objects: [], truncated: false });
  bucket.delete.mockReset().mockImplementation(async (keys: string[]) => {
    events.push(`delete:${keys.join(',')}`);
  });
  cfEnv = { STATS_ARCHIVE_R2: bucket };
});

describe('DELETE /api/user/delete stats archive cleanup', () => {
  it('queues the tombstone, deletes the user, then deletes the prefix (paginated listing)', async () => {
    bucket.list
      .mockResolvedValueOnce({
        objects: [{ key: 'stats/v1/u1/1.json' }, { key: 'stats/v1/u1/2.json' }],
        truncated: true,
        cursor: 'c1',
      })
      .mockResolvedValueOnce({ objects: [{ key: 'stats/v1/u1/3.json' }], truncated: false });

    const res = await call();
    expect(res.statusCode).toBe(200);
    expect(events).toEqual([
      'queue:stat_archive_orphans',
      'deleteUser',
      'delete:stats/v1/u1/1.json,stats/v1/u1/2.json',
      'delete:stats/v1/u1/3.json',
    ]);
    expect(orphanUpsertMock).toHaveBeenCalledWith(
      'stat_archive_orphans',
      { user_id: 'u1' },
      { onConflict: 'user_id' },
    );
    expect(bucket.list.mock.calls[0]![0]).toMatchObject({ prefix: 'stats/v1/u1/' });
    expect(bucket.list.mock.calls[1]![0]).toMatchObject({ prefix: 'stats/v1/u1/', cursor: 'c1' });
  });

  it('stops with 500 before deleting anything when the tombstone cannot be written', async () => {
    orphanUpsertMock.mockResolvedValue({ error: { message: 'db down' } });
    const res = await call();
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'stats archive cleanup could not be prepared' });
    expect(deleteUserMock).not.toHaveBeenCalled();
    expect(bucket.list).not.toHaveBeenCalled();
    expect(bucket.delete).not.toHaveBeenCalled();
  });

  it('compensates the tombstone and touches nothing in R2 when deleting the user fails', async () => {
    deleteUserMock.mockResolvedValue({ error: { message: 'auth down' } });
    const res = await call();
    expect(res.statusCode).toBe(500);
    expect(events).toEqual(['queue:stat_archive_orphans', 'unqueue:stat_archive_orphans']);
    expect(orphanDeleteEqMock).toHaveBeenCalledWith('stat_archive_orphans', 'user_id', 'u1');
    expect(bucket.list).not.toHaveBeenCalled();
    expect(bucket.delete).not.toHaveBeenCalled();
  });

  it('still answers 200 when the immediate prefix delete fails: the tombstone lets the sweep finish the job', async () => {
    bucket.list.mockRejectedValueOnce(new Error('r2 down'));
    const res = await call();
    expect(res.statusCode).toBe(200);
    expect(deleteUserMock).toHaveBeenCalledTimes(1);
    expect(orphanUpsertMock).toHaveBeenCalledTimes(1);
    expect(orphanDeleteEqMock).not.toHaveBeenCalled(); // tombstone stays for the sweep
  });

  it('is a no-op without the R2 binding (self-host)', async () => {
    cfEnv = {};
    const res = await call();
    expect(res.statusCode).toBe(200);
    expect(deleteUserMock).toHaveBeenCalledTimes(1);
    expect(bucket.list).not.toHaveBeenCalled();
    expect(orphanUpsertMock).not.toHaveBeenCalled();
  });
});
