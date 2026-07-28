import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// Issue #5352: the temp (public) image key used to embed the wall-clock hour,
// so the same cover got a brand-new public URL every hour. Discord had to
// resolve a never-before-seen external asset on each rotation, and any hiccup
// in that resolution showed the app icon instead of the cover. The key must be
// content-addressed: same user + same file name -> same URL, forever.

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

const uploadTempAt = async (isoTime: string) => {
  vi.setSystemTime(new Date(isoTime));
  const req = {
    method: 'POST',
    headers: { authorization: 'Bearer tok' },
    body: { fileName: 'drp_c0ffee.jpg', fileSize: 4096, temp: true },
  } as unknown as NextApiRequest;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as NextApiResponse;
  await handler(req, res);
  return getUploadSignedUrlMock.mock.calls.at(-1)![0] as string;
};

beforeEach(() => {
  vi.useFakeTimers();
  validateUserAndTokenMock.mockReset().mockResolvedValue({
    user: { id: 'abcdef12-3456-7890-abcd-ef1234567890' },
    token: 'tok',
  });
  getUploadSignedUrlMock.mockReset().mockResolvedValue('https://r2/upload');
  getDownloadSignedUrlMock
    .mockReset()
    .mockResolvedValue('https://r2.example/bucket/temp/img/abcdef12/drp_c0ffee.jpg?sig=1');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('POST /api/storage/upload — temp image key', () => {
  it('gives the same key across hours, days and app restarts', async () => {
    const first = await uploadTempAt('2026-07-28T12:59:59Z');
    const second = await uploadTempAt('2026-07-28T13:00:01Z');
    const later = await uploadTempAt('2026-08-02T04:17:00Z');

    expect(second).toBe(first);
    expect(later).toBe(first);
  });

  it('scopes the key to the user without a time segment', async () => {
    const key = await uploadTempAt('2026-07-28T12:00:00Z');

    expect(key).toBe('temp/img/abcdef12/drp_c0ffee.jpg');
  });
});
