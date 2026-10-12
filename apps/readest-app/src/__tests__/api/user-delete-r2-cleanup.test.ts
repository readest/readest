import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// Deleting the auth user cascades the `files` rows (FK ON DELETE CASCADE),
// which are the only index of the user's `${user.id}/…` objects in R2. The
// handler used to clean up only the reading-stats archive prefix, orphaning
// every book/cover/replica in the bucket forever. The fix reads the object
// keys *before* deleting the identity, then deletes those objects afterwards.

const validateUserAndTokenMock = vi.fn();
const createSupabaseAdminClientMock = vi.fn();
const deleteObjectMock = vi.fn();
const deleteUserSegmentsMock = vi.fn();
const getStatsArchiveEnvMock = vi.fn();

vi.mock('@/utils/cors', () => ({
  corsAllMethods: {},
  runMiddleware: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: (...a: unknown[]) => validateUserAndTokenMock(...a),
}));
vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: (...a: unknown[]) => createSupabaseAdminClientMock(...a),
}));
vi.mock('@/utils/object', () => ({
  deleteObject: (...a: unknown[]) => deleteObjectMock(...a),
}));
vi.mock('@/libs/statsArchive', () => ({
  deleteUserSegments: (...a: unknown[]) => deleteUserSegmentsMock(...a),
  getStatsArchiveEnv: (...a: unknown[]) => getStatsArchiveEnvMock(...a),
}));

import handler from '@/pages/api/user/delete';

const USER_ID = 'user-123';

// A minimal supabase-admin double. `files.select().eq().range()` returns one
// page of rows then an empty page; deleteUser result is configurable.
const makeSupabase = (fileKeys: string[], deleteUserError: { message: string } | null) => {
  let filesPage = 0;
  const auth = { admin: { deleteUser: vi.fn().mockResolvedValue({ error: deleteUserError }) } };
  const from = vi.fn((table: string) => {
    if (table === 'files') {
      const builder = {
        select: () => builder,
        eq: () => builder,
        range: () => {
          const data = filesPage === 0 ? fileKeys.map((file_key) => ({ file_key })) : [];
          filesPage += 1;
          return Promise.resolve({ data, error: null });
        },
      };
      return builder;
    }
    throw new Error(`unexpected table ${table}`);
  });
  return { from, auth };
};

const makeReqRes = () => {
  const req = {
    method: 'DELETE',
    headers: { authorization: 'Bearer tok' },
  } as unknown as NextApiRequest;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as NextApiResponse;
  return { req, res };
};

beforeEach(() => {
  validateUserAndTokenMock.mockReset().mockResolvedValue({ user: { id: USER_ID }, token: 'tok' });
  deleteObjectMock.mockReset().mockResolvedValue({ ok: true });
  deleteUserSegmentsMock.mockReset().mockResolvedValue(undefined);
  // Skip the stats-archive branches to isolate the R2 file cleanup.
  getStatsArchiveEnvMock.mockReset().mockReturnValue({ STATS_ARCHIVE_R2: undefined });
  createSupabaseAdminClientMock.mockReset();
});

describe('DELETE /api/user/delete — R2 object cleanup', () => {
  it("deletes the user's R2 objects after deleting the identity", async () => {
    const keys = [`${USER_ID}/Readest/Books/a.epub`, `${USER_ID}/Readest/Books/b.epub`];
    createSupabaseAdminClientMock.mockReturnValue(makeSupabase(keys, null));
    const { req, res } = makeReqRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(deleteObjectMock).toHaveBeenCalledTimes(2);
    const deleted = deleteObjectMock.mock.calls.map((c) => c[0]).sort();
    expect(deleted).toEqual([...keys].sort());
  });

  it('does not delete any R2 objects when deleting the identity fails', async () => {
    const keys = [`${USER_ID}/Readest/Books/a.epub`];
    createSupabaseAdminClientMock.mockReturnValue(makeSupabase(keys, { message: 'boom' }));
    const { req, res } = makeReqRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    // A still-active account must keep its books.
    expect(deleteObjectMock).not.toHaveBeenCalled();
  });
});
