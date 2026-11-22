// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Book } from '@/types/book';

vi.mock('@/utils/access', () => ({ getAccessToken: vi.fn(async () => 'token') }));
vi.mock('@/services/environment', () => ({ getAPIBaseUrl: () => 'https://example.test/api' }));

import { SyncClient, type SyncData } from '@/libs/sync';

/** Next's default Pages Router body limit, which servers before #7814 still have. */
const OLD_SERVER_BODY_LIMIT = 1024 * 1024;

// A library bulk-imported from a local folder of Russian FB2 files: about
// 1.3 KB per book once the parsed metadata rides along, so ~1000 of them make
// a 1.6 MB push.
const makeBook = (i: number): Book =>
  ({
    hash: i.toString(16).padStart(32, '0'),
    format: 'FB2',
    title: `Варкрафт: Хроники. Энциклопедия. Том ${i}`,
    author: 'Крис Метцен, Мэтт Бернс, Роберт Брукс',
    coverImageUrl: 'blob:https://web.readest.com/00000000-0000-0000-0000-000000000000',
    createdAt: 1_700_000_000_000 + i,
    updatedAt: 1_700_000_000_000 + i,
    metadata: {
      title: `Варкрафт: Хроники. Энциклопедия. Том ${i}`,
      author: 'Крис Метцен, Мэтт Бернс, Роберт Брукс',
      language: 'ru',
      description: 'Впервые за всю историю Warcraft: летопись Азерота. '.repeat(10),
    },
  }) as Book;

const library = Array.from({ length: 1027 }, (_, i) => makeBook(i));

const fetchMock = vi.fn();
const sentBodies = () => fetchMock.mock.calls.map(([, init]) => String(init.body));
const sentPayloads = () => sentBodies().map((body) => JSON.parse(body) as SyncData);

// The server answers each request with the rows it wrote.
const echoRows = async (_url: string, init: RequestInit) => {
  const { books = [] } = JSON.parse(String(init.body)) as SyncData;
  return Response.json({
    books: books.map((b) => ({ book_hash: b.hash })),
    configs: [],
    notes: [],
  });
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(echoRows);
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

describe('SyncClient.pushChanges books', () => {
  test('sends a bulk-imported library in requests even an old server accepts', async () => {
    expect(Buffer.byteLength(JSON.stringify({ books: library }))).toBeGreaterThan(
      OLD_SERVER_BODY_LIMIT,
    );

    const result = await new SyncClient().pushChanges({ books: library });

    for (const body of sentBodies()) {
      expect(Buffer.byteLength(body)).toBeLessThanOrEqual(OLD_SERVER_BODY_LIMIT);
    }
    const hashes = library.map((b) => b.hash);
    expect(sentPayloads().flatMap((p) => p.books!.map((b) => b.hash))).toEqual(hashes);
    // The caller reconciles the rows of every request, not only the last one.
    expect(result.books?.map((row) => row.book_hash)).toEqual(hashes);
  });

  test('stops at the first failed request', async () => {
    fetchMock
      .mockImplementationOnce(echoRows)
      .mockResolvedValueOnce(new Response('Body exceeded 1mb limit', { status: 413 }));

    await expect(new SyncClient().pushChanges({ books: library })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('sends a small push, and anything pushed with the books, in one request', async () => {
    const notes = [{ bookHash: 'n', id: '1' }];
    await new SyncClient().pushChanges({ books: library.slice(0, 2), notes });

    expect(sentPayloads()).toEqual([
      { books: JSON.parse(JSON.stringify(library.slice(0, 2))), notes },
    ]);
  });

  test('sends what is pushed with the books only once', async () => {
    const notes = [{ bookHash: 'n', id: '1' }];
    await new SyncClient().pushChanges({ books: library, notes });

    expect(sentPayloads().filter((p) => p.notes)).toEqual([expect.objectContaining({ notes })]);
  });
});
