import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// Issue #5424: exported annotations and Readwise pushes need a durable, public
// cover URL. Covers are published to media/book_covers/<user-seg>/<coverHash>.png
// in the public bucket and served from https://assets.readest.com — the key is
// content-addressed so re-uploads are idempotent and the URL never rotates.

const validateUserAndTokenMock = vi.fn();
const getUploadSignedUrlMock = vi.fn();
const getDownloadSignedUrlMock = vi.fn();

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
  createSupabaseAdminClient: vi.fn(),
}));

import handler from '@/pages/api/storage/upload';

const postMedia = async (body: Record<string, unknown>) => {
  const req = {
    method: 'POST',
    headers: { authorization: 'Bearer tok' },
    body,
  } as unknown as NextApiRequest;
  const json = vi.fn().mockReturnThis();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as NextApiResponse;
  await handler(req, res);
  return { status, json };
};

beforeEach(() => {
  validateUserAndTokenMock.mockReset().mockResolvedValue({
    user: { id: 'abcdef12-3456-7890-abcd-ef1234567890' },
    token: 'tok',
  });
  getUploadSignedUrlMock.mockReset().mockResolvedValue('https://r2/upload');
  getDownloadSignedUrlMock.mockReset();
});

describe('POST /api/storage/upload — media book cover key', () => {
  it('keys the cover by user segment + content hash and returns the public assets URL', async () => {
    const { status, json } = await postMedia({
      fileName: 'c0ffee42.png',
      fileSize: 4096,
      media: 'book_covers',
    });

    expect(getUploadSignedUrlMock).toHaveBeenCalledWith(
      'media/book_covers/abcdef12/c0ffee42.png',
      4096,
      expect.any(Number),
      expect.any(String),
    );
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({
      uploadUrl: 'https://r2/upload',
      downloadUrl: 'https://assets.readest.com/media/book_covers/abcdef12/c0ffee42.png',
    });
  });

  it('rejects unknown media kinds', async () => {
    const { status } = await postMedia({
      fileName: 'c0ffee42.png',
      fileSize: 4096,
      media: 'avatars',
    });

    expect(status).toHaveBeenCalledWith(400);
    expect(getUploadSignedUrlMock).not.toHaveBeenCalled();
  });

  it('rejects path traversal in the file name', async () => {
    const { status } = await postMedia({
      fileName: '../../evil.png',
      fileSize: 4096,
      media: 'book_covers',
    });

    expect(status).toHaveBeenCalledWith(400);
    expect(getUploadSignedUrlMock).not.toHaveBeenCalled();
  });
});
