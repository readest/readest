import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// The `files` row an upload writes is its reservation, and a trigger adds its
// size to `plans.storage_usage_bytes`. Checking the quota before that insert
// let concurrent requests all measure themselves against the same usage and
// overshoot it together; checking after it counts every reservation committed
// so far. The token's usage claim is frozen when the token is minted, so it is
// only a fallback where there is no `plans` row.

const validateUserAndTokenMock = vi.fn();
const getUploadSignedUrlMock = vi.fn();
const getDownloadSignedUrlMock = vi.fn();
const getStoragePlanDataMock = vi.fn();

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

// A stand-in for the database: `files` rows plus the per-user counter the
// trigger maintains. Every call yields first, so concurrent requests interleave
// between round trips as they do against the real server.
type FileRow = { id: string; user_id: string; file_key: string; file_size: number };
const db = {
  files: [] as FileRow[],
  usage: 0,
  planError: null as { code: string; message: string } | null,
};

const query = (table: string) => {
  let op: 'select' | 'insert' | 'delete' = 'select';
  let rows: Omit<FileRow, 'id'>[] = [];
  const filters: Record<string, unknown> = {};
  const run = async (single: 'single' | 'maybe' | false) => {
    await new Promise((r) => setTimeout(r, 0));
    if (table === 'plans') {
      return db.planError
        ? { data: null, error: db.planError }
        : { data: { storage_usage_bytes: db.usage }, error: null };
    }
    if (op === 'insert') {
      const row = { ...rows[0]!, id: `f${db.files.length + 1}` };
      db.files.push(row);
      db.usage += row.file_size;
      return { data: { id: row.id }, error: null };
    }
    const matched = db.files.filter((f) =>
      Object.entries(filters).every(([k, v]) => f[k as keyof FileRow] === v),
    );
    if (op === 'delete') {
      db.files = db.files.filter((f) => !matched.includes(f));
      matched.forEach((f) => (db.usage -= f.file_size));
      return { data: null, error: null };
    }
    if (!single) return { data: matched, error: null };
    if (matched.length) return { data: matched[0], error: null };
    return single === 'maybe'
      ? { data: null, error: null }
      : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
  };
  const builder = {
    select: () => builder,
    insert: (r: Omit<FileRow, 'id'>[]) => {
      op = 'insert';
      rows = r;
      return builder;
    },
    delete: () => {
      op = 'delete';
      return builder;
    },
    eq: (k: string, v: unknown) => {
      filters[k] = v;
      return builder;
    },
    limit: () => builder,
    single: () => run('single'),
    maybeSingle: () => run('maybe'),
    // biome-ignore lint/suspicious/noThenProperty: mock PostgREST builder is intentionally thenable
    then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => run(false).then(ok, fail),
  };
  return builder;
};

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({ from: (t: string) => query(t) }),
}));

import handler from '@/pages/api/storage/upload';

const MB = 1024 * 1024;
const QUOTA = 500 * MB;
const GRACE = 1000;

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

const statusOf = (res: { status: ReturnType<typeof vi.fn> }) => res.status.mock.calls[0]![0];

const seed = (fileKey: string, fileSize: number) => {
  db.files.push({
    id: `seed-${fileKey}`,
    user_id: 'user-1',
    file_key: fileKey,
    file_size: fileSize,
  });
  db.usage += fileSize;
};

beforeEach(() => {
  db.files = [];
  db.usage = 0;
  db.planError = null;
  validateUserAndTokenMock.mockReset().mockResolvedValue({ user: { id: 'user-1' }, token: 'tok' });
  getUploadSignedUrlMock.mockReset().mockResolvedValue('https://r2/upload');
  getDownloadSignedUrlMock.mockReset().mockResolvedValue('https://r2/download');
  // A stale snapshot: the token claims the account is empty.
  getStoragePlanDataMock.mockReset().mockReturnValue({ usage: 0, quota: QUOTA });
});

