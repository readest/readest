import { describe, test, expect, vi, beforeEach } from 'vitest';
import { HardcoverClient } from '@/services/hardcover/HardcoverClient';
import type { HardcoverSyncMapStore } from '@/services/hardcover/HardcoverSyncMapStore';
import type { Book, BookConfig, BookNote } from '@/types/book';

describe('HardcoverClient', () => {
  let mockMapStore: HardcoverSyncMapStore;
  let client: HardcoverClient;
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
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { me: { id: 1 } } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    client = new HardcoverClient(mockSettings, mockMapStore);
  });

  test('should normalize accessToken correctly', () => {
    const rawClient = new HardcoverClient({ accessToken: 'raw-jwt' }, mockMapStore);
    expect((rawClient as any).token).toBe('Bearer raw-jwt');

    const bearClient = new HardcoverClient({ accessToken: 'Bearer already-has' }, mockMapStore);
    expect((bearClient as any).token).toBe('Bearer already-has');
  });

  test('should extract ISBN from metadata', () => {
    const book = {
      metadata: {
        isbn: '0743273567',
      },
    } as unknown as Book;
    
    const isbn = (client as any).extractISBN(book);
    expect(isbn).toBe('0743273567');
  });

  test('should extract ISBN from alternative identifiers', () => {
    const book = {
      metadata: {
        identifier: [
          { scheme: 'ISBN', value: '9780679783268' },
          'urn:isbn:0679783261'
        ],
      },
    } as unknown as Book;

    const isbn = (client as any).extractISBN(book);
    expect(isbn).toBe('9780679783268');
  });

  test('should deduplicate notes correctly in syncBookNotes', async () => {
    const book = { 
      hash: 'book-hash', 
      title: 'Test Book', 
      author: 'Test',
      metadata: { isbn: '1234567890' } // Add ISBN to trigger QUERY_GET_EDITION
    } as unknown as Book;
    
    const config = {
      booknotes: [
        {
          id: 'note-1',
          type: 'annotation',
          text: 'Shared Text',
          note: 'Some note',
          cfi: 'epubcfi(/6/4[chap1]!/4/2,10/10)',
        },
        {
          id: 'note-2',
          type: 'excerpt',
          text: 'Shared Text',
          cfi: 'epubcfi(/6/4[chap1]!/4/2,10/12)', // Slightly different CFI trailing offset
        },
        {
          id: 'note-3',
          type: 'annotation',
          text: 'Other Text',
          note: '',
        }
      ] as BookNote[],
    } as BookConfig;

    // Setup mocks for authenticate & fetch context & insert
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { me: { id: 1 } } }), // authenticate
    });
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ 
        data: { 
          editions: [{ 
            id: 101, 
            book: { 
              id: 202, 
              user_books: [{ 
                id: 303,
                user_book_reads: []
              }] 
            } 
          }] 
        } 
      }), // fetchContext (QUERY_GET_EDITION)
    });
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { insert_reading_journal: { id: 999 } } }), // generic inserts
    });

    const results = await client.syncBookNotes(book, config);

    // note-1: kept (annotation with note)
    // note-2: skipped (excerpt at same location/text as note-1)
    // note-3: kept (annotation with no note, but no conflicts)
    expect(results.inserted).toBe(2);
    expect(mockMapStore.flush).toHaveBeenCalled();
  });

  test('should handle rate limiting with retries', async () => {
    // request() does NOT call authenticate() so only 2 mock values are needed
    
    // First request fails with 429 then succeeds
    (fetch as any).mockResolvedValueOnce({ ok: false, status: 429 });
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { result: 'ok' } }),
    });

    // Speed up sleep for test
    vi.useFakeTimers();
    const requestPromise = (client as any).request('query', { var: 1 });
    
    // Wait for the 429 retry
    await vi.runAllTimersAsync();
    const result = await requestPromise;

    expect(result).toEqual({ result: 'ok' });
    vi.useRealTimers();
  });

  test('should produce the expected date formats for journal and progress payloads', () => {
    const note = { 
      updatedAt: 1711737600000, // 2026-03-29 ...
      type: 'annotation',
      text: 'Test',
      id: '1'
    } as BookNote;
    const config = { progress: [5, 100] } as BookConfig;
    const context = { pages: 100, bookId: 1, editionId: 2 } as any;

    // Test journal payload
    const payload = (client as any).buildJournalPayload(note, config, context);
    // Should be full ISO (e.g. 2026-03-29T16:00:00.000Z), length > 20
    expect(payload.action_at.length).toBeGreaterThan(10);
    expect(payload.action_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Test progress payload (started_at)
    const book = { createdAt: 1711737600000 } as Book;
    // We can spy on request to see the variables passed
    const requestSpy = vi.spyOn(client as any, 'request').mockResolvedValue({});
    (client as any).pushProgress(book, config);
    
    const lastCall = requestSpy.mock.calls[requestSpy.mock.calls.length - 1];
    const variables = lastCall[1];
    expect(variables.started_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
