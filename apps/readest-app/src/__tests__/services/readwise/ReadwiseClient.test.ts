import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { ReadwiseClient } from '@/services/readwise/ReadwiseClient';
import { READWISE_API_BASE_URL } from '@/services/constants';
import { isTauriAppPlatform } from '@/services/environment';
import type { ReadwiseSettings } from '@/types/settings';
import type { Book, BookNote } from '@/types/book';

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: vi.fn(() => false),
}));

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
    vi.mocked(tauriFetch)
      .mockReset()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.mocked(isTauriAppPlatform).mockReturnValue(false);
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

  // Issue #5424: pass the book cover along so Readwise attaches it to the
  // book; Readwise only accepts a fetchable URL (image_url, max 2047 chars),
  // never image bytes, so local-only URLs must be dropped.
  const pushedHighlight = () => {
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    return JSON.parse(init.body as string).highlights[0];
  };

  test('sends a resolved public cover URL as image_url', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const client = new ReadwiseClient(makeSettings());
    const url = 'https://assets.readest.com/media/book_covers/abcdef12/c0ffee.png';
    await client.pushHighlights([makeNote()], makeBook(), url);
    expect(pushedHighlight().image_url).toBe(url);
  });

  test('falls back to a public cover URL from the book metadata', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const client = new ReadwiseClient(makeSettings());
    const book = { ...makeBook(), coverImageUrl: 'https://example.com/cover.jpg' } as Book;
    await client.pushHighlights([makeNote()], book);
    expect(pushedHighlight().image_url).toBe('https://example.com/cover.jpg');
  });

  test('omits image_url when the only cover URL is local', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const client = new ReadwiseClient(makeSettings());
    const book = { ...makeBook(), coverImageUrl: 'https://asset.localhost/cover.png' } as Book;
    await client.pushHighlights([makeNote()], book);
    expect(pushedHighlight()).not.toHaveProperty('image_url');
  });

  test('omits image_url when the cover option is disabled', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const client = new ReadwiseClient(makeSettings({ includeCoverImage: false }));
    const book = { ...makeBook(), coverImageUrl: 'https://example.com/cover.jpg' } as Book;
    await client.pushHighlights([makeNote()], book, 'https://example.com/other.jpg');
    expect(pushedHighlight()).not.toHaveProperty('image_url');
  });

  test('validateToken uses the Tauri HTTP transport in the desktop app', async () => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
    const client = new ReadwiseClient(makeSettings({ baseUrl: 'https://example.com/api/v2' }));

    await client.validateToken();

    expect(tauriFetch).toHaveBeenCalledWith('https://example.com/api/v2/auth/', {
      method: 'GET',
      headers: {
        Authorization: 'Token test-token',
      },
      body: undefined,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