describe('POST /api/storage/upload — quota', () => {
  it('records the file and signs it when it fits', async () => {
    seed('user-1/Readest/Books/old.epub', 400 * MB);

    const res = await post({ fileName: 'Readest/Books/hash.epub', fileSize: 10 * MB });

    expect(statusOf(res)).toBe(200);
    expect(getUploadSignedUrlMock).toHaveBeenCalledWith(
      'user-1/Readest/Books/hash.epub',
      10 * MB,
      1800,
    );
    expect(res.json.mock.calls[0]![0]).toMatchObject({ usage: 410 * MB, quota: QUOTA });
    expect(db.files.map((f) => f.file_key)).toContain('user-1/Readest/Books/hash.epub');
  });

  it('refuses an upload the live usage puts over quota and drops its row', async () => {
    seed('user-1/Readest/Books/old.epub', QUOTA);

    const res = await post({ fileName: 'Readest/Books/hash.epub', fileSize: 90 * MB });

    expect(statusOf(res)).toBe(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Insufficient storage quota', usage: QUOTA });
    expect(getUploadSignedUrlMock).not.toHaveBeenCalled();
    expect(db.files).toHaveLength(1);
    expect(db.usage).toBe(QUOTA);
  });

  it('never accepts more than the quota across concurrent uploads', async () => {
    seed('user-1/Readest/Books/old.epub', 400 * MB);

    const results = await Promise.all(
      [1, 2, 3].map((i) => post({ fileName: `Readest/Books/b${i}.epub`, fileSize: 60 * MB })),
    );

    const accepted = results.filter((r) => statusOf(r) === 200).length;
    expect(400 * MB + accepted * 60 * MB).toBeLessThanOrEqual(QUOTA + GRACE);
    expect(db.usage).toBeLessThanOrEqual(QUOTA + GRACE);
  });

  it('signs a re-upload with its recorded size and does not count it twice', async () => {
    seed('user-1/Readest/Books/hash.epub', 777);

    const res = await post({ fileName: 'Readest/Books/hash.epub', fileSize: 999 });

    expect(statusOf(res)).toBe(200);
    expect(getUploadSignedUrlMock).toHaveBeenCalledWith(
      'user-1/Readest/Books/hash.epub',
      777,
      1800,
    );
    expect(res.json.mock.calls[0]![0]).toMatchObject({ usage: 777 });
    expect(db.files).toHaveLength(1);
  });

  it('drops a fresh row when signing fails', async () => {
    getUploadSignedUrlMock.mockRejectedValue(new Error('sign failed'));

    const res = await post({ fileName: 'Readest/Books/hash.epub', fileSize: 999 });

    expect(statusOf(res)).toBe(500);
    expect(db.files).toHaveLength(0);
    expect(db.usage).toBe(0);
  });

  it('keeps an existing row when signing its re-upload fails', async () => {
    seed('user-1/Readest/Books/hash.epub', 777);
    getUploadSignedUrlMock.mockRejectedValue(new Error('sign failed'));

    const res = await post({ fileName: 'Readest/Books/hash.epub', fileSize: 999 });

    expect(statusOf(res)).toBe(500);
    expect(db.files).toHaveLength(1);
  });

  // No `plans` row for this user (PGRST116), or no `plans` table at all, as on
  // self-hosted servers (PGRST205; 42P01 from older PostgREST).
  it.each([
    'PGRST116',
    'PGRST205',
    '42P01',
  ])('falls back to the token claim plus the new file without a plans row (%s)', async (code) => {
    db.planError = { code, message: 'no plan' };
    getStoragePlanDataMock.mockReturnValue({ usage: QUOTA - 5 * MB, quota: QUOTA });

    const res = await post({ fileName: 'Readest/Books/hash.epub', fileSize: 10 * MB });

    expect(statusOf(res)).toBe(403);
    expect(db.files).toHaveLength(0);
  });

  it('fails closed and drops its row when the usage read fails', async () => {
    db.planError = { code: '57014', message: 'canceling statement due to statement timeout' };

    const res = await post({ fileName: 'Readest/Books/hash.epub', fileSize: 10 * MB });

    expect(statusOf(res)).toBe(500);
    expect(getUploadSignedUrlMock).not.toHaveBeenCalled();
    expect(db.files).toHaveLength(0);
  });

  it.each([
    0,
    -1,
    -100 * 1024 * MB,
    1.5,
    '1024',
    null,
    Number.MAX_SAFE_INTEGER + 2,
  ])('rejects fileSize %s before recording anything', async (fileSize) => {
    const res = await post({ fileName: 'Readest/Books/hash.epub', fileSize });

    expect(statusOf(res)).toBe(400);
    expect(db.files).toHaveLength(0);
    expect(db.usage).toBe(0);
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
