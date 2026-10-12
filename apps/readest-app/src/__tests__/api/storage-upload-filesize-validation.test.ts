import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// `fileSize` is fully client-controlled and flows straight into the quota math
// (`usage + fileSize > quota`) and into the `files.file_size` column. Without a
// positive-integer guard a caller can send a negative size (which passes the
// quota check and can drive the usage counter down), a fractional size, or a
// numeric string (which makes the comparison a string concatenation). The
// public `media`/`temp` branches signed a presigned PUT for any `fileSize` at
// all. Every legitimate caller sends a positive integer byte count, so the
// guard rejects only abuse.

const validateUserAndTokenMock = vi.fn();
const getUploadSignedUrlMock = vi.fn();
const getDownloadSignedUrlMock = vi.fn();
const createSupabaseAdminClientMock = vi.fn();
const getStoragePlanDataMock = vi.fn();

vi.mock('@/utils/cors', () => ({
  corsAllMethods: {},
  runMiddleware: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: (...a: unknown[]) => validateUserAndTokenMock(...a),
  getStoragePlanData: (...a: unknown[]) => getStoragePlanDataMock(...a),
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

const QUOTA = 500 * 1024 * 1024;

const makeReqRes = (body: Record<string, unknown>) => {
  const req = {
    method: 'POST',
    headers: { authorization: 'Bearer tok' },
    body,
  } as unknown as NextApiRequest;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as NextApiResponse;
  return { req, res };
};

beforeEach(() => {
  validateUserAndTokenMock.mockReset().mockResolvedValue({ user: { id: 'user-1' }, token: 'tok' });
  getUploadSignedUrlMock.mockReset().mockResolvedValue('https://r2/upload');
  getDownloadSignedUrlMock.mockReset().mockResolvedValue('https://r2/download');
  getStoragePlanDataMock.mockReset().mockReturnValue({ usage: 0, quota: QUOTA });
  // If validation works the handler returns before touching the DB; stub it so
  // a regression that falls through fails loudly instead of throwing.
  createSupabaseAdminClientMock.mockReset().mockReturnValue({
    from: () => {
      throw new Error('DB should not be reached for an invalid fileSize');
    },
  });
});

describe('POST /api/storage/upload — fileSize validation', () => {
  it('rejects a negative fileSize with 400 and never presigns or inserts', async () => {
    const { req, res } = makeReqRes({ fileName: 'Readest/Books/hash.epub', fileSize: -1000 });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(getUploadSignedUrlMock).not.toHaveBeenCalled();
  });

  it('rejects a fractional fileSize with 400', async () => {
    const { req, res } = makeReqRes({ fileName: 'Readest/Books/hash.epub', fileSize: 1.5 });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(getUploadSignedUrlMock).not.toHaveBeenCalled();
  });

  it('rejects a numeric-string fileSize with 400 (no string-concatenation bypass)', async () => {
    const { req, res } = makeReqRes({ fileName: 'Readest/Books/hash.epub', fileSize: '100' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(getUploadSignedUrlMock).not.toHaveBeenCalled();
  });

  it('rejects a negative fileSize on the public media branch', async () => {
    const { req, res } = makeReqRes({
      fileName: 'c0ffee42.png',
      fileSize: -1,
      media: 'book_covers',
    });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(getUploadSignedUrlMock).not.toHaveBeenCalled();
  });

  it('rejects a non-finite fileSize on the temp branch', async () => {
    const { req, res } = makeReqRes({
      fileName: 'drp_c0ffee.jpg',
      fileSize: Number.POSITIVE_INFINITY,
      temp: true,
    });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(getUploadSignedUrlMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/storage/upload — public-bucket size + content guard', () => {
  it('rejects a non-image file name on the public media branch (no arbitrary HTML hosting)', async () => {
    const { req, res } = makeReqRes({
      fileName: 'phish.html',
      fileSize: 1000,
      media: 'book_covers',
    });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(getUploadSignedUrlMock).not.toHaveBeenCalled();
  });

  it('rejects a non-image file name on the temp branch', async () => {
    const { req, res } = makeReqRes({
      fileName: 'evil.svg',
      fileSize: 1000,
      temp: true,
    });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(getUploadSignedUrlMock).not.toHaveBeenCalled();
  });

  it('rejects an oversized public media upload with 413', async () => {
    const { req, res } = makeReqRes({
      fileName: 'huge.png',
      fileSize: 50 * 1024 * 1024,
      media: 'book_covers',
    });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(413);
    expect(getUploadSignedUrlMock).not.toHaveBeenCalled();
  });

  it('still presigns a normal-sized cover png on the media branch', async () => {
    const { req, res } = makeReqRes({
      fileName: 'c0ffee42.png',
      fileSize: 50_000,
      media: 'book_covers',
    });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(getUploadSignedUrlMock).toHaveBeenCalledTimes(1);
  });

  it('still presigns a normal-sized Discord jpg on the temp branch', async () => {
    const { req, res } = makeReqRes({
      fileName: 'drp_c0ffee.jpg',
      fileSize: 50_000,
      temp: true,
    });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(getUploadSignedUrlMock).toHaveBeenCalledTimes(1);
  });
});
