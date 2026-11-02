import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Book } from '@/types/book';
import type { DBBook } from '@/types/records';

const db = vi.hoisted(() => ({
  book: null as DBBook | null,
  writes: [] as DBBook[],
}));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: async () => ({ user: { id: 'test-user' }, token: 'test-token' }),
}));
vi.mock('@/utils/supabase', () => ({
  createSupabaseClient: () => ({
    from: () => ({
      select: () => ({ or: async () => ({ data: db.book ? [db.book] : [], error: null }) }),
      upsert: (rows: DBBook[]) => {
        db.writes.push(...rows);
        db.book = rows[0] ?? null;
        return { select: async () => ({ data: rows, error: null }) };
      },
    }),
  }),
}));

import { POST } from '@/pages/api/sync';

const push = (book: Partial<Book>) =>
  POST(
    new Request('https://example.com/api/sync', {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        books: [{ hash: 'h', format: 'EPUB', title: 'T', author: 'A', updatedAt: 1, ...book }],
      }),
    }) as unknown as NextRequest,
  );

beforeEach(() => {
  db.book = {
    user_id: 'test-user',
    book_hash: 'h',
    format: 'EPUB',
    title: 'T',
    author: 'A',
    original_filename: null,
    updated_at: new Date(2).toISOString(),
  };
  db.writes = [];
});

describe('original filename cloud merge', () => {
  it.each([
    1, 2, 3,
  ])('fills a missing filename independently of the row clock (%s)', async (updatedAt) => {
    const response = await push({ originalFilename: 'Original.epub', updatedAt });

    expect(response.status).toBe(200);
    expect(db.writes).toHaveLength(1);
    expect(db.book?.original_filename).toBe('Original.epub');
    expect(db.book?.updated_at).toBe(new Date(Math.max(2, updatedAt)).toISOString());
    expect((await response.json()).books[0].original_filename).toBe('Original.epub');

    await push({ originalFilename: 'Original.epub', updatedAt });
    expect(db.writes).toHaveLength(1);
  });

  it.each([
    undefined,
    'Peer copy.epub',
  ])('preserves the known server filename when a newer client sends %s', async (originalFilename) => {
    db.book!.original_filename = 'Original.epub';
    const response = await push({ originalFilename, updatedAt: 3 });

    expect(response.status).toBe(200);
    expect(db.writes).toHaveLength(1);
    expect(db.book?.original_filename).toBe('Original.epub');
    expect(db.book?.updated_at).toBe(new Date(3).toISOString());
  });

  it('does not rewrite a legacy row when neither peer knows the filename', async () => {
    const response = await push({});

    expect(response.status).toBe(200);
    expect(db.writes).toHaveLength(0);
  });
});
