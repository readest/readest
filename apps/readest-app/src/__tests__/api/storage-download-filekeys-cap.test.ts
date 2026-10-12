import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// The batch-download POST accepted an unbounded `fileKeys` array, which fans out
// into one huge `.in(...)` query plus one signed-URL call per key in a single
// Promise.allSettled — an amplification/DoS vector. Cap the batch size.

const validateUserAndTokenMock = vi.fn();
const createSupabaseAdminClientMock = vi.fn();

vi.mock('@/utils/cors', () => ({
  corsAllMethods: {},
  runMiddleware: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: (...a: unknown[]) => validateUserAndTokenMock(...a),
}));
vi.mock('@/utils/object', () => ({ getDownloadSignedUrl: vi.fn() }));
vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: (...a: unknown[]) => createSupabaseAdminClientMock(...a),
}));

import handler from '@/pages/api/storage/download';

const makeReqRes = (body: Record<string, unknown>) => {
  const req = {
    method: 'POST',
    headers: { authorization: 'Bearer tok' },
    body,
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
  // Reaching the DB means the cap did not short-circuit.
  createSupabaseAdminClientMock.mockReset().mockImplementation(() => {
    throw new Error('DB should not be reached for an over-cap batch');
  });
});

describe('POST /api/storage/download — fileKeys cap', () => {
  it('rejects an over-cap fileKeys batch with 413 and never queries the DB', async () => {
    const fileKeys = Array.from({ length: 1000 }, (_, i) => `u1/Readest/Books/${i}.epub`);
    const { req, res } = makeReqRes({ fileKeys });
    await handler(req, res);
    expect(res.statusCode).toBe(413);
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });
});
