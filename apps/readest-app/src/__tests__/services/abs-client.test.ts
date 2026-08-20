import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ABSClient } from '@/services/audiobookshelf/client';
import { isWebAppPlatform } from '@/services/environment';
import type { ABSServer } from '@/types/audiobookshelf';

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: vi.fn(() => false),
  isWebAppPlatform: vi.fn(() => false),
  getAPIBaseUrl: vi.fn(() => '/api'),
}));

const server: ABSServer = {
  id: 's1',
  name: 'Home',
  url: 'http://abs.local:13378',
  username: 'u',
  password: 'p',
  accessToken: 'tok-old',
  refreshToken: 'refresh-1',
};

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type TokensUpdatedPatch = Pick<ABSServer, 'accessToken' | 'refreshToken' | 'serverVersion'>;

describe('ABSClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  // Vitest 4's untyped `vi.fn()` return type doesn't structurally satisfy a
  // specific callback signature under this repo's strict tsgo check, so the
  // mock is typed explicitly (same idiom as captured-turn.browser.test.ts).
  let onTokensUpdated: ReturnType<typeof vi.fn<(patch: TokensUpdatedPatch) => void>>;
  let client: ABSClient;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    onTokensUpdated = vi.fn<(patch: TokensUpdatedPatch) => void>();
    client = new ABSClient({ ...server }, { onTokensUpdated });
  });

  it('login stores tokens from a modern server response', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        user: { token: 'legacy', accessToken: 'at-new', refreshToken: 'rt-new' },
        serverSettings: { version: '2.36.0' },
      }),
    );
    await client.login();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://abs.local:13378/login',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(onTokensUpdated).toHaveBeenCalledWith({
      accessToken: 'at-new',
      refreshToken: 'rt-new',
      serverVersion: '2.36.0',
    });
  });

  it('login falls back to the legacy long-lived token when accessToken is absent', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        user: { token: 'legacy-tok' },
        serverSettings: { version: '2.10.0' },
      }),
    );
    await client.login();
    expect(onTokensUpdated).toHaveBeenCalledWith({
      accessToken: 'legacy-tok',
      refreshToken: undefined,
      serverVersion: '2.10.0',
    });
  });

  it('retries a 401 once after refreshing the token', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(
        jsonResponse(200, { user: { accessToken: 'at2', refreshToken: 'rt2' } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { libraries: [{ id: 'l1', name: 'Audiobooks', mediaType: 'book' }] }),
      );
    const libraries = await client.getLibraries();
    expect(libraries).toEqual([{ id: 'l1', name: 'Audiobooks', mediaType: 'book' }]);
    expect(fetchMock.mock.calls[1]![0]).toBe('http://abs.local:13378/auth/refresh');
    // The retried request carries the fresh token.
    const retryHeaders = (fetchMock.mock.calls[2]![1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(retryHeaders['Authorization']).toBe('Bearer at2');
  });

  it('falls back to credential re-login when refresh fails', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(401, {})) // refresh rejected
      .mockResolvedValueOnce(
        jsonResponse(200, { user: { accessToken: 'at3' }, serverSettings: {} }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { libraries: [] }));
    await client.getLibraries();
    expect(fetchMock.mock.calls[2]![0]).toBe('http://abs.local:13378/login');
  });

  it('getLibraryItems pages until the total is reached', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          total: 3,
          results: [
            { id: 'a', mediaType: 'book', media: { metadata: {} } },
            { id: 'b', mediaType: 'book', media: { metadata: {} } },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          total: 3,
          results: [{ id: 'c', mediaType: 'book', media: { metadata: {} } }],
        }),
      );
    const items = await client.getLibraryItems('l1');
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(String(fetchMock.mock.calls[0]![0])).toContain(
      '/api/libraries/l1/items?limit=100&page=0',
    );
    expect(String(fetchMock.mock.calls[1]![0])).toContain('page=1');
  });

  it('openPlaybackSession posts to the book play path when no episodeId is given', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { id: 'sess1', currentTime: 12, audioTracks: [] }),
    );
    await client.openPlaybackSession('item1');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://abs.local:13378/api/items/item1/play',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('openPlaybackSession appends the episode id to the play path when given', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { id: 'sess1', currentTime: 12, audioTracks: [] }),
    );
    await client.openPlaybackSession('item1', 'ep1');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://abs.local:13378/api/items/item1/play/ep1',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('openPlaybackSession encodes the episode id in the play path', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { id: 'sess1', currentTime: 12, audioTracks: [] }),
    );
    await client.openPlaybackSession('item1', 'ep/1 two');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://abs.local:13378/api/items/item1/play/ep%2F1%20two',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('openPlaybackSession treats an empty-string episodeId the same as no episodeId', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { id: 'sess1', currentTime: 12, audioTracks: [] }),
    );
    await client.openPlaybackSession('item1', '');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://abs.local:13378/api/items/item1/play',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('coalesces concurrent 401s into a single /auth/refresh call', async () => {
    // Two client calls racing (e.g. a periodic syncSession alongside a UI
    // read) both start with the stale token and both see a 401. Without an
    // in-flight guard each would independently POST /auth/refresh with the
    // same refresh token; a server that rotates refresh tokens on use would
    // then reject the second one. Dispatch on URL + current Authorization
    // header rather than call order, so the assertion holds regardless of
    // exactly how the two chains interleave.
    let refreshCalls = 0;
    fetchMock.mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const headers = init?.headers as Record<string, string> | undefined;
      if (url === 'http://abs.local:13378/auth/refresh') {
        refreshCalls += 1;
        return Promise.resolve(
          jsonResponse(200, { user: { accessToken: 'at2', refreshToken: 'rt2' } }),
        );
      }
      const authorized = headers?.['Authorization'] === 'Bearer at2';
      if (url === 'http://abs.local:13378/api/libraries') {
        return Promise.resolve(
          authorized
            ? jsonResponse(200, {
                libraries: [{ id: 'l1', name: 'Audiobooks', mediaType: 'book' }],
              })
            : jsonResponse(401, {}),
        );
      }
      if (url === 'http://abs.local:13378/api/session/sess-1/sync') {
        return Promise.resolve(authorized ? jsonResponse(200, {}) : jsonResponse(401, {}));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const [libraries] = await Promise.all([
      client.getLibraries(),
      client.syncSession('sess-1', { currentTime: 1, timeListened: 1, duration: 10 }),
    ]);

    expect(libraries).toEqual([{ id: 'l1', name: 'Audiobooks', mediaType: 'book' }]);
    expect(refreshCalls).toBe(1);
  });
});

