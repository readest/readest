import { describe, it, expect, vi, beforeEach } from 'vitest';

// Importing a shared book adds a `files` row to the recipient, either a fresh
// one or a restored soft-deleted one, and the trigger on `files` adds its size
// to `plans.storage_usage_bytes`. The quota is checked against that counter
// after the row is live, as /api/storage/upload does; the token's usage claim
// is frozen when the token is minted.

const getStoragePlanDataMock = vi.fn();
const copyObjectMock = vi.fn();

vi.mock('@/utils/access', () => ({
  validateUserAndToken: vi.fn().mockResolvedValue({ user: { id: 'user-1' }, token: 'tok' }),
  getStoragePlanData: (...a: unknown[]) => getStoragePlanDataMock(...a),
  STORAGE_QUOTA_GRACE_BYTES: 0,
}));
vi.mock('@/utils/object', () => ({
  objectExists: vi.fn().mockResolvedValue(true),
  copyObject: (...a: unknown[]) => copyObjectMock(...a),
}));
vi.mock('@/libs/shareServer', () => ({
  rejectionToHttp: vi.fn(),
  resolveActiveShare: vi.fn().mockResolvedValue({
    ok: true,
    share: {
      userId: 'sharer',
      bookHash: 'hash',
      bookSize: 100,
      bookFileKey: 'sharer/Readest/Book/hash/book.epub',
      coverFileKey: null,
      cfi: null,
    },
  }),
}));

// `files` rows plus the per-user counter the trigger maintains: it counts a row
// while `deleted_at` is null.
type FileRow = {
  id: string;
  user_id: string;
  book_hash: string;
  file_key: string;
  file_size: number;
  deleted_at: string | null;
};
const db = { files: [] as FileRow[], planError: null as { code: string; message: string } | null };
const usage = () =>
  db.files.filter((f) => f.deleted_at === null).reduce((n, f) => n + f.file_size, 0);

const query = (table: string) => {
  let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  let payload: Partial<FileRow> = {};
  const filters: Record<string, unknown> = {};
  const run = async () => {
    if (table === 'plans') {
      return db.planError
        ? { data: null, error: db.planError }
        : { data: { storage_usage_bytes: usage() }, error: null };
    }
    if (op === 'insert') {
      const row = { deleted_at: null, ...payload, id: `f${db.files.length + 1}` } as FileRow;
      db.files.push(row);
      return { data: { id: row.id }, error: null };
    }
    const matched = db.files.filter((f) =>
      Object.entries(filters).every(([k, v]) => f[k as keyof FileRow] === v),
    );
    if (op === 'update') matched.forEach((f) => Object.assign(f, payload));
    if (op === 'delete') db.files = db.files.filter((f) => !matched.includes(f));
    return { data: matched.map((f) => ({ ...f })), error: null };
  };
  const write = (kind: typeof op) => (p?: Partial<FileRow>) => {
    op = kind;
    payload = p ?? {};
    return builder;
  };
  const builder = {
    select: () => builder,
    insert: write('insert'),
    update: write('update'),
    delete: write('delete'),
    eq: (k: string, v: unknown) => {
      filters[k] = v;
      return builder;
    },
    single: () => run(),
    // biome-ignore lint/suspicious/noThenProperty: mock PostgREST builder is intentionally thenable
    then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => run().then(ok, fail),
  };
  return builder;
};

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({ from: (t: string) => query(t) }),
}));

import { POST } from '@/app/api/share/[token]/import/route';

const importShare = () =>
  POST(new Request('http://localhost/api/share/tok/import', { method: 'POST' }), {
    params: Promise.resolve({ token: 'tok' }),
  });

const seed = (row: Partial<FileRow>) =>
  db.files.push({
    id: `seed${db.files.length + 1}`,
    user_id: 'user-1',
    book_hash: 'other',
    file_key: `user-1/Readest/Book/other${db.files.length}/x.epub`,
    file_size: 0,
    deleted_at: null,
    ...row,
  });

beforeEach(() => {
  db.files = [];
  db.planError = null;
  copyObjectMock.mockReset().mockResolvedValue(undefined);
  // A stale snapshot: the token claims the account is empty.
  getStoragePlanDataMock.mockReset().mockReturnValue({ usage: 0, quota: 1000 });
});

describe('POST /api/share/[token]/import — quota', () => {
  it('imports a book that fits', async () => {
    seed({ file_size: 800 });

    const res = await importShare();

    expect(res.status).toBe(200);
    expect(copyObjectMock).toHaveBeenCalled();
    expect(usage()).toBe(900);
  });

  it('refuses a book the live usage puts over quota, without copying or keeping a row', async () => {
    seed({ file_size: 950 });

    const res = await importShare();

    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: 'quota_exceeded', usage: 950, quota: 1000 });
    expect(copyObjectMock).not.toHaveBeenCalled();
    expect(db.files).toHaveLength(1);
  });

  it('refuses to restore a deleted copy the live usage puts over quota', async () => {
    seed({ file_size: 950 });
    const deletedAt = '2026-10-01T00:00:00.000Z';
    seed({
      book_hash: 'hash',
      file_key: 'user-1/Readest/Book/hash/book.epub',
      file_size: 100,
      deleted_at: deletedAt,
    });

    const res = await importShare();

    expect(res.status).toBe(402);
    expect(db.files.find((f) => f.book_hash === 'hash')!.deleted_at).toBe(deletedAt);
    expect(usage()).toBe(950);
  });

  it('fails closed without copying when the usage read fails', async () => {
    db.planError = { code: '57014', message: 'canceling statement due to statement timeout' };

    const res = await importShare();

    expect(res.status).toBe(500);
    expect(copyObjectMock).not.toHaveBeenCalled();
    expect(db.files).toHaveLength(0);
  });

  it('falls back to the token claim without a plans table', async () => {
    db.planError = { code: 'PGRST205', message: 'no table' };
    getStoragePlanDataMock.mockReturnValue({ usage: 950, quota: 1000 });

    const res = await importShare();

    expect(res.status).toBe(402);
    expect(db.files).toHaveLength(0);
  });

  it('restores a deleted copy that fits', async () => {
    seed({
      book_hash: 'hash',
      file_key: 'user-1/Readest/Book/hash/book.epub',
      file_size: 100,
      deleted_at: '2026-10-01T00:00:00.000Z',
    });

    const res = await importShare();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ alreadyOwned: true });
    expect(usage()).toBe(100);
  });
});
