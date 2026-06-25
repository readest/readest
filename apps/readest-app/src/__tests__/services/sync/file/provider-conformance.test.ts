import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createWebDAVProvider } from '@/services/sync/providers/webdav/WebDAVProvider';
import { FileSyncError } from '@/services/sync/file/provider';
import type { FileSyncProvider } from '@/services/sync/file/provider';
import type { WebDAVSettings } from '@/types/settings';

/**
 * Contract every {@link FileSyncProvider} must satisfy, exercised here against
 * {@link createWebDAVProvider} over a `fetch` mock. When a second backend
 * (Drive, Dropbox, …) arrives, lift this into a shared helper and pass a
 * factory that builds the new provider over whatever transport it stubs.
 */
const runProviderConformance = (
  name: string,
  makeProvider: () => FileSyncProvider,
  mock: { ok: (status: number, body?: string | null, headers?: Record<string, string>) => void },
) => {
  describe(`${name} — FileSyncProvider conformance`, () => {
    test('readText resolves null on 404', async () => {
      mock.ok(404, null);
      expect(await makeProvider().readText('/Readest/x.json')).toBeNull();
    });

    test('readText maps 401 to FileSyncError AUTH_FAILED', async () => {
      mock.ok(401, '');
      const err = await makeProvider()
        .readText('/Readest/x.json')
        .catch((e) => e);
      expect(err).toBeInstanceOf(FileSyncError);
      expect(err).toMatchObject({ code: 'AUTH_FAILED', status: 401 });
    });

    test('readBinary resolves null on 404', async () => {
      mock.ok(404, null);
      expect(await makeProvider().readBinary('/Readest/x.bin')).toBeNull();
    });

    test('head reads content-length, null on 404', async () => {
      mock.ok(200, null, { 'content-length': '512' });
      expect(await makeProvider().head('/Readest/x')).toEqual({ size: 512, etag: undefined });
      mock.ok(404, null);
      expect(await makeProvider().head('/Readest/x')).toBeNull();
    });

    test('writeText succeeds on 201 Created', async () => {
      mock.ok(201, '');
      await expect(makeProvider().writeText('/Readest/x.json', '{}')).resolves.toBeUndefined();
    });

    test('deleteDir treats 404 as success', async () => {
      mock.ok(404, null);
      await expect(makeProvider().deleteDir('/Readest/books/gone')).resolves.toBeUndefined();
    });

    test('list maps 401 to FileSyncError AUTH_FAILED', async () => {
      mock.ok(401, '');
      const err = await makeProvider()
        .list('/Readest/books')
        .catch((e) => e);
      expect(err).toBeInstanceOf(FileSyncError);
      expect(err).toMatchObject({ code: 'AUTH_FAILED', status: 401 });
    });

    test('list maps 404 to FileSyncError NOT_FOUND', async () => {
      mock.ok(404, '');
      const err = await makeProvider()
        .list('/Readest/books')
        .catch((e) => e);
      expect(err).toBeInstanceOf(FileSyncError);
      expect(err).toMatchObject({ code: 'NOT_FOUND', status: 404 });
    });
  });
};

const settings: WebDAVSettings = {
  enabled: true,
  serverUrl: 'https://dav.example.com',
  username: 'alice',
  password: 'secret',
  rootPath: '/',
};

const ORIGINAL_FETCH = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

runProviderConformance('WebDAVProvider', () => createWebDAVProvider(settings), {
  ok: (status, body = '', headers) =>
    fetchMock.mockResolvedValueOnce(new Response(body, { status, headers })),
});

describe('WebDAVProvider construction', () => {
  test('rootPath is normalised', () => {
    expect(createWebDAVProvider({ ...settings, rootPath: '/MyDav/' }).rootPath).toBe('/MyDav');
  });

  test('streaming methods are absent off-Tauri (web fallback)', () => {
    const provider = createWebDAVProvider(settings);
    expect(provider.uploadStream).toBeUndefined();
    expect(provider.downloadStream).toBeUndefined();
  });
});
