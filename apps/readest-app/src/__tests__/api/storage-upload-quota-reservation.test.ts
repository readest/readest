import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// The quota check and the `files` insert used to be separate round trips, so
// concurrent requests all measured themselves against the same usage and could
// together overshoot the quota. Both now happen inside one database call
// (`reserve_storage_upload`), which serialises a user's reservations and reads
// the live usage under that lock. The token's `storage_usage_bytes` claim is
// never consulted: it is frozen when the token is minted.

const validateUserAndTokenMock = vi.fn();
const getUploadSignedUrlMock = vi.fn();
const getDownloadSignedUrlMock = vi.fn();
const getStoragePlanDataMock = vi.fn();
const rpcMock = vi.fn();
const deleteEqMock = vi.fn();
const fromMock = vi.fn();

vi.mock('@/utils/cors', () => ({
  corsAllMethods: {},
  runMiddleware: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: (...a: unknown[]) => validateUserAndTokenMock(...a),
  getStoragePlanData: (...a: unknown[]) => getStoragePlanDataMock(...a),
  STORAGE_QUOTA_GRACE_BYTES: 1000,
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
  createSupabaseAdminClient: () => ({
    rpc: (...a: unknown[]) => rpcMock(...a),
    from: (...a: unknown[]) => fromMock(...a),
  }),
}));

import handler from '@/pages/api/storage/upload';

const QUOTA = 500 * 1024 * 1024;
const MB = 1024 * 1024;

const post = async (body: Record<string, unknown>) => {
  const req = {
    method: 'POST',
    headers: { authorization: 'Bearer tok' },
    body,
  } as unknown as NextApiRequest;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as NextApiResponse;
  await handler(req, res);
  return res as unknown as { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  validateUserAndTokenMock.mockReset().mockResolvedValue({ user: { id: 'user-1' }, token: 'tok' });
  getUploadSignedUrlMock.mockReset().mockResolvedValue('https://r2/upload');
  getDownloadSignedUrlMock.mockReset().mockResolvedValue('https://r2/download');
  // A stale snapshot: the token claims the account is empty.
  getStoragePlanDataMock.mockReset().mockReturnValue({ usage: 0, quota: QUOTA });
  rpcMock.mockReset();
  deleteEqMock.mockReset().mockResolvedValue({ error: null });
  fromMock.mockReset().mockReturnValue({ delete: () => ({ eq: deleteEqMock }) });
});

describe('POST /api/storage/upload — quota reservation', () => {
  it('reserves the upload in one database call with the quota from the token', async () => {
    rpcMock.mockResolvedValue({
      data: { allowed: true, usage: 400 * MB, file_size: 10 * MB, inserted: true, file_id: 'f1' },
      error: null,
    });

    const res = await post({
      fileName: 'Readest/Books/hash.epub',
      fileSize: 10 * MB,
      bookHash: 'hash',
    });

    expect(rpcMock).toHaveBeenCalledWith('reserve_storage_upload', {
      p_user_id: 'user-1',
      p_file_key: 'user-1/Readest/Books/hash.epub',
      p_file_size: 10 * MB,
      p_quota: QUOTA + 1000,
      p_book_hash: 'hash',
      p_replica_kind: null,
      p_replica_id: null,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(getUploadSignedUrlMock).toHaveBeenCalledWith(
      'user-1/Readest/Books/hash.epub',
      10 * MB,
      1800,
    );
    expect(res.json.mock.calls[0]![0]).toMatchObject({ usage: 410 * MB, quota: QUOTA });
  });

  it('refuses an upload the live usage puts over quota', async () => {
    rpcMock.mockResolvedValue({ data: { allowed: false, usage: QUOTA }, error: null });

    const res = await post({ fileName: 'Readest/Books/hash.epub', fileSize: 90 * MB });

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Insufficient storage quota', usage: QUOTA });
    expect(getUploadSignedUrlMock).not.toHaveBeenCalled();
  });

  it('signs an existing file with its recorded size and leaves the row alone on failure', async () => {
    rpcMock.mockResolvedValue({
      data: { allowed: true, usage: 0, file_size: 777, inserted: false },
      error: null,
    });
    getUploadSignedUrlMock.mockRejectedValue(new Error('sign failed'));

    const res = await post({ fileName: 'Readest/Books/hash.epub', fileSize: 999 });

    expect(getUploadSignedUrlMock).toHaveBeenCalledWith(
      'user-1/Readest/Books/hash.epub',
      777,
      1800,
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(deleteEqMock).not.toHaveBeenCalled();
  });

  it('does not count a re-uploaded file twice in the reported usage', async () => {
    rpcMock.mockResolvedValue({
      data: { allowed: true, usage: 400 * MB, file_size: 10 * MB, inserted: false },
      error: null,
    });

    const res = await post({ fileName: 'Readest/Books/hash.epub', fileSize: 10 * MB });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0]![0]).toMatchObject({ usage: 400 * MB });
  });

  it('releases a fresh reservation when signing fails', async () => {
    rpcMock.mockResolvedValue({
      data: { allowed: true, usage: 0, file_size: 999, inserted: true, file_id: 'f1' },
      error: null,
    });
    getUploadSignedUrlMock.mockRejectedValue(new Error('sign failed'));

    const res = await post({ fileName: 'Readest/Books/hash.epub', fileSize: 999 });

    expect(res.status).toHaveBeenCalledWith(500);
    expect(fromMock).toHaveBeenCalledWith('files');
    expect(deleteEqMock).toHaveBeenCalledWith('id', 'f1');
  });

  it('returns 500 without signing when the reservation fails', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const res = await post({ fileName: 'Readest/Books/hash.epub', fileSize: 999 });

    expect(res.status).toHaveBeenCalledWith(500);
    expect(getUploadSignedUrlMock).not.toHaveBeenCalled();
  });

  it.each([
    0,
    -1,
    1.5,
    '1024',
    null,
    Number.MAX_SAFE_INTEGER + 2,
  ])('rejects fileSize %s before reserving anything', async (fileSize) => {
    const res = await post({ fileName: 'Readest/Books/hash.epub', fileSize });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(getUploadSignedUrlMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/storage/upload — public image uploads', () => {
  it.each([
    { temp: true },
    { media: 'book_covers' },
  ])('rejects a missing or invalid fileSize (%o)', async (kind) => {
    for (const fileSize of [undefined, 0, -5, 'big']) {
      getUploadSignedUrlMock.mockClear();
      const res = await post({ fileName: 'c0ffee.png', fileSize, ...kind });
      expect(res.status).toHaveBeenCalledWith(400);
      expect(getUploadSignedUrlMock).not.toHaveBeenCalled();
    }
  });

  it.each([
    { temp: true },
    { media: 'book_covers' },
  ])('caps the size of public image uploads (%o)', async (kind) => {
    const res = await post({ fileName: 'c0ffee.png', fileSize: 21 * MB, ...kind });

    expect(res.status).toHaveBeenCalledWith(413);
    expect(getUploadSignedUrlMock).not.toHaveBeenCalled();
  });

  it.each([
    { temp: true },
    { media: 'book_covers' },
  ])('signs a cover-sized public image upload (%o)', async (kind) => {
    const res = await post({ fileName: 'c0ffee.png', fileSize: 5 * MB, ...kind });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(getUploadSignedUrlMock).toHaveBeenCalledWith(
      expect.any(String),
      5 * MB,
      1800,
      expect.anything(),
    );
  });
});
