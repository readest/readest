import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { webDownload, type ProgressPayload } from '@/utils/transfer';

const buildResponse = (
  body: Uint8Array,
  contentLength: string | null,
  ok = true,
  status = 200,
): Response => {
  const headers = new Headers();
  if (contentLength !== null) headers.set('Content-Length', contentLength);
  return new Response(body as unknown as BodyInit, {
    status,
    headers,
    statusText: ok ? 'OK' : 'Err',
  });
};

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('webDownload', () => {
  test('reports progress with the byte total when Content-Length is present', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    globalThis.fetch = vi.fn(async () =>
      buildResponse(bytes, String(bytes.length)),
    ) as unknown as typeof fetch;

    const events: ProgressPayload[] = [];
    const result = await webDownload('https://example.test/file', (p) => events.push(p));
    expect(await result.blob.arrayBuffer()).toEqual(bytes.buffer);
    expect(events.length).toBeGreaterThan(0);
    expect(events.at(-1)!.total).toBe(8);
    expect(events.at(-1)!.progress).toBe(8);
  });

  test('does NOT throw when Content-Length is missing — falls back to indeterminate progress (total=0)', async () => {
    // R2 / S3 signed URLs frequently omit Content-Length from CORS-exposed
    // headers. Failing the whole download to protect a progress bar makes
    // replica binaries (fonts, dictionaries) impossible to fetch on web.
    // The contract: still resolve, still feed bytes, just emit indeterminate
    // progress events (total=0). UI callers already guard `total === 0`.
    const bytes = new Uint8Array([10, 20, 30]);
    globalThis.fetch = vi.fn(async () => buildResponse(bytes, null)) as unknown as typeof fetch;

    const events: ProgressPayload[] = [];
    const result = await webDownload('https://example.test/file', (p) => events.push(p));
    expect(await result.blob.arrayBuffer()).toEqual(bytes.buffer);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.total === 0)).toBe(true);
    expect(events.at(-1)!.progress).toBe(3);
  });

  test('falls back to X-Content-Length when present', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const headers = new Headers();
    headers.set('X-Content-Length', '3');
    globalThis.fetch = vi.fn(
      async () => new Response(bytes as unknown as BodyInit, { status: 200, headers }),
    ) as unknown as typeof fetch;

    const events: ProgressPayload[] = [];
    await webDownload('https://example.test/file', (p) => events.push(p));
    expect(events.at(-1)!.total).toBe(3);
  });

  test('rejects with Unauthorized for 401 / 403', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('', { status: 401 }),
    ) as unknown as typeof fetch;
    await expect(webDownload('https://example.test/file')).rejects.toThrow('Unauthorized');
  });

  test('rejects with DownloadFailed for other non-OK statuses', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('', { status: 500 }),
    ) as unknown as typeof fetch;
    await expect(webDownload('https://example.test/file')).rejects.toThrow();
  });

  test('completes successfully without a progress handler when Content-Length is missing', async () => {
    const bytes = new Uint8Array([7, 8, 9]);
    globalThis.fetch = vi.fn(async () => buildResponse(bytes, null)) as unknown as typeof fetch;
    const result = await webDownload('https://example.test/file');
    expect(await result.blob.arrayBuffer()).toEqual(bytes.buffer);
  });
});
