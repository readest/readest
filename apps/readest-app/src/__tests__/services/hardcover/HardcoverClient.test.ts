import { describe, test, expect, vi, beforeEach } from 'vitest';
import { HardcoverClient } from '@/services/hardcover/HardcoverClient';
import { getContentMd5 } from '@/utils/misc';
import { HardcoverSyncMapStore } from '@/services/hardcover/HardcoverSyncMapStore';
import type { AppService } from '@/types/system';
import type { Book, BookConfig, BookNote, HardcoverBookLink } from '@/types/book';

type MockFetchResponse = {
  ok: boolean;
  status?: number;
  statusText?: string;
  headers?: Headers;
  json: () => Promise<unknown>;
};

type MockFetch = ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<MockFetchResponse>>>;

type TestBookContext = {
  editionId: number | null;
  pages: number | null;
  bookId: number;
  bookPages: number | null;
  title?: string;
  userBook: {
    id: number;
    status_id: number;
    user_book_reads: Array<{ id: number; started_at?: string | null }>;
  } | null;
};

type HardcoverClientTestApi = {
  token: string;
  authenticate: () => Promise<void>;
  privacySettingId: number;
  extractISBN: (book: Book) => string | null;
  request: <TVariables, TData>(query: string, variables: TVariables) => Promise<TData>;
  fetchBookContext: (
    book: Book,
    link?: HardcoverBookLink | null,
  ) => Promise<TestBookContext | null>;
  buildJournalPayload: (
    note: BookNote,
    config: BookConfig,
    context: TestBookContext,
  ) => { action_at: string; entry: string; event: string };
  ensureBookInLibrary: (
    book: Book,
    link?: HardcoverBookLink | null,
  ) => Promise<TestBookContext | null>;
  pushProgress: (book: Book, config: BookConfig) => Promise<HardcoverBookLink>;
};

type RequestSpyCall = [query: string, variables?: unknown];
type FetchMockCall = [input: unknown, init?: { body?: string }];

