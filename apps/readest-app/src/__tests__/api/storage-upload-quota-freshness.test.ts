import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// `storage_usage_bytes` is a JWT claim, minted when the access token is issued
// and frozen for its whole lifetime. Authorising an upload against it means
// every request inside that window is measured against the same stale
// baseline, so a user sitting just under quota can keep uploading until the
// token refreshes. The entitlement half (`quota`) is fine to read from the
// token — it only moves on purchase or refund — but the counter has to come
// from the database.

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

/** `plans.storage_usage_bytes` is what the DB trigger keeps current. */
const stubSupabase = (liveUsageBytes: number | null) => {
  const plansSingle = vi
    .fn()
    .mockResolvedValue(
      liveUsageBytes === null
        ? { data: null, error: { code: 'PGRST116' } }
        : { data: { storage_usage_bytes: liveUsageBytes }, error: null },
    );
  const filesSingle = vi
    .fn()
    .mockResolvedValueOnce({ data: null, error: { code: 'PGRST116' } })
    .mockResolvedValueOnce({ data: { file_size: 1 }, error: null });

  const make = (single: unknown) => {
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'limit', 'insert', 'is']) builder[m] = () => builder;
    builder['single'] = single;
    return builder;
  };
  createSupabaseAdminClientMock.mockReset().mockReturnValue({
    from: (table: string) => (table === 'plans' ? make(plansSingle) : make(filesSingle)),
  });
  return { plansSingle };
};

beforeEach(() => {
  validateUserAndTokenMock.mockReset().mockResolvedValue({ user: { id: 'user-1' }, token: 'tok' });
  getUploadSignedUrlMock.mockReset().mockResolvedValue('https://r2/upload');
  getDownloadSignedUrlMock.mockReset().mockResolvedValue('https://r2/download');
  // The stale snapshot the token was minted with: the account looked empty.
  getStoragePlanDataMock.mockReset().mockReturnValue({ usage: 0, quota: QUOTA });
});

describe('POST /api/storage/upload — quota freshness', () => {
  it('refuses an upload that the live usage puts over quota, despite a stale claim', async () => {
    // Token says 0 bytes used; the database says the account is already full.
    stubSupabase(QUOTA);
    const { req, res } = makeReqRes({
      fileName: 'Readest/Books/hash.epub',
      fileSize: 90 * 1024 * 1024,
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(getUploadSignedUrlMock).not.toHaveBeenCalled();
  });

  it('reports the live usage, not the token snapshot', async () => {
    stubSupabase(400 * 1024 * 1024);
    const { req, res } = makeReqRes({
      fileName: 'Readest/Books/hash.epub',
      fileSize: 10 * 1024 * 1024,
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as unknown as { mock: { calls: [{ usage: number }][] } }).mock
      .calls[0]![0];
    expect(payload.usage).toBe(410 * 1024 * 1024);
  });

  it('still allows an upload that genuinely fits', async () => {
    stubSupabase(10 * 1024 * 1024);
    const { req, res } = makeReqRes({
      fileName: 'Readest/Books/hash.epub',
      fileSize: 5 * 1024 * 1024,
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(getUploadSignedUrlMock).toHaveBeenCalled();
  });

  it('falls back to the token claim when the plans row cannot be read', async () => {
    // A missing row must not become "0 bytes used, upload anything".
    stubSupabase(null);
    getStoragePlanDataMock.mockReturnValue({ usage: QUOTA, quota: QUOTA });
    const { req, res } = makeReqRes({
      fileName: 'Readest/Books/hash.epub',
      fileSize: 90 * 1024 * 1024,
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(getUploadSignedUrlMock).not.toHaveBeenCalled();
  });
});
