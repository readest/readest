import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// DELETE /api/user/delete must also remove the user's reading-statistics
// archive objects in R2 (stats/v1/{user_id}/...). Postgres rows cascade with
// the auth user; R2 objects do not, so the handler deletes the prefix before
// the user (required, a failure blocks the deletion) and once more after
// (best-effort, closes the window of a compaction run in flight).

const deleteUserMock = vi.fn();
vi.mock('@/utils/cors', () => ({
  corsAllMethods: {},
  runMiddleware: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: vi.fn().mockResolvedValue({ user: { id: 'u1' }, token: 'tok' }),
}));
vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({ auth: { admin: { deleteUser: deleteUserMock } } }),
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
  bucket.list.mockReset();
  bucket.delete.mockReset().mockImplementation(async (keys: string[]) => {
    events.push(`delete:${keys.join(',')}`);
  });
  cfEnv = { STATS_ARCHIVE_R2: bucket };
});

describe('DELETE /api/user/delete stats archive cleanup', () => {
  it('deletes every object under the user prefix (paginated listing), then the user, then sweeps once more', async () => {
    bucket.list
      .mockResolvedValueOnce({
        objects: [{ key: 'stats/v1/u1/1.json' }, { key: 'stats/v1/u1/2.json' }],
        truncated: true,
        cursor: 'c1',
      })
      .mockResolvedValueOnce({ objects: [{ key: 'stats/v1/u1/3.json' }], truncated: false })
      .mockResolvedValue({ objects: [], truncated: false });

    const res = await call();
    expect(res.statusCode).toBe(200);
    expect(bucket.list.mock.calls[0]![0]).toMatchObject({ prefix: 'stats/v1/u1/' });
    expect(bucket.list.mock.calls[1]![0]).toMatchObject({ prefix: 'stats/v1/u1/', cursor: 'c1' });
    expect(events).toEqual([
      'delete:stats/v1/u1/1.json,stats/v1/u1/2.json',
      'delete:stats/v1/u1/3.json',
      'deleteUser',
    ]);
    // the post-delete sweep listed again (and found nothing)
    expect(bucket.list).toHaveBeenCalledTimes(3);
  });

  it('refuses to delete the user when the archive cleanup fails', async () => {
    bucket.list.mockRejectedValueOnce(new Error('r2 down'));
    const res = await call();
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'stats archive cleanup failed' });
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it('is a no-op without the R2 binding (self-host)', async () => {
    cfEnv = {};
    const res = await call();
    expect(res.statusCode).toBe(200);
    expect(deleteUserMock).toHaveBeenCalledTimes(1);
    expect(bucket.list).not.toHaveBeenCalled();
  });

  it('still answers 200 when only the best-effort second sweep fails', async () => {
    bucket.list
      .mockResolvedValueOnce({ objects: [], truncated: false })
      .mockRejectedValueOnce(new Error('r2 hiccup'));
    const res = await call();
    expect(res.statusCode).toBe(200);
    expect(deleteUserMock).toHaveBeenCalledTimes(1);
  });
});
