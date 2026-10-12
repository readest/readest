import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// storage/delete used to delete the `files` row even when the R2 object delete
// failed (the response's .ok was never checked), orphaning the object in the
// bucket with no DB index pointing at it. The DB row must only be removed after
// a confirmed R2 delete.

const validateUserAndTokenMock = vi.fn();
const deleteObjectMock = vi.fn();
const dbDeleteMock = vi.fn();

vi.mock('@/utils/cors', () => ({
  corsAllMethods: {},
  runMiddleware: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: (...a: unknown[]) => validateUserAndTokenMock(...a),
}));
vi.mock('@/utils/object', () => ({ deleteObject: (...a: unknown[]) => deleteObjectMock(...a) }));
vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            limit: () => ({
              single: () => Promise.resolve({ data: { id: 'row1', user_id: 'u1' }, error: null }),
            }),
          }),
        }),
      }),
      delete: () => ({ eq: (...a: unknown[]) => dbDeleteMock(...a) }),
    }),
  }),
}));

import handler from '@/pages/api/storage/delete';

const makeReqRes = () => {
  const req = {
    method: 'DELETE',
    headers: { authorization: 'Bearer tok' },
    query: { fileKey: 'u1/Readest/Books/a.epub' },
  } as unknown as NextApiRequest;
  const res = {
    statusCode: 0,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json() {
      return this;
    },
  };
  return { req, res: res as unknown as NextApiResponse & { statusCode: number } };
};

beforeEach(() => {
  validateUserAndTokenMock.mockReset().mockResolvedValue({ user: { id: 'u1' }, token: 'tok' });
  dbDeleteMock.mockReset().mockResolvedValue({ error: null });
  deleteObjectMock.mockReset();
});

describe('DELETE /api/storage/delete — R2 failure handling', () => {
  it('does not delete the DB row when the R2 delete returns not-ok', async () => {
    deleteObjectMock.mockResolvedValue({ ok: false, status: 500 });
    const { req, res } = makeReqRes();
    await handler(req, res);
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(dbDeleteMock).not.toHaveBeenCalled();
  });

  it('deletes the DB row after a successful R2 delete', async () => {
    deleteObjectMock.mockResolvedValue({ ok: true, status: 204 });
    const { req, res } = makeReqRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(dbDeleteMock).toHaveBeenCalledTimes(1);
  });
});