describe('ABSClient on the web platform', () => {
  // A browser tab calls the ABS server directly; cross-origin access relies
  // on the server's opt-in CORS support (ALLOW_CORS=1 or the allowedOrigins
  // server setting covering the Readest web origin). No proxy hop.
  let fetchMock: ReturnType<typeof vi.fn>;
  let onTokensUpdated: ReturnType<typeof vi.fn<(patch: TokensUpdatedPatch) => void>>;
  let client: ABSClient;

  beforeEach(() => {
    vi.mocked(isWebAppPlatform).mockReturnValue(true);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    onTokensUpdated = vi.fn<(patch: TokensUpdatedPatch) => void>();
    client = new ABSClient({ ...server }, { onTokensUpdated });
  });

  afterEach(() => {
    vi.mocked(isWebAppPlatform).mockReturnValue(false);
  });

  it('fetches the ABS server directly with the target URL, method, and headers', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { libraries: [{ id: 'l1', name: 'Audiobooks', mediaType: 'book' }] }),
    );

    await client.getLibraries();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://abs.local:13378/api/libraries');
    expect((init as RequestInit).method).toBe('GET');
    const sentHeaders = (init as RequestInit).headers as Record<string, string>;
    expect(sentHeaders['Authorization']).toBe('Bearer tok-old');
    expect(sentHeaders['Origin']).toBeUndefined();
  });
});
