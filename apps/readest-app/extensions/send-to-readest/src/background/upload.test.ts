import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  installChromeMock,
  uninstallChromeMock,
  type ChromeMock,
} from '../__test-utils__/chromeMock';
import { resolveUploadEndpoint, uploadEpub } from './upload';

let chromeMock: ChromeMock;
let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  chromeMock = installChromeMock();
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  fetchSpy.mockRestore();
  uninstallChromeMock();
});

function blobOk(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

const sampleEpub = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], {
  type: 'application/epub+zip',
});

const DEFAULT_ENDPOINT = 'https://web.readest.com/api/send/inbox/file';

const sampleArgs = {
  endpoint: DEFAULT_ENDPOINT,
  token: 'tok-abc',
  epub: sampleEpub,
  title: 'Hello, World',
  sourceUrl: 'https://example.com/article',
};

describe('resolveUploadEndpoint', () => {
  test('defaults to the production endpoint when no override is set', async () => {
    expect(await resolveUploadEndpoint()).toBe('https://web.readest.com/api/send/inbox/file');
  });

  test('honours readestApiBase in chrome.storage.local', async () => {
    await chromeMock.storage.local.set({ readestApiBase: 'http://localhost:3000' });
    expect(await resolveUploadEndpoint()).toBe('http://localhost:3000/api/send/inbox/file');
  });

  test('strips a trailing slash from readestApiBase', async () => {
    await chromeMock.storage.local.set({ readestApiBase: 'http://localhost:3000/' });
    expect(await resolveUploadEndpoint()).toBe('http://localhost:3000/api/send/inbox/file');
  });

  test('ignores readestApiBase when it is not http(s)', async () => {
    await chromeMock.storage.local.set({ readestApiBase: 'javascript:alert(1)' });
    expect(await resolveUploadEndpoint()).toBe('https://web.readest.com/api/send/inbox/file');
  });

  test('falls back to default when chrome.storage is unavailable', async () => {
    // Mirror the offscreen-document quirk where `chrome.storage` came
    // back undefined — `resolveUploadEndpoint` must never throw.
    const realStorage = chromeMock.storage;
    (chromeMock as unknown as { storage: undefined }).storage = undefined;
    try {
      expect(await resolveUploadEndpoint()).toBe('https://web.readest.com/api/send/inbox/file');
    } finally {
      (chromeMock as unknown as { storage: typeof realStorage }).storage = realStorage;
    }
  });
});

describe('uploadEpub', () => {
  test('POSTs the EPUB body with Authorization + RFC 5987 headers', async () => {
    fetchSpy.mockResolvedValueOnce(blobOk({ id: 'inbox-1' }));
    const result = await uploadEpub(sampleArgs);

    expect(result).toEqual({ ok: true, id: 'inbox-1' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://web.readest.com/api/send/inbox/file');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok-abc');
    expect(headers['Content-Type']).toBe('application/epub+zip');
    // RFC 5987: `UTF-8''<percent-encoded>` so non-ASCII titles survive a
    // header round-trip.
    expect(headers['X-Readest-Title']).toBe("UTF-8''Hello%2C%20World");
    expect(headers['X-Readest-Url']).toBe("UTF-8''https%3A%2F%2Fexample.com%2Farticle");
    expect(init?.body).toBe(sampleEpub);
  });

  test('encodes non-ASCII titles correctly', async () => {
    fetchSpy.mockResolvedValueOnce(blobOk({ id: 'inbox-2' }));
    await uploadEpub({ ...sampleArgs, title: '机器学习 ✅' });
    const headers = fetchSpy.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers['X-Readest-Title']).toBe(
      "UTF-8''%E6%9C%BA%E5%99%A8%E5%AD%A6%E4%B9%A0%20%E2%9C%85",
    );
  });

  test('POSTs to whichever endpoint URL the caller supplied (used by the SW to inject the resolved base)', async () => {
    fetchSpy.mockResolvedValueOnce(blobOk({ id: 'inbox-3' }));
    await uploadEpub({ ...sampleArgs, endpoint: 'http://localhost:3000/api/send/inbox/file' });
    expect(fetchSpy.mock.calls[0]![0]).toBe('http://localhost:3000/api/send/inbox/file');
  });

  test('maps 401/403 to session-expired', async () => {
    fetchSpy.mockResolvedValueOnce(blobOk({}, { status: 401 }));
    const a = await uploadEpub(sampleArgs);
    expect(a).toEqual({ ok: false, code: 'session-expired', message: 'Session expired' });

    fetchSpy.mockResolvedValueOnce(blobOk({}, { status: 403 }));
    const b = await uploadEpub(sampleArgs);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.code).toBe('session-expired');
  });

  test('maps 429 to inbox-full', async () => {
    fetchSpy.mockResolvedValueOnce(blobOk({ error: 'Inbox is full' }, { status: 429 }));
    const result = await uploadEpub(sampleArgs);
    expect(result).toEqual({ ok: false, code: 'inbox-full', message: 'Inbox is full' });
  });

  test('maps 413 to a "too large" server-error', async () => {
    fetchSpy.mockResolvedValueOnce(blobOk({ error: 'File is too large' }, { status: 413 }));
    const result = await uploadEpub(sampleArgs);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('server-error');
      expect(result.message).toBe('Article is too large to send');
    }
  });

  test('surfaces the server-supplied error message on other 5xx', async () => {
    fetchSpy.mockResolvedValueOnce(blobOk({ error: 'Could not store EPUB' }, { status: 500 }));
    const result = await uploadEpub(sampleArgs);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('server-error');
      expect(result.message).toBe('Could not store EPUB');
    }
  });

  test('falls back to a status-code message when the server body is not JSON', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('plain text', { status: 502 }));
    const result = await uploadEpub(sampleArgs);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('502');
    }
  });

  test('maps network failures to network-error and names the target host', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const result = await uploadEpub(sampleArgs);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('network-error');
      // The message now includes the target host so the user can tell at
      // a glance whether the override pointed at a dead local server.
      expect(result.message).toContain('web.readest.com');
      expect(result.message).toContain('Failed to fetch');
    }
  });

  test('treats a non-JSON 200 body as a server-error', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('OK', { status: 200 }));
    const result = await uploadEpub(sampleArgs);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('server-error');
    }
  });
});
