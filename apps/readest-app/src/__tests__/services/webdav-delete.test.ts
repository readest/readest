import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  deleteDirectory,
  WebDAVRequestError,
  type WebDAVConfig,
} from '@/services/webdav/WebDAVClient';
import { deleteRemoteBookDir } from '@/services/webdav/WebDAVSync';
import type { WebDAVSettings } from '@/types/settings';

/**
 * Tests for the cleanup-mode delete plumbing — both the low-level
 * `deleteDirectory` HTTP wrapper in WebDAVClient and the high-level
 * `deleteRemoteBookDir` orchestrator in WebDAVSync.
 *
 * The two layers are tested side by side because their contracts
 * are tightly coupled (one returns void / throws, the other adapts
 * that into a discriminated result for batch aggregation), and a
 * single fetch mock replays naturally for both.
 */

const ORIGINAL_FETCH = globalThis.fetch;

const config: WebDAVConfig = {
  serverUrl: 'https://dav.example.com',
  username: 'alice',
  password: 'secret',
};

const settings: WebDAVSettings = {
  enabled: true,
  serverUrl: 'https://dav.example.com',
  username: 'alice',
  password: 'secret',
  // `/` is the canonical root used by every other test; matches what
  // `normalizeRoot` would do to an unset rootPath, so the assertions
  // below can hard-code "/Readest/books/<hash>".
  rootPath: '/',
};

const buildResponse = (status: number): Response =>
  // 204 No Content is the typical success for DELETE; we set a body
  // anyway so any future caller that tries to read it doesn't blow
  // up. JSDOM's Response constructor refuses 204+body, so we tag it
  // as 200 internally and override the status reporter — but it's
  // simpler to just use `new Response(null, { status })` for the
  // bodyless cases and `new Response('', { status })` otherwise.
  new Response(status === 204 ? null : '', { status });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe('deleteDirectory', () => {
  test('204 No Content resolves without throwing', async () => {
    fetchMock.mockResolvedValueOnce(buildResponse(204));
    await expect(deleteDirectory(config, '/Readest/books/abc')).resolves.toBeUndefined();
  });

  test('200 OK resolves without throwing', async () => {
    fetchMock.mockResolvedValueOnce(buildResponse(200));
    await expect(deleteDirectory(config, '/Readest/books/abc')).resolves.toBeUndefined();
  });

  test('404 Not Found is treated as success (already gone)', async () => {
    fetchMock.mockResolvedValueOnce(buildResponse(404));
    await expect(deleteDirectory(config, '/Readest/books/missing')).resolves.toBeUndefined();
  });

  test('401 Unauthorized throws AUTH_FAILED', async () => {
    fetchMock.mockResolvedValueOnce(buildResponse(401));
    await expect(deleteDirectory(config, '/Readest/books/abc')).rejects.toMatchObject({
      code: 'AUTH_FAILED',
      status: 401,
    });
  });

  test('403 Forbidden throws AUTH_FAILED', async () => {
    fetchMock.mockResolvedValueOnce(buildResponse(403));
    await expect(deleteDirectory(config, '/Readest/books/abc')).rejects.toMatchObject({
      code: 'AUTH_FAILED',
      status: 403,
    });
  });

  test('500 Internal Server Error throws WebDAVRequestError with the status', async () => {
    fetchMock.mockResolvedValueOnce(buildResponse(500));
    await expect(deleteDirectory(config, '/Readest/books/abc')).rejects.toMatchObject({
      status: 500,
    });
  });

  test('fetch network failure surfaces as a NETWORK error', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(deleteDirectory(config, '/Readest/books/abc')).rejects.toMatchObject({
      code: 'NETWORK',
    });
  });

  test('sends DELETE with explicit Depth: infinity header', async () => {
    // Depth: infinity is required by RFC 4918 §9.6.1 for collection
    // deletes. Some servers reject the implicit form, so this is a
    // load-bearing piece of the request — guard it explicitly so a
    // future refactor can't silently drop the header and still pass
    // the rest of the suite.
    fetchMock.mockResolvedValueOnce(buildResponse(204));
    await deleteDirectory(config, '/Readest/books/abc');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://dav.example.com/Readest/books/abc');
    expect(init?.method).toBe('DELETE');
    const headers = init?.headers as Record<string, string>;
    expect(headers['Depth']).toBe('infinity');
    // Authorization is added by the same plumbing as every other
    // method; verify it's attached so AUTH_FAILED tests above can
    // never accidentally test the unauthenticated path.
    expect(headers['Authorization']).toMatch(/^Basic /);
  });
});

describe('deleteRemoteBookDir', () => {
  const HASH = 'abc123';

  test('successful DELETE returns ok=true', async () => {
    fetchMock.mockResolvedValueOnce(buildResponse(204));
    await expect(deleteRemoteBookDir(settings, HASH)).resolves.toEqual({ ok: true });
  });

  test('non-auth failure (500) returns ok=false with reason populated', async () => {
    fetchMock.mockResolvedValueOnce(buildResponse(500));
    const result = await deleteRemoteBookDir(settings, HASH);
    expect(result.ok).toBe(false);
    // The reason is the underlying error message; we don't pin its
    // exact wording (could be tweaked) but it must be a non-empty
    // string so the toast has something to show.
    expect(result.reason).toBeTruthy();
    expect(typeof result.reason).toBe('string');
  });

  test('AUTH_FAILED is rethrown so callers can short-circuit batches', async () => {
    fetchMock.mockResolvedValueOnce(buildResponse(401));
    await expect(deleteRemoteBookDir(settings, HASH)).rejects.toBeInstanceOf(WebDAVRequestError);
    // 403 walks the same code path; assert the AUTH_FAILED tag
    // independently so a regression that lets one status leak
    // through but not the other still trips a test.
    fetchMock.mockResolvedValueOnce(buildResponse(403));
    await expect(deleteRemoteBookDir(settings, HASH)).rejects.toMatchObject({
      code: 'AUTH_FAILED',
    });
  });

  test('targets the correct per-hash directory under <rootPath>/Readest/books', async () => {
    // The remote layout is documented in WebDAVPaths.ts; this test
    // pins the contract so neither side can drift. A custom
    // rootPath is used to make sure buildBookDirPath honours it
    // (a literal '/' would mask a "join always uses leading-slash
    // base" regression).
    fetchMock.mockResolvedValueOnce(buildResponse(204));
    await deleteRemoteBookDir({ ...settings, rootPath: '/MyDav' }, HASH);
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://dav.example.com/MyDav/Readest/books/abc123');
  });
});
