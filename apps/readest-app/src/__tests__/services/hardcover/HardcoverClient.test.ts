import { describe, test, expect, vi, beforeEach } from 'vitest';
import { HardcoverClient } from '@/services/hardcover/HardcoverClient';
import type { HardcoverSyncMapStore } from '@/services/hardcover/HardcoverSyncMapStore';
import type { Book, BookConfig, BookNote } from '@/types/book';

type MockFetchResponse = {
  ok: boolean;
  status?: number;
  statusText?: string;
  json: () => Promise<unknown>;
};

type MockFetch = ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<MockFetchResponse>>>;

type TestBookContext = {
  editionId: number;
  pages: number | null;
  bookId: number;
  bookPages: number | null;
  userBook: {
    id: number;
    status_id: number;
    user_book_reads: Array<{ id: number; started_at?: string | null }>;
  } | null;
};

type HardcoverClientTestApi = {
  token: string;
  extractISBN: (book: Book) => string | null;
  request: <TVariables, TData>(query: string, variables: TVariables) => Promise<TData>;
  fetchBookContext: (book: Book) => Promise<TestBookContext | null>;
  buildJournalPayload: (
    note: BookNote,
    config: BookConfig,
    context: TestBookContext,
  ) => { action_at: string; entry: string; event: string };
  ensureBookInLibrary: (book: Book, isReading?: boolean) => Promise<TestBookContext | null>;
  pushProgress: (book: Book, config: BookConfig) => Promise<void>;
};

type RequestSpyCall = [query: string, variables?: unknown];
type FetchMockCall = [input: unknown, init?: { body?: string }];