describe('HardcoverClient', () => {
  let mockMapStore: HardcoverSyncMapStore;
  let client: HardcoverClient;
  let clientApi: HardcoverClientTestApi;
  let fetchMock: MockFetch;
  const mockSettings = { accessToken: 'test-token' };
  let tokenSeq = 0;

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
    // Real responses always carry headers; mocks may omit them.
    vi.stubGlobal('fetch', async (...args: unknown[]) => ({
      headers: new Headers(),
      ...(await fetchMock(...args)),
    }));

    // Rate-limit state is shared per token, so isolate tests with a fresh one.
    mockSettings.accessToken = `test-token-${tokenSeq++}`;
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
    fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as { body: string }).body);
      const data = { insert_reading_journal: { id: 999 } };
      const json = Array.isArray(body) ? body.map(() => ({ data })) : { data };
      return { ok: true, json: () => Promise.resolve(json) };
    });

    const results = await client.syncBookNotes(book, config);

    // note-1: kept (annotation with note)
    // note-2: skipped (excerpt at same location/text as note-1)
    // note-3: kept (annotation with no note, but no conflicts)
    expect(results.inserted).toBe(2);
    expect(results.skipped).toBe(0);
    // authenticate, edition lookup, one batched journal write
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(mockMapStore.flush).toHaveBeenCalled();
  });

  test('retries a 503 with backoff', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Retry later',
      json: async () => ({}),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { result: 'ok' } }),
    });

    vi.useFakeTimers();
    const requestPromise = clientApi.request<{ var: number }, { result: string }>('query', {
      var: 1,
    });
    await vi.runAllTimersAsync();

    await expect(requestPromise).resolves.toEqual({ result: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  test('retries 429s honoring Retry-After, else exponential backoff, and gives up when exhausted', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.useFakeTimers();
    const res429 = (retryAfter?: string) => ({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: new Headers(retryAfter ? { 'Retry-After': retryAfter } : {}),
      json: async () => ({}),
    });
    const ok = { ok: true, json: () => Promise.resolve({ data: { result: 'ok' } }) };
    // Fresh token per run: the gate is shared per token and stays blocked after a 429.
    const run = () =>
      (
        new HardcoverClient(
          { accessToken: `rl-${tokenSeq++}` },
          mockMapStore,
        ) as unknown as HardcoverClientTestApi
      ).request<object, { result: string }>('query', {});

    // Retry-After: 3 → second attempt not before 3s
    fetchMock.mockResolvedValueOnce(res429('3')).mockResolvedValueOnce(ok);
    let p = run();
    await vi.advanceTimersByTimeAsync(2900);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    await expect(p).resolves.toEqual({ result: 'ok' });

    // No header → 2s backoff
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(res429()).mockResolvedValueOnce(ok);
    p = run();
    await vi.advanceTimersByTimeAsync(1900);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    await expect(p).resolves.toEqual({ result: 'ok' });

    // Retry-After beyond the cap (e.g. daily limit) and exhausted retries both throw
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(res429('3600'));
    await expect(run()).rejects.toThrow('Rate Limit (429)');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(res429('1'));
    p = run();
    const assertion = expect(p).rejects.toThrow('Rate Limit (429)');
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });

  test('sends back-to-back until RateLimit reports an empty bucket, shared across clients', async () => {
    vi.useFakeTimers();
    const withLimit = (rateLimit: string) => ({
      ok: true,
      headers: new Headers({ RateLimit: rateLimit }),
      json: () => Promise.resolve({ data: {} }),
    });
    const other = new HardcoverClient(
      mockSettings,
      mockMapStore,
    ) as unknown as HardcoverClientTestApi;

    fetchMock.mockResolvedValueOnce(withLimit('"Free";r=5;t=10, "daily";r=100;t=999'));
    await clientApi.request('q', {});
    await clientApi.request('q', {});
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(withLimit('"Free";r=0;t=4'));
    await clientApi.request('q', {});
    const p = other.request('q', {});
    await vi.advanceTimersByTimeAsync(3900);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    await p;
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1000);
    // An empty daily bucket doesn't discard that response, but blocks later requests
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(withLimit('"Free";r=3;t=1, "daily";r=0;t=3600'));
    await expect(clientApi.request('q', {})).resolves.toEqual({});
    await expect(other.request('q', {})).rejects.toThrow('rate limit reached');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  test('releases waiters one at a time after a block', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ RateLimit: '"Free";r=0;t=2' }),
      json: () => Promise.resolve({ data: {} }),
    });
    await clientApi.request('q', {});
    fetchMock.mockClear();

    const calls = [
      clientApi.request('q', {}),
      clientApi.request('q', {}),
      clientApi.request('q', {}),
    ];
    await vi.advanceTimersByTimeAsync(1900);
    expect(fetchMock).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all(calls);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  test('includes the error and missing scope from a 403 body', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: async () => ({ error: 'insufficient_scope', scope: 'write:library' }),
    });
    await expect(clientApi.request('query', {})).rejects.toThrow(
      'Hardcover API Error: 403 Forbidden: insufficient_scope — scope: write:library',
    );
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

    const context = await clientApi.ensureBookInLibrary(book);

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

  test("reads the account's default visibility, private until it is known", async () => {
    expect(clientApi.privacySettingId).toBe(3);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { me: [{ id: 1, account_privacy_setting_id: 1 }] } }),
    });
    await clientApi.authenticate();
    expect(clientApi.privacySettingId).toBe(1);
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
      json: () => Promise.resolve([{ data: { insert_reading_journal: { id: 999 } } }]),
    });

    const result = await client.syncBookNotes(book, config);
    const fetchCalls = fetchMock.mock.calls as FetchMockCall[];
    // Journal writes arrive as an array of operations.
    const calls = fetchCalls.flatMap((call) => JSON.parse(call[1]?.body ?? '{}'));

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

  test('should fail the progress push when Hardcover edition page count is unknown', async () => {
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

    // Nothing can be sent, so the caller must not report a sync (or remember
    // the match) on the strength of a no-op.
    await expect(client.pushProgress(book, config)).rejects.toThrow('page count');

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

  const respond = (data: unknown) =>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data }),
    });

  const requestBodies = () =>
    (fetchMock.mock.calls as FetchMockCall[]).map(
      (call) =>
        JSON.parse(call[1]?.body ?? '{}') as {
          query: string;
          variables?: Record<string, unknown>;
        },
    );

  test('should apply edition preference when resolving context via title search', async () => {
    const book = { title: 'Test Book', author: 'Test Author' } as Book;

    respond({ me: { id: 1 } }); // authenticate
    respond({ search: { ids: ['202'] } }); // QUERY_SEARCH_BOOKS
    respond({
      books: [
        {
          id: 202,
          title: 'Test Book',
          pages: 300,
          editions: [{ id: 101, pages: 290, reading_format_id: 1 }],
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
      ],
    }); // QUERY_GET_BOOKS

    const context = await clientApi.fetchBookContext(book);

    expect(context).toMatchObject({
      editionId: 606,
      pages: 400,
      bookId: 202,
      bookPages: 300,
      title: 'Test Book',
      userBook: { id: 303 },
    });
  });

  test('auto-match prefers a hit already on the shelf over an earlier audiobook-only hit (#5846)', async () => {
    const book = { title: 'Project Hail Mary', author: 'Andy Weir' } as Book;

    respond({ me: { id: 1 } });
    respond({ search: { ids: ['111', '222', '333'] } });
    // Hasura's `_in` returns rows in arbitrary order, not search rank.
    respond({
      books: [
        {
          id: 333,
          title: 'Project Hail Mary (ebook)',
          pages: 476,
          editions: [{ id: 3, pages: 476, reading_format_id: 1 }],
          user_books: [{ id: 900, status_id: 2, edition: null, user_book_reads: [] }],
        },
        {
          id: 111,
          title: 'Project Hail Mary (audiobook)',
          pages: null,
          editions: [],
          user_books: [],
        },
        {
          id: 222,
          title: 'Project Hail Mary',
          pages: 480,
          editions: [{ id: 2, pages: 480, reading_format_id: 4 }],
          user_books: [],
        },
      ],
    });

    const context = await clientApi.fetchBookContext(book);

    expect(context).toMatchObject({
      bookId: 333,
      editionId: 3,
      pages: 476,
      userBook: { id: 900 },
    });
  });

  test('auto-match ignores an on-shelf audiobook-only entry in favour of a readable hit (#5846)', async () => {
    // The issue's exact shelf state: an earlier sync already added the
    // audiobook entry as "currently reading", and it outranks the real book.
    const book = { title: 'Project Hail Mary', author: 'Andy Weir' } as Book;

    respond({ me: { id: 1 } });
    respond({ search: { ids: ['111', '222'] } });
    respond({
      books: [
        {
          id: 111,
          title: 'Project Hail Mary (audiobook)',
          pages: null,
          editions: [],
          user_books: [{ id: 900, status_id: 2, edition: null, user_book_reads: [] }],
        },
        {
          id: 222,
          title: 'Project Hail Mary',
          pages: 480,
          editions: [{ id: 2, pages: 480, reading_format_id: 1 }],
          user_books: [],
        },
      ],
    });

    const context = await clientApi.fetchBookContext(book);

    expect(context).toMatchObject({ bookId: 222, editionId: 2, pages: 480, userBook: null });
  });

  test('auto-match skips audiobook-only hits when nothing is on the shelf (#5846)', async () => {
    const book = { title: 'Project Hail Mary', author: 'Andy Weir' } as Book;

    respond({ me: { id: 1 } });
    respond({ search: { ids: ['111', '222'] } });
    respond({
      books: [
        {
          id: 111,
          title: 'Project Hail Mary (audiobook)',
          pages: null,
          editions: [],
          user_books: [],
        },
        {
          id: 222,
          title: 'Project Hail Mary',
          pages: 480,
          editions: [{ id: 2, pages: 480, reading_format_id: 1 }],
          user_books: [],
        },
      ],
    });

    const context = await clientApi.fetchBookContext(book);

    expect(context).toMatchObject({
      bookId: 222,
      editionId: 2,
      pages: 480,
      bookPages: 480,
      userBook: null,
    });
  });

  test('auto-match resolves nothing when every hit is audiobook-only', async () => {
    respond({ me: { id: 1 } });
    respond({ search: { ids: ['111'] } });
    respond({
      books: [{ id: 111, title: 'Audio only', pages: null, editions: [], user_books: [] }],
    });

    const context = await clientApi.fetchBookContext({ title: 'Audio only', author: 'A' } as Book);

    expect(context).toBeNull();
  });

  test('a linked book resolves directly by id, bypassing ISBN and title matching', async () => {
    const book = {
      title: 'Local Title',
      author: 'Local Author',
      metadata: { isbn: '9780679783268' },
    } as unknown as Book;

    respond({ me: { id: 1 } });
    respond({
      books: [
        {
          id: 777,
          title: 'Linked Title',
          pages: 200,
          editions: [{ id: 70, pages: 210, reading_format_id: 1 }],
          user_books: [],
        },
      ],
    });

    const context = await clientApi.fetchBookContext(book, { bookId: 777, title: 'Linked Title' });

    expect(context).toMatchObject({
      bookId: 777,
      editionId: 70,
      pages: 210,
      bookPages: 200,
      title: 'Linked Title',
      userBook: null,
    });
    const bodies = requestBodies();
    expect(bodies.some((body) => body.query.includes('query GetEdition'))).toBe(false);
    expect(bodies.some((body) => body.query.includes('query SearchBooks'))).toBe(false);
    expect(
      bodies.find((body) => body.query.includes('query GetBooks'))?.variables?.['ids'],
    ).toEqual([777]);
  });

  test('a linked book that no longer exists on Hardcover resolves to nothing', async () => {
    respond({ me: { id: 1 } });
    respond({ books: [] });

    const context = await clientApi.fetchBookContext({ title: 'X', author: 'Y' } as Book, {
      bookId: 1,
      title: 'Gone',
    });

    expect(context).toBeNull();
  });

  test('leaves the edition id unresolved when the linked book has no readable edition and the user has none selected', async () => {
    respond({ me: { id: 1 } });
    respond({
      books: [
        {
          id: 713309,
          title: 'Crime and Punishment',
          pages: 311,
          editions: [],
          user_books: [
            {
              id: 303,
              status_id: 2,
              edition: null,
              user_book_reads: [{ id: 505, started_at: '2026-06-25', edition: null }],
            },
          ],
        },
      ],
    });

    const context = await clientApi.fetchBookContext(
      { title: 'Crime and Punishment', author: 'Fyodor Dostoevsky' } as Book,
      { bookId: 713309, title: 'Crime and Punishment' },
    );

    expect(context?.bookId).toBe(713309);
    // Regression #4792: the edition id must NOT fall back to the book id. Sending
    // a book id as edition_id makes Hardcover's Action reject the read mutation
    // with a parse-failed error. Leave it null when no real edition is known.
    expect(context?.editionId).toBeNull();
    expect(context?.pages).toBe(311);
  });

  test('searchBooks returns candidates in search-rank order with shelf and format flags', async () => {
    respond({ me: { id: 1 } });
    respond({ search: { ids: ['111', '222'] } });
    respond({
      books: [
        {
          id: 222,
          title: 'Ebook Entry',
          pages: 480,
          release_year: 2021,
          users_read_count: 1200,
          cached_image: { url: 'https://assets.hardcover.app/cover.jpg' },
          cached_contributors: [
            { author: { name: 'Andy Weir' }, contribution: null },
            { author: { name: 'Ray Porter' }, contribution: 'Narrator' },
          ],
          editions: [{ id: 2, pages: 480, reading_format_id: 1 }],
          user_books: [{ id: 900, status_id: 2, edition: null, user_book_reads: [] }],
        },
        {
          id: 111,
          title: 'Audiobook Entry',
          pages: null,
          release_year: null,
          users_read_count: 3,
          cached_image: null,
          cached_contributors: [],
          editions: [],
          user_books: [],
        },
      ],
    });

    const results = await client.searchBooks('Project Hail Mary Andy Weir');

    expect(results).toEqual([
      {
        bookId: 111,
        title: 'Audiobook Entry',
        authors: [],
        coverUrl: null,
        releaseYear: null,
        pages: null,
        readersCount: 3,
        readable: false,
        onShelf: false,
      },
      {
        bookId: 222,
        title: 'Ebook Entry',
        authors: ['Andy Weir'],
        coverUrl: 'https://assets.hardcover.app/cover.jpg',
        releaseYear: 2021,
        pages: 480,
        readersCount: 1200,
        readable: true,
        onShelf: true,
      },
    ]);
    const search = requestBodies().find((body) => body.query.includes('query SearchBooks'));
    expect(search?.variables?.['query']).toBe('Project Hail Mary Andy Weir');
  });

  test('searchBooks returns nothing for a blank query without hitting the API', async () => {
    const results = await client.searchBooks('   ');

    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('pushProgress returns the resolved link and throws when nothing resolves', async () => {
    const book = { createdAt: 1711737600000, title: 'Test Book', author: 'Test Author' } as Book;
    const config = { progress: [25, 100] } as BookConfig;

    const contextSpy = vi.spyOn(clientApi, 'ensureBookInLibrary').mockResolvedValue({
      editionId: 101,
      pages: 100,
      bookId: 202,
      bookPages: 100,
      title: 'Resolved Title',
      userBook: { id: 303, status_id: 2, user_book_reads: [] },
    });
    vi.spyOn(clientApi, 'request').mockResolvedValue({});

    await expect(client.pushProgress(book, config)).resolves.toEqual({
      bookId: 202,
      title: 'Resolved Title',
    });

    contextSpy.mockResolvedValue(null);
    await expect(client.pushProgress(book, config)).rejects.toThrow(
      'Unable to resolve this book in Hardcover',
    );
  });

  test('pushProgress hands the stored link to context resolution', async () => {
    const book = { createdAt: 1711737600000, title: 'Test Book', author: 'Test Author' } as Book;
    const link = { bookId: 777, title: 'Linked' };
    const config = { progress: [25, 100], hardcover: link } as BookConfig;
    const contextSpy = vi.spyOn(clientApi, 'fetchBookContext').mockResolvedValue({
      editionId: 70,
      pages: 200,
      bookId: 777,
      bookPages: 200,
      title: 'Linked',
      userBook: { id: 1, status_id: 2, user_book_reads: [] },
    });
    vi.spyOn(clientApi, 'request').mockResolvedValue({});

    await client.pushProgress(book, config);

    expect(contextSpy).toHaveBeenCalledWith(book, link);
  });

  test('forwards a null edition id to the read mutation when no edition is resolved (#4792)', async () => {
    const book = {
      createdAt: 1711737600000,
      title: 'Crime and Punishment',
      author: 'Test',
    } as Book;
    const config = { progress: [3, 311] } as BookConfig;

    vi.spyOn(clientApi, 'ensureBookInLibrary').mockResolvedValue({
      editionId: null,
      pages: 311,
      bookId: 713309,
      bookPages: 311,
      userBook: {
        id: 303,
        status_id: 2,
        user_book_reads: [{ id: 505, started_at: '2026-06-25' }],
      },
    });
    const requestSpy = vi.spyOn(clientApi, 'request').mockResolvedValue({});

    await client.pushProgress(book, config);

    const requestCalls = requestSpy.mock.calls as RequestSpyCall[];
    const updateReadCall = requestCalls.find((call) =>
      String(call[0]).includes('mutation UpdateRead'),
    );
    expect(updateReadCall).toBeDefined();
    const variables = updateReadCall?.[1] as { edition_id?: unknown };
    expect(variables.edition_id).toBeNull();
  });
});

describe('HardcoverClient journal batching', () => {
  const book = { hash: 'book-hash', title: 'T', author: 'A' } as unknown as Book;
  const context = { editionId: 1, pages: 100, bookId: 2, bookPages: 100, userBook: { id: 3 } };
  type Op = { query: string; variables: Record<string, unknown> };
  let client: HardcoverClient;
  let api: HardcoverClientTestApi & { gate: { update: (h: Headers) => void } };
  let fetchMock: ReturnType<typeof vi.fn>;
  let mapStore: Record<string, ReturnType<typeof vi.fn>>;
  let tokenSeq = 0;

  const notes = (n: number, text = (i: number) => `text ${i}`) =>
    Array.from({ length: n }, (_, i) => ({
      id: `n${i}`,
      type: 'annotation',
      text: text(i),
    })) as BookNote[];
  const config = (booknotes: BookNote[]) => ({ booknotes, progress: [1, 100] }) as BookConfig;
  const staleMapping = (noteId: string) =>
    mapStore['getMapping']!.mockImplementation(async (_hash: string, id: string) =>
      id === noteId ? { hardcover_journal_id: 55, payload_hash: 'stale' } : null,
    );

  // Each request body is an array of operations.
  const batches = () =>
    (fetchMock.mock.calls as FetchMockCall[]).map((c) => JSON.parse(c[1]?.body ?? '[]') as Op[]);
  const response = (json: unknown, init = {}) => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: () => Promise.resolve(json),
    ...init,
  });
  const inserted = (id: number) => ({ data: { insert_reading_journal: { id } } });

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mapStore = {
      getMapping: vi.fn().mockResolvedValue(null),
      getMappingByPayloadHash: vi.fn().mockResolvedValue(null),
      upsertMapping: vi.fn().mockResolvedValue(undefined),
      flush: vi.fn().mockResolvedValue(undefined),
      loadForBook: vi.fn().mockResolvedValue(undefined),
    };
    client = new HardcoverClient(
      { accessToken: `batch-${tokenSeq++}` },
      mapStore as unknown as HardcoverSyncMapStore,
    );
    api = client as unknown as typeof api;
    vi.spyOn(api, 'ensureBookInLibrary').mockResolvedValue(context as TestBookContext);
    // Answers each batch with ids 900+index.
    fetchMock.mockImplementation(async (_url, init) => {
      const ops = JSON.parse((init as { body: string }).body) as Op[];
      return response(ops.map((_, i) => inserted(900 + i)));
    });
  });

  test('sends new notes in batches sized to the quota and maps each one', async () => {
    const result = await client.syncBookNotes(book, config(notes(12)));

    expect(result).toMatchObject({ inserted: 12, updated: 0, skipped: 0 });
    expect(batches().map((b) => b.length)).toEqual([10, 2]);
    expect(mapStore['upsertMapping']).toHaveBeenCalledTimes(12);
    expect(mapStore['upsertMapping']).toHaveBeenCalledWith(
      'book-hash',
      'n11',
      901,
      expect.any(String),
    );

    // Never more than the bucket has left: each operation counts as a request.
    fetchMock.mockClear();
    api.gate.update(new Headers({ RateLimit: '"Free";r=4;t=30' }));
    await client.syncBookNotes(book, config(notes(6)));
    expect(batches().map((b) => b.length)).toEqual([4, 2]);
  });

  test('mixes inserts and updates in one request', async () => {
    staleMapping('n0');

    const result = await client.syncBookNotes(book, config(notes(2)));

    expect(result).toMatchObject({ inserted: 1, updated: 1 });
    const [update, insert] = batches()[0]!;
    expect(update!.query).toContain('UpdateReadingJournal');
    expect(update!.variables).toMatchObject({ id: 55 });
    expect(insert!.query).toContain('InsertReadingJournal');
    expect(insert!.variables).toMatchObject({ book_id: 2 });
    expect(mapStore['upsertMapping']).toHaveBeenCalledWith(
      'book-hash',
      'n0',
      55,
      expect.any(String),
    );
  });

  test('re-inserts every note after another store clears the mappings (re-link, #5846)', async () => {
    // In-memory hardcover_note_mappings table shared by every store, like the real database.
    const rows = new Map<string, unknown[]>();
    const db = {
      select: async (_sql: string, [hash]: unknown[]) =>
        [...rows.values()]
          .filter((r) => r[0] === hash)
          .map(([book_hash, note_id, hardcover_journal_id, payload_hash, synced_at]) => ({
            book_hash,
            note_id,
            hardcover_journal_id,
            payload_hash,
            synced_at,
          })),
      execute: async (sql: string, params: unknown[]) => {
        if (sql.includes('DELETE')) rows.clear();
        else if (sql.includes('INSERT')) rows.set(String(params[1]), params);
        return {};
      },
      close: async () => {},
    };
    const appService = { openDatabase: async () => db } as unknown as AppService;
    const linkedClient = new HardcoverClient(
      { accessToken: `batch-${tokenSeq++}` },
      new HardcoverSyncMapStore(appService),
    );
    vi.spyOn(
      linkedClient as unknown as HardcoverClientTestApi,
      'ensureBookInLibrary',
    ).mockResolvedValue(context as TestBookContext);

    await linkedClient.syncBookNotes(book, config(notes(2)));
    // The link dialog clears the old book's mappings through its own store.
    await new HardcoverSyncMapStore(appService).clearForBook(book.hash);
    fetchMock.mockClear();

    const result = await linkedClient.syncBookNotes(book, config(notes(2)));

    expect(result).toMatchObject({ inserted: 2, updated: 0, skipped: 0 });
    expect(
      batches()
        .flat()
        .map((op) => op.query),
    ).toEqual([
      expect.stringContaining('InsertReadingJournal'),
      expect.stringContaining('InsertReadingJournal'),
    ]);
  });

  test('sets visibility on inserts only, so updates keep what Hardcover has', async () => {
    api.privacySettingId = 1;
    staleMapping('n0');

    await client.syncBookNotes(book, config(notes(2)));

    const [update, insert] = batches()[0]!;
    expect(update!.query).not.toContain('privacy_setting_id');
    expect(update!.variables).not.toHaveProperty('privacy_setting_id');
    expect(insert!.variables).toMatchObject({ privacy_setting_id: 1 });
  });

  test('keeps the hash independent of visibility and equal to earlier versions', async () => {
    const note = { id: 'n0', type: 'annotation', text: 't', updatedAt: 1711737600000 };
    // The payload as hashed before visibility was configurable.
    const legacyHash = getContentMd5({
      event: 'quote',
      entry: 't',
      page: 1,
      possible: 100,
      percent: 1,
      action_at: '2024-03-29T18:40:00+00:00',
      privacy_setting_id: 3,
    });

    for (const privacy of [1, 2]) {
      api.privacySettingId = privacy;
      mapStore['upsertMapping']!.mockClear();
      await client.syncBookNotes(book, config([note] as BookNote[]));
      expect(mapStore['upsertMapping']!.mock.calls[0]![3]).toBe(legacyHash);
    }
  });

  test('inserts identical payloads in one run once', async () => {
    const result = await client.syncBookNotes(book, config(notes(2, () => 'same')));

    expect(result).toMatchObject({ inserted: 1, skipped: 1 });
    expect(batches().flat()).toHaveLength(1);
    expect(mapStore['upsertMapping']).toHaveBeenCalledTimes(2);
  });

  test('re-inserts a journal deleted on Hardcover', async () => {
    staleMapping('n0');
    fetchMock.mockResolvedValueOnce(
      response([{ errors: [{ message: 'journal not found' }] }, inserted(901)]),
    );

    const result = await client.syncBookNotes(book, config(notes(2)));

    expect(result).toMatchObject({ inserted: 2, updated: 0 });
    expect(batches().map((b) => b.length)).toEqual([2, 1]);
    expect(batches()[1]![0]!.query).toContain('InsertReadingJournal');
  });

  test('splits retries of deleted journals to the quota left after the first batch', async () => {
    mapStore['getMapping']!.mockResolvedValue({ hardcover_journal_id: 55, payload_hash: 'stale' });
    fetchMock.mockResolvedValueOnce(
      response(
        Array.from({ length: 10 }, () => ({ errors: [{ message: 'journal not found' }] })),
        { headers: new Headers({ RateLimit: '"Free";r=3;t=30' }) },
      ),
    );

    const result = await client.syncBookNotes(book, config(notes(10)));

    expect(result).toMatchObject({ inserted: 10, updated: 0 });
    expect(batches().map((b) => b.length)).toEqual([10, 3, 3, 3, 1]);
  });

  test.each([
    ['an operation error', [inserted(900), { errors: [{ message: 'boom' }] }], 'boom'],
    ['an insert without an id', [inserted(900), { data: { insert_reading_journal: {} } }], 'no id'],
  ])('saves the writes that succeeded before failing on %s', async (_name, results, message) => {
    fetchMock.mockResolvedValueOnce(response(results));

    await expect(client.syncBookNotes(book, config(notes(2)))).rejects.toThrow(message);
    expect(mapStore['upsertMapping']).toHaveBeenCalledTimes(1);
    expect(mapStore['flush']).toHaveBeenCalled();
  });

  test('fails on an HTTP error or a malformed batch response', async () => {
    fetchMock.mockResolvedValueOnce(response({}, { ok: false, status: 500, statusText: 'Oops' }));
    await expect(client.syncBookNotes(book, config(notes(2)))).rejects.toThrow('API Error: 500');

    fetchMock.mockResolvedValueOnce(response({ errors: [{ message: 'nope' }] }));
    await expect(client.syncBookNotes(book, config(notes(2)))).rejects.toThrow('mismatch');
  });
});
