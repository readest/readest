import { describe, it, expect, vi, beforeEach } from 'vitest';

const validateUserAndTokenMock = vi.fn();
const createSupabaseClientMock = vi.fn();

vi.mock('@/utils/access', () => ({
  validateUserAndToken: (...a: unknown[]) => validateUserAndTokenMock(...a),
}));
vi.mock('@/utils/supabase', () => ({
  createSupabaseClient: (...a: unknown[]) => createSupabaseClientMock(...a),
}));

import { GET } from '@/app/api/library/books/route';

let calls: unknown[][];
let result: { data: unknown; error: unknown };

// Records every query-builder call; awaiting the builder yields `result`.
const makeClient = () => {
  const builder: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'eq', 'is', 'not', 'or', 'order', 'range']) {
    builder[m] = (...args: unknown[]) => {
      calls.push([m, ...args]);
      return builder;
    };
  }
  builder['then'] = (resolve: (v: unknown) => unknown) => resolve(result);
  return builder;
};

const get = (query = '', authorization: string | null = 'Bearer tok') =>
  GET(
    new Request(`https://web.readest.com/api/library/books${query}`, {
      headers: authorization ? { authorization } : {},
    }),
  );

beforeEach(() => {
  calls = [];
  result = { data: [], error: null };
  validateUserAndTokenMock.mockReset().mockResolvedValue({ user: { id: 'user-1' }, token: 'tok' });
  createSupabaseClientMock.mockReset().mockImplementation(makeClient);
});

describe('GET /api/library/books', () => {
  it('rejects requests without a valid session', async () => {
    validateUserAndTokenMock.mockResolvedValue({});
    const res = await get('', null);
    expect(res.status).toBe(401);
    expect(createSupabaseClientMock).not.toHaveBeenCalled();
  });

  it("pages the caller's uploaded EPUBs, most recently updated first", async () => {
    result = {
      data: [{ book_hash: 'h1', title: 'Moby-Dick', author: 'Herman Melville' }],
      error: null,
    };
    const res = await get('?page=2&per_page=8');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      items: [
        {
          id: 'h1',
          title: 'Moby-Dick',
          author: 'Herman Melville',
          // The download route resolves this key to the stored file by hash + extension.
          url: 'https://web.readest.com/api/storage/download?fileKey=user-1%2FReadest%2FBooks%2Fh1%2Fh1.epub',
        },
      ],
    });
    expect(createSupabaseClientMock).toHaveBeenCalledWith('tok');
    expect(calls).toEqual(
      expect.arrayContaining([
        ['from', 'books'],
        ['eq', 'user_id', 'user-1'],
        ['eq', 'format', 'EPUB'],
        ['is', 'deleted_at', null],
        ['not', 'uploaded_at', 'is', null],
        ['order', 'updated_at', { ascending: false }],
        ['order', 'book_hash'],
        // Page 2 starts right after the 8 books of page 1 and carries one
        // extra row that tells the caller another page exists.
        ['range', 8, 16],
      ]),
    );
    expect(calls.some(([m]) => m === 'or')).toBe(false);
  });

  it('defaults to the first page and caps the page size', async () => {
    await get();
    expect(calls).toContainEqual(['range', 0, 20]);

    calls = [];
    await get('?page=0&per_page=500');
    expect(calls).toContainEqual(['range', 0, 50]);
  });

  it('matches the search text against title and author', async () => {
    // Commas and parentheses would break PostgREST's or() filter syntax.
    await get(`?q=${encodeURIComponent(' Moby, (Dick) ')}`);
    expect(calls).toContainEqual(['or', 'title.ilike.%Moby Dick%,author.ilike.%Moby Dick%']);
  });

  it('reports database failures', async () => {
    result = { data: null, error: { message: 'boom' } };
    const res = await get();
    expect(res.status).toBe(500);
  });
});
