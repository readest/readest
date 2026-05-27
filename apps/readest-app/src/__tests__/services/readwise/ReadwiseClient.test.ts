import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReadwiseClient } from '@/services/readwise/ReadwiseClient';
import { READWISE_API_BASE_URL } from '@/services/constants';
import type { ReadwiseSettings } from '@/types/settings';
import type { Book, BookNote } from '@/types/book';

const makeSettings = (overrides: Partial<ReadwiseSettings> = {}): ReadwiseSettings => ({
  enabled: true,
  accessToken: 'test-token',
  lastSyncedAt: 0,
  ...overrides,
});

const makeBook = (): Book =>
  ({
    hash: 'bookhash',
    title: 'Test Book',
    author: 'Test Author',
  }) as Book;

const makeNote = (): BookNote =>
  ({
    id: 'note-1',
    type: 'annotation',
    cfi: 'epubcfi(/6/2!/4)',
    text: 'highlighted text',
    note: '',
    color: 'yellow',
    page: 1,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  }) as BookNote;

describe('ReadwiseClient base URL', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const requestedUrl = () => String(fetchMock.mock.calls[0]![0]);

  test('validateToken uses the official base URL when no custom URL is set', async () => {
    const client = new ReadwiseClient(makeSettings());
    await client.validateToken();
    expect(requestedUrl()).toBe(`${READWISE_API_BASE_URL}/auth/`);
  });

  test('validateToken uses a custom base URL when configured', async () => {
    const client = new ReadwiseClient(makeSettings({ baseUrl: 'https://example.com/api/v2' }));
    await client.validateToken();
    expect(requestedUrl()).toBe('https://example.com/api/v2/auth/');
  });

  test('a trailing slash on the custom base URL is normalized away', async () => {
    const client = new ReadwiseClient(makeSettings({ baseUrl: 'https://example.com/api/v2/' }));
    await client.validateToken();
    expect(requestedUrl()).toBe('https://example.com/api/v2/auth/');
  });

  test('a blank custom base URL falls back to the official base URL', async () => {
    const client = new ReadwiseClient(makeSettings({ baseUrl: '   ' }));
    await client.validateToken();
    expect(requestedUrl()).toBe(`${READWISE_API_BASE_URL}/auth/`);
  });

  test('pushHighlights posts to the custom base URL with the auth header', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const client = new ReadwiseClient(makeSettings({ baseUrl: 'https://example.com/api/v2' }));
    const result = await client.pushHighlights([makeNote()], makeBook());
    expect(result.success).toBe(true);
    expect(requestedUrl()).toBe('https://example.com/api/v2/highlights/');
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Token test-token');
  });
});