describe('HardcoverClient', () => {
  let mockMapStore: HardcoverSyncMapStore;
  let client: HardcoverClient;
  let clientApi: HardcoverClientTestApi;
  let fetchMock: MockFetch;
  const mockSettings = { accessToken: 'test-token' };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock HardcoverSyncMapStore
    mockMapStore = {
      getMapping: vi.fn().mockResolvedValue(null),
      getMappingByPayloadHash: vi.fn().mockResolvedValue(null),
      upsertMapping: vi.fn().mockResolvedValue(undefined),
      flush: vi.fn().mockResolvedValue(undefined),
      loadForBook: vi.fn().mockResolvedValue(undefined),
    } as unknown as HardcoverSyncMapStore;

    // Mock global fetch
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { me: { id: 1 } } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    client = new HardcoverClient(mockSettings, mockMapStore);
    clientApi = client as unknown as HardcoverClientTestApi;
  });

  test('should normalize accessToken correctly', () => {
    const rawClient = new HardcoverClient({ accessToken: 'raw-jwt' }, mockMapStore);
    expect((rawClient as unknown as HardcoverClientTestApi).token).toBe('Bearer raw-jwt');

    const bearClient = new HardcoverClient({ accessToken: 'Bearer already-has' }, mockMapStore);
    expect((bearClient as unknown as HardcoverClientTestApi).token).toBe('Bearer already-has');
  });

  test('should extract ISBN from metadata', () => {
    const book = {
      metadata: {
        isbn: '0743273567',
      },
    } as unknown as Book;

    const isbn = clientApi.extractISBN(book);
    expect(isbn).toBe('0743273567');
  });

  test('should extract ISBN from alternative identifiers', () => {
    const book = {
      metadata: {
        identifier: [{ scheme: 'ISBN', value: '9780679783268' }, 'urn:isbn:0679783261'],
      },
    } as unknown as Book;

    const isbn = clientApi.extractISBN(book);
    expect(isbn).toBe('9780679783268');
  });

  test('should deduplicate notes correctly in syncBookNotes', async () => {
    const book = {
      hash: 'book-hash',
      title: 'Test Book',
      author: 'Test',
      metadata: { isbn: '1234567890' }, // Add ISBN to trigger QUERY_GET_EDITION
    } as unknown as Book;

    const config = {
      booknotes: [
        {
          id: 'note-1',
          type: 'annotation',
          text: 'Shared Text',
          note: 'Some note',
          cfi: 'epubcfi(/6/4[chap1]!/4/2,/1:10,/1:22)',
        },
        {
          id: 'note-2',
          type: 'excerpt',
          text: 'Shared Text',
          cfi: 'epubcfi(/6/4[chap1]!/4/2,/1:10,/1:23)', // Slightly different end offset only
        },
        {
          id: 'note-3',
          type: 'annotation',
          text: 'Other Text',
          note: '',
        },
      ] as BookNote[],
    } as BookConfig;

    // Setup mocks for authenticate & fetch context & insert
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { me: { id: 1 } } }), // authenticate
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            editions: [
              {
                id: 101,
                book: {
                  id: 202,
                  user_books: [
                    {
                      id: 303,
                      user_book_reads: [],
                    },
                  ],
                },
              },
            ],
          },
        }), // fetchContext (QUERY_GET_EDITION)
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { insert_reading_journal: { id: 999 } } }), // generic inserts
    });

    const results = await client.syncBookNotes(book, config);

    // note-1: kept (annotation with note)
    // note-2: skipped (excerpt at same location/text as note-1)
    // note-3: kept (annotation with no note, but no conflicts)
    expect(results.inserted).toBe(2);
    expect(results.skipped).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(mockMapStore.flush).toHaveBeenCalled();
  });

  test('should handle rate limiting with retries', async () => {
    // request() does NOT call authenticate() so only 2 mock values are needed
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    // First request fails with 429 then succeeds
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      json: async () => ({}),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { result: 'ok' } }),
    });

    // Speed up sleep for test
    vi.useFakeTimers();
    const requestPromise = clientApi.request<{ var: number }, { result: string }>('query', {
      var: 1,
    });

    // Wait for the 429 retry
    await vi.runAllTimersAsync();
    const result = await requestPromise;

    expect(result).toEqual({ result: 'ok' });
    vi.useRealTimers();
  });

  test('should produce the expected date formats for journal and progress payloads', async () => {
    const note = {
      updatedAt: 1711737600000, // 2026-03-29 ...
      type: 'annotation',
      text: 'Test',
      id: '1',
    } as BookNote;
    const config = { progress: [5, 100] } as BookConfig;
    const context: TestBookContext = {
      editionId: 2,
      pages: 100,
      bookId: 1,
      bookPages: 100,
      userBook: null,
    };

    // Test journal payload
    const payload = clientApi.buildJournalPayload(note, config, context);
    // Should be full ISO (e.g. 2026-03-29T16:00:00.000Z), length > 20
    expect(payload.action_at.length).toBeGreaterThan(10);
    expect(payload.action_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Test progress payload (started_at)
    const book = { createdAt: 1711737600000 } as Book;
    vi.spyOn(clientApi, 'ensureBookInLibrary').mockResolvedValue({
      editionId: 2,
      pages: 100,
      bookId: 1,
      bookPages: 100,
      userBook: {
        id: 3,
        status_id: 2,
        user_book_reads: [],
      },
    });
    const requestSpy = vi.spyOn(clientApi, 'request').mockResolvedValue({});
    await clientApi.pushProgress(book, config);

    const requestCalls = requestSpy.mock.calls as RequestSpyCall[];
    const progressCall = requestCalls.find((call) => {
      const query = call[0];
      return typeof query === 'string' && query.includes('mutation InsertRead');
    });
    expect(progressCall).toBeDefined();
    const variables = progressCall?.[1] as { started_at?: string } | undefined;
    expect(variables?.started_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('should prefer the active user read edition when resolving Hardcover context', async () => {
    const book = {
      metadata: {
        isbn: '9780679783268',
      },
    } as unknown as Book;

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { me: { id: 1 } } }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          data: {
            editions: [
              {
                id: 101,
                pages: 320,
                reading_format_id: 1,
                book: {
                  id: 202,
                  pages: 500,
                  user_books: [
                    {
                      id: 303,
                      status_id: 2,
                      edition: {
                        id: 404,
                        pages: 410,
                        reading_format_id: 1,
                      },
                      user_book_reads: [
                        {
                          id: 505,
                          started_at: '2026-03-29',
                          edition: {
                            id: 606,
                            pages: 400,
                            reading_format_id: 1,
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        }),
    });

    const context = await clientApi.ensureBookInLibrary(book, true);

    expect(context).toMatchObject({
      editionId: 606,
      pages: 400,
      bookId: 202,
      bookPages: 500,
      userBook: {
        id: 303,
      },
    });
  });

  test('should format multiline quote text with a short divider before the note', () => {
    const note = {
      id: '1',
      type: 'annotation',
      text: "She smiled. 'Are you, Overseer? Still?'\n\n'What do you mean?'",
      note: 'Follow-up note',
    } as BookNote;
    const config = { progress: [5, 100] } as BookConfig;
    const context: TestBookContext = {
      editionId: 2,
      pages: 100,
      bookId: 1,
      bookPages: 100,
      userBook: null,
    };

    const payload = clientApi.buildJournalPayload(note, config, context);

    expect(payload.event).toBe('note');
    expect(payload.entry).toBe(
      "She smiled. 'Are you, Overseer? Still?'\n\n'What do you mean?'\n\n━━━\n\nFollow-up note",
    );
  });

  test('should promote an existing user book to currently reading before syncing progress', async () => {
    const book = {
      createdAt: 1711737600000,
      metadata: { isbn: '1234567890' },
    } as Book;
    const config = { progress: [25, 100] } as BookConfig;

    vi.spyOn(clientApi, 'ensureBookInLibrary').mockResolvedValue({
      editionId: 101,
      pages: 100,
      bookId: 202,
      bookPages: 100,
      userBook: {
        id: 303,
        status_id: 1,
        user_book_reads: [],
      },
    });
    const requestSpy = vi.spyOn(clientApi, 'request').mockResolvedValue({});

    await client.pushProgress(book, config);

    const requestCalls = requestSpy.mock.calls as RequestSpyCall[];
    const calls = requestCalls.map((call) => {
      return {
        query: String(call[0]),
        variables: call[1] as Record<string, unknown> | undefined,
      };
    });
    const firstCall = calls[0];
    const secondCall = calls[1];
    if (!firstCall || !secondCall) {
      throw new Error('Expected both UpdateUserBook and InsertRead calls');
    }

    expect(firstCall.query).toContain('mutation UpdateUserBook');
    expect(firstCall.variables).toEqual({
      user_book_id: 303,
      object: { status_id: 2 },
    });
    expect(secondCall.query).toContain('mutation InsertRead');
    expect(secondCall.variables).toMatchObject({
      user_book_id: 303,
      progress_pages: 25,
      edition_id: 101,
      started_at: '2024-03-29',
    });
  });

  test('should reuse the active read returned when promoting a book to currently reading', async () => {
    const book = {
      createdAt: 1711737600000,
      metadata: { isbn: '1234567890' },
    } as Book;
    const config = { progress: [25, 100] } as BookConfig;

    vi.spyOn(clientApi, 'ensureBookInLibrary').mockResolvedValue({
      editionId: 101,
      pages: 100,
      bookId: 202,
      bookPages: 100,
      userBook: {
        id: 303,
        status_id: 1,
        user_book_reads: [],
      },
    });

    const requestSpy = vi.spyOn(clientApi, 'request').mockImplementation(async (query) => {
      if (String(query).includes('mutation UpdateUserBook')) {
        return {
          update_user_book: {
            user_book: {
              user_book_reads: [{ id: 404, started_at: '2024-03-29' }],
            },
          },
        };
      }

      return {};
    });

    await client.pushProgress(book, config);

    const requestCalls = requestSpy.mock.calls as RequestSpyCall[];
    const updateReadCall = requestCalls.find((call) =>
      String(call[0]).includes('mutation UpdateRead'),
    );
    const insertReadCall = requestCalls.find((call) =>
      String(call[0]).includes('mutation InsertRead'),
    );

    expect(updateReadCall).toBeDefined();
    expect(insertReadCall).toBeUndefined();
    expect(updateReadCall?.[1]).toMatchObject({
      id: 404,
      progress_pages: 25,
      edition_id: 101,
      started_at: '2024-03-29',
    });
  });

  test('should reuse the active read returned when adding a book through sync', async () => {
    const book = {
      createdAt: 1711737600000,
      title: 'Test Book',
      author: 'Test Author',
    } as Book;
    const config = { progress: [25, 100] } as BookConfig;

    vi.spyOn(clientApi, 'fetchBookContext').mockResolvedValue({
      editionId: 101,
      pages: 100,
      bookId: 202,
      bookPages: 100,
      userBook: null,
    } as TestBookContext);

    const requestSpy = vi.spyOn(clientApi, 'request').mockImplementation(async (query) => {
      if (String(query).includes('mutation InsertUserBook')) {
        return {
          insert_user_book: {
            user_book: {
              id: 303,
              user_book_reads: [{ id: 404, started_at: '2024-03-29' }],
            },
          },
        };
      }

      return {};
    });

    await client.pushProgress(book, config);

    const requestCalls = requestSpy.mock.calls as RequestSpyCall[];
    const updateReadCall = requestCalls.find((call) =>
      String(call[0]).includes('mutation UpdateRead'),
    );
    const insertReadCall = requestCalls.find((call) =>
      String(call[0]).includes('mutation InsertRead'),
    );

    expect(updateReadCall).toBeDefined();
    expect(insertReadCall).toBeUndefined();
    expect(updateReadCall?.[1]).toMatchObject({
      id: 404,
      progress_pages: 25,
      edition_id: 101,
      started_at: '2024-03-29',
    });
  });

  test('should scale progress pages from local percentage to Hardcover edition pages', async () => {
    const book = {
      createdAt: 1711737600000,
      metadata: { isbn: '1234567890' },
    } as Book;
    const config = { progress: [25, 100] } as BookConfig;

    vi.spyOn(clientApi, 'ensureBookInLibrary').mockResolvedValue({
      editionId: 101,
      pages: 400,
      bookId: 202,
      bookPages: 400,
      userBook: {
        id: 303,
        status_id: 2,
        user_book_reads: [],
      },
    });
    const requestSpy = vi.spyOn(clientApi, 'request').mockResolvedValue({});

    await client.pushProgress(book, config);

    const requestCalls = requestSpy.mock.calls as RequestSpyCall[];
    const insertReadCall = requestCalls.find((call) =>
      String(call[0]).includes('mutation InsertRead'),
    );
    expect(insertReadCall).toBeDefined();
    expect(insertReadCall?.[1]).toMatchObject({
      user_book_id: 303,
      edition_id: 101,
      progress_pages: 100,
      started_at: '2024-03-29',
    });
  });

  test('should not promote an existing user book when syncing notes only', async () => {
    const book = {
      hash: 'book-hash',
      title: 'Test Book',
      author: 'Test Author',
      metadata: { isbn: '1234567890' },
    } as unknown as Book;
    const config = {
      progress: [25, 100],
      booknotes: [
        {
          id: 'note-1',
          type: 'annotation',
          text: 'Shared Text',
          note: 'Some note',
          cfi: 'epubcfi(/6/4[chap1]!/4/2,10/10)',
        },
      ] as BookNote[],
    } as BookConfig;

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { me: { id: 1 } } }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            editions: [
              {
                id: 101,
                pages: 100,
                book: {
                  id: 202,
                  pages: 100,
                  user_books: [
                    {
                      id: 303,
                      status_id: 3,
                      user_book_reads: [],
                    },
                  ],
                },
              },
            ],
          },
        }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { insert_reading_journal: { id: 999 } } }),
    });

    const result = await client.syncBookNotes(book, config);
    const fetchCalls = fetchMock.mock.calls as FetchMockCall[];
    const calls = fetchCalls.map((call) => JSON.parse(call[1]?.body ?? '{}'));

    expect(result.inserted).toBe(1);
    expect(
      calls.some((call: { query: string }) => call.query.includes('mutation UpdateUserBook')),
    ).toBe(false);
  });

  test('should throw when insert_user_book returns a null user_book', async () => {
    const book = { title: 'Test Book', author: 'Test Author' } as Book;
    const config = { progress: [25, 100] } as BookConfig;

    vi.spyOn(clientApi, 'fetchBookContext').mockResolvedValue({
      editionId: 101,
      pages: 100,
      bookId: 202,
      bookPages: 100,
      userBook: null,
    } as TestBookContext);

    vi.spyOn(clientApi, 'request').mockImplementation(async (query) => {
      if (String(query).includes('mutation InsertUserBook')) {
        return { insert_user_book: { error: 'conflict', user_book: null } };
      }
      return {};
    });

    await expect(client.pushProgress(book, config)).rejects.toThrow('insert_user_book failed');
  });

  test('should skip progress push when Hardcover edition page count is unknown', async () => {
    const book = { createdAt: 1711737600000, metadata: { isbn: '1234567890' } } as Book;
    const config = { progress: [25, 100] } as BookConfig;

    vi.spyOn(clientApi, 'ensureBookInLibrary').mockResolvedValue({
      editionId: 101,
      pages: null,
      bookId: 202,
      bookPages: null,
      userBook: { id: 303, status_id: 2, user_book_reads: [] },
    } as TestBookContext);
    const requestSpy = vi.spyOn(clientApi, 'request').mockResolvedValue({});

    await client.pushProgress(book, config);

    const requestCalls = requestSpy.mock.calls as RequestSpyCall[];
    const insertReadCall = requestCalls.find((call) =>
      String(call[0]).includes('mutation InsertRead'),
    );
    const updateReadCall = requestCalls.find((call) =>
      String(call[0]).includes('mutation UpdateRead'),
    );
    expect(insertReadCall).toBeUndefined();
    expect(updateReadCall).toBeUndefined();
  });

  test('should apply edition preference when resolving context via title search', async () => {
    const book = { title: 'Test Book', author: 'Test Author' } as Book;

    // authenticate
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { me: { id: 1 } } }),
    });
    // QUERY_SEARCH_BOOK
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          data: {
            search: {
              results: [{ id: 202, pages: 300, featured_edition_id: 101 }],
            },
          },
        }),
    });
    // QUERY_GET_BOOK_USER_DATA
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          data: {
            editions: [
              {
                book: {
                  id: 202,
                  pages: 300,
                  user_books: [
                    {
                      id: 303,
                      status_id: 2,
                      edition: { id: 404, pages: 310, reading_format_id: 1 },
                      user_book_reads: [
                        {
                          id: 505,
                          started_at: '2026-03-29',
                          edition: { id: 606, pages: 400, reading_format_id: 1 },
                        },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        }),
    });

    const context = await clientApi.fetchBookContext(book);

    expect(context).toMatchObject({
      editionId: 606,
      pages: 400,
      bookId: 202,
      bookPages: 300,
      userBook: { id: 303 },
    });
  });
});
