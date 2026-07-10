import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  getFileBinary,
  headFile,
  listDirectory,
  type WebDAVConfig,
} from '@/services/sync/providers/webdav/client';

/**
 * Per-request timeouts against an unreachable/dead server. Metadata
 * round-trips (PROPFIND / HEAD / MKCOL / DELETE) answer with headers only, so
 * they fail fast (~5 s) instead of pinning the sync UI on a dead LAN host;
 * GET / PUT carry book-sized bodies over possibly slow links, so they keep a
 * generous ceiling.
 */

const ORIGINAL_FETCH = globalThis.fetch;

const config: WebDAVConfig = {
  serverUrl: 'https://dav.example.com',
  username: 'alice',
  password: 'secret',
};

/** A fetch that never resolves — only rejects when its signal aborts. */
const hangingFetch = () =>
  vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
      }),
  );

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.fetch = hangingFetch() as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('WebDAV request timeouts', () => {
  test('HEAD fails fast with a timeout after 5 s', async () => {
    const p = headFile(config, '/Readest/library.json');
    const assertion = expect(p).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
  });

  test('PROPFIND listing fails fast with a timeout after 5 s', async () => {
    const p = listDirectory(config, '/');
    const assertion = expect(p).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
  });

  test('GET keeps the long transfer ceiling (still pending at 5 s)', async () => {
    let settled = false;
    const p = getFileBinary(config, '/Readest/books/h1/big.epub');
    p.catch(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(settled).toBe(false); // large transfers must not be cut at 5 s

    await vi.advanceTimersByTimeAsync(295_000);
    expect(settled).toBe(true); // but a dead link still ends eventually
  });
});
