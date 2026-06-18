import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// GHSA-mfmj-2frf-vhgw: a cross-tenant write via `fileName` path traversal.
// The handler must reject a traversing `fileName` before it ever asks the
// storage backend for a presigned PUT URL.

const validateUserAndTokenMock = vi.fn();
const getUploadSignedUrlMock = vi.fn();
const getDownloadSignedUrlMock = vi.fn();
const createSupabaseAdminClientMock = vi.fn();

vi.mock('@/utils/cors', () => ({
  corsAllMethods: {},
  runMiddleware: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: (...a: unknown[]) => validateUserAndTokenMock(...a),
  getStoragePlanData: vi.fn().mockReturnValue({ usage: 0, quota: 10 ** 12 }),
  STORAGE_QUOTA_GRACE_BYTES: 0,
}));
vi.mock('@/utils/object', async (orig) => {
  const actual = await orig<typeof import('@/utils/object')>();
  return {
    ...actual,
    getUploadSignedUrl: (...a: unknown[]) => getUploadSignedUrlMock(...a),
    getDownloadSignedUrl: (...a: unknown[]) => getDownloadSignedUrlMock(...a),
  };
});
vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: (...a: unknown[]) => createSupabaseAdminClientMock(...a),
}));

import handler from '@/pages/api/storage/upload';

const makeReqRes = (body: Record<string, unknown>) => {
  const req = {
    method: 'POST',
    headers: { authorization: 'Bearer attacker' },
    body,
  } as unknown as NextApiRequest;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as NextApiResponse;
  return { req, res };
};

beforeEach(() => {
  validateUserAndTokenMock.mockReset().mockResolvedValue({
    user: { id: 'attacker-id' },
    token: 'tok',
  });
  getUploadSignedUrlMock.mockReset().mockResolvedValue('https://r2/upload');
  getDownloadSignedUrlMock.mockReset().mockResolvedValue('https://r2/download');

  // Minimal chainable Supabase stub: the no-existing-record lookup then the
  // insert, both ending in `.single()`.
  const single = vi
    .fn()
    .mockResolvedValueOnce({ data: null, error: { code: 'PGRST116' } })
    .mockResolvedValueOnce({ data: { file_size: 12345 }, error: null });
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'limit', 'insert']) builder[m] = () => builder;
  builder['single'] = single;
  createSupabaseAdminClientMock.mockReset().mockReturnValue({ from: () => builder });
});

describe('POST /api/storage/upload — fileName traversal guard', () => {
  it('rejects a traversing fileName with 400 and never presigns', async () => {
    const { req, res } = makeReqRes({
      fileName: '../victim-id/Readest/Book/hash/book.epub',
      fileSize: 12345,
    });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(getUploadSignedUrlMock).not.toHaveBeenCalled();
  });

  it('rejects a traversing fileName on the temp image branch too', async () => {
    const { req, res } = makeReqRes({
      fileName: '../../other/evil.png',
      fileSize: 999,
      temp: true,
    });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(getUploadSignedUrlMock).not.toHaveBeenCalled();
  });

  it('allows a normal book key through to presigning', async () => {
    const { req, res } = makeReqRes({
      fileName: 'Readest/Books/hash.epub',
      fileSize: 12345,
    });
    await handler(req, res);
    expect(getUploadSignedUrlMock).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
