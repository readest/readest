import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// DELETE /api/user/delete must also remove the user's reading-statistics
// archive objects in R2 (stats/v1/{user_id}/...). Postgres rows cascade with
// the auth user; R2 objects do not. The identity goes first (deleting objects
// before a failed deleteUser would leave an active account with its history
// gone); then the user id is queued in stat_archive_orphans for the compaction
// job's sweep and the prefix is deleted right away, best-effort.

const deleteUserMock = vi.fn();
const orphanUpsertMock = vi.fn();
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
  bucket.list.mockReset().mockResolvedValue({ objects: [], truncated: false });
  bucket.delete.mockReset().mockImplementation(async (keys: string[]) => {
    events.push(`delete:${keys.join(',')}`);
  });
  cfEnv = { STATS_ARCHIVE_R2: bucket };
});

describe('DELETE /api/user/delete stats archive cleanup', () => {
  it('deletes the user first, then queues the id for the sweep and deletes the prefix (paginated listing)', async () => {
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
      'deleteUser',
      'queue:stat_archive_orphans',
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

  it('touches nothing in R2 when deleting the user fails', async () => {
    deleteUserMock.mockResolvedValue({ error: { message: 'auth down' } });
    const res = await call();
    expect(res.statusCode).toBe(500);
    expect(bucket.list).not.toHaveBeenCalled();
    expect(bucket.delete).not.toHaveBeenCalled();
    expect(orphanUpsertMock).not.toHaveBeenCalled();
  });

  it('still answers 200 when the immediate prefix delete fails: the queued row lets the sweep finish the job', async () => {
    bucket.list.mockRejectedValueOnce(new Error('r2 down'));
    const res = await call();
    expect(res.statusCode).toBe(200);
    expect(deleteUserMock).toHaveBeenCalledTimes(1);
    expect(orphanUpsertMock).toHaveBeenCalledTimes(1);
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
