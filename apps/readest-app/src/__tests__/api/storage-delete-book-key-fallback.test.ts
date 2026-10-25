import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// The app deletes a book's cloud file at `{hash}/{title}.{ext}` (R2), but the
// calibre plugin and the koplugin upload it as `{hash}/{hash}.{ext}`. The
// download API resolves that mismatch by book hash + extension; delete must
// too, or "Remove from Cloud & Device" removes the book from the library and
// leaves its file using the user's storage quota.

const USER = 'abcdef12-3456-7890-abcd-ef1234567890';
const HASH = '898687e811a6c3681f1926721d6a2942';

type FileRow = { id: string; user_id: string; file_key: string; book_hash: string | null };

const validateUserAndTokenMock = vi.fn();
const deleteObjectMock = vi.fn();
let rows: FileRow[] = [];
const deletedIds: string[] = [];

// A query builder over `rows` covering the calls the handler makes.
const makeQuery = () => {
  const filters: Array<(row: FileRow) => boolean> = [];
  let deleting = false;
  const run = () => rows.filter((row) => filters.every((f) => f(row)));
  const query = {
    select: () => query,
    delete: () => {
      deleting = true;
      return query;
    },
    eq: (column: keyof FileRow, value: string) => {
      filters.push((row) => row[column] === value);
      if (deleting) {
        for (const row of run()) deletedIds.push(row.id);
        return Promise.resolve({ error: null });
      }
      return query;
    },
    // The hash lookup ends its chain with `.is('deleted_at', null)`.
    is: () => Promise.resolve({ data: run(), error: null }),
    limit: () => query,
    single: () => {
      const [row] = run();
      return Promise.resolve(row ? { data: row, error: null } : { data: null, error: {} });
    },
  };
  return query;
};

vi.mock('@/utils/cors', () => ({
  corsAllMethods: {},
  runMiddleware: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: (...a: unknown[]) => validateUserAndTokenMock(...a),
}));
vi.mock('@/utils/object', () => ({
  deleteObject: (...a: unknown[]) => deleteObjectMock(...a),
}));
vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({ from: () => makeQuery() }),
}));

import handler from '@/pages/api/storage/delete';

const deleteKey = async (fileKey: string) => {
  const req = {
    method: 'DELETE',
    headers: { authorization: 'Bearer tok' },
    query: { fileKey },
  } as unknown as NextApiRequest;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as NextApiResponse;
  await handler(req, res);
  return (res.status as ReturnType<typeof vi.fn>).mock.calls[0]![0] as number;
};

beforeEach(() => {
  validateUserAndTokenMock.mockReset().mockResolvedValue({ user: { id: USER }, token: 'tok' });
  deleteObjectMock.mockReset().mockResolvedValue(undefined);
  deletedIds.length = 0;
  rows = [
    {
      id: 'book',
      user_id: USER,
      file_key: `${USER}/Readest/Books/${HASH}/${HASH}.epub`,
      book_hash: HASH,
    },
    {
      id: 'cover',
      user_id: USER,
      file_key: `${USER}/Readest/Books/${HASH}/cover.png`,
      book_hash: HASH,
    },
  ];
});

describe('DELETE /api/storage/delete — book file uploaded under another name', () => {
  it('deletes the hash-named book file when the app asks for the title-named key', async () => {
    const status = await deleteKey(`${USER}/Readest/Books/${HASH}/Repro Deletion Test.epub`);

    expect(status).toBe(200);
    expect(deleteObjectMock).toHaveBeenCalledWith(`${USER}/Readest/Books/${HASH}/${HASH}.epub`);
    expect(deletedIds).toEqual(['book']);
  });

  it('still deletes an exact key as before', async () => {
    const status = await deleteKey(`${USER}/Readest/Books/${HASH}/cover.png`);

    expect(status).toBe(200);
    expect(deleteObjectMock).toHaveBeenCalledWith(`${USER}/Readest/Books/${HASH}/cover.png`);
    expect(deletedIds).toEqual(['cover']);
  });

  it('does not fall back to a file of another extension', async () => {
    const status = await deleteKey(`${USER}/Readest/Books/${HASH}/Repro Deletion Test.pdf`);

    expect(status).toBe(404);
    expect(deleteObjectMock).not.toHaveBeenCalled();
    expect(deletedIds).toEqual([]);
  });

  it('does not fall back for a key outside Readest/Books', async () => {
    const status = await deleteKey(`${USER}/Readest/BookNotes/${HASH}/Repro Deletion Test.epub`);

    expect(status).toBe(404);
    expect(deleteObjectMock).not.toHaveBeenCalled();
  });

  it("never resolves to another user's file", async () => {
    rows = rows.map((row) => ({ ...row, user_id: 'someone-else' }));
    const status = await deleteKey(`${USER}/Readest/Books/${HASH}/Repro Deletion Test.epub`);

    expect(status).toBe(404);
    expect(deleteObjectMock).not.toHaveBeenCalled();
  });
});
