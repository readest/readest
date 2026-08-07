import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BookOrbitSettings } from '@/types/settings';

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
  getAPIBaseUrl: () => 'https://web.readest.com/api',
}));

import { BookOrbitClient, BookOrbitRequestError } from '@/services/bookorbit/BookOrbitClient';

const makeConfig = (overrides: Partial<BookOrbitSettings> = {}): BookOrbitSettings => ({
  enabled: true,
  // A LAN address makes request() take the direct window.fetch path.
  serverUrl: 'http://192.168.1.50:3000',
  username: 'alice',
  userkey: 'a'.repeat(32),
  deviceId: 'device-1',
  deviceName: 'Readest Test',
  strategy: 'prompt',
  syncProgress: true,
  syncNotes: true,
  syncStats: true,
  syncBookStates: true,
  ...overrides,
});

type FetchMock = ReturnType<typeof vi.fn>;

const setFetch = (impl: (...args: unknown[]) => unknown): FetchMock => {
  const mock = vi.fn(impl) as FetchMock;
  vi.stubGlobal('fetch', mock);
  window.fetch = mock as unknown as typeof window.fetch;
  return mock;
};

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BookOrbitClient', () => {
  it('POSTs the exchange to the plugin API with auth headers and device fields', async () => {
    const fetchMock = setFetch(async () => jsonResponse(200, { results: [], unmatched: [] }));
    const client = new BookOrbitClient(makeConfig());
    const books = [{ hash: 'a'.repeat(32), keys: [], keysComplete: true, changes: [] }];
    const response = await client.exchangeAnnotations(books);

    expect(response).toEqual({ results: [], unmatched: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://192.168.1.50:3000/api/v1/koreader/plugin/annotations/exchange');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Auth-User']).toBe('alice');
    expect(headers['X-Auth-Key']).toBe('a'.repeat(32));
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['deviceId']).toBe('device-1');
    expect(body['deviceModel']).toBe('Readest Test');
    expect(String(body['pluginVersion'])).toMatch(/^readest-/);
    expect(String(body['pluginVersion']).length).toBeLessThanOrEqual(20);
    expect(String(body['deviceTime'])).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(body['books']).toEqual(books);
  });

  it('throws BookOrbitRequestError with the response status on failure', async () => {
    setFetch(async () => jsonResponse(500, { message: 'boom' }));
    const client = new BookOrbitClient(makeConfig());
    await expect(client.uploadPageStats([{ hash: 'b'.repeat(32), events: [] }])).rejects.toThrow(
      BookOrbitRequestError,
    );
    setFetch(async () => jsonResponse(500, { message: 'boom' }));
    const err = await client
      .uploadBookStates([{ hash: 'b'.repeat(32), status: 'reading' }])
      .catch((e: unknown) => e);
    expect((err as BookOrbitRequestError).status).toBe(500);
  });

  it('routes public servers through the web proxy with the payload envelope', async () => {
    const fetchMock = setFetch(async () =>
      jsonResponse(200, { pluginVersion: '1', serverVersion: '2', capabilities: ['bookmarkSync'] }),
    );
    const client = new BookOrbitClient(makeConfig({ serverUrl: 'https://books.example.com/' }));
    const version = await client.getVersion();

    expect(version.capabilities).toEqual(['bookmarkSync']);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://web.readest.com/api/bookorbit');
    const payload = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(payload['serverUrl']).toBe('https://books.example.com');
    expect(payload['endpoint']).toBe('/plugin/version');
    expect(payload['method']).toBe('GET');
  });

  it('caches getVersion per client instance', async () => {
    const fetchMock = setFetch(async () =>
      jsonResponse(200, { pluginVersion: '1', serverVersion: '2', capabilities: [] }),
    );
    const client = new BookOrbitClient(makeConfig());
    await client.getVersion();
    await client.getVersion();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends configured custom headers on requests', async () => {
    const fetchMock = setFetch(async () => jsonResponse(200, { results: [], unmatched: [] }));
    const client = new BookOrbitClient(
      makeConfig({ customHeaders: { 'CF-Access-Client-Id': 'client-id' } }),
    );
    await client.exchangeAnnotations([]);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['CF-Access-Client-Id']).toBe('client-id');
  });

  it('does not let custom headers override BookOrbit auth headers', async () => {
    const fetchMock = setFetch(async () => jsonResponse(200, { results: [], unmatched: [] }));
    const client = new BookOrbitClient(
      makeConfig({ customHeaders: { 'X-Auth-Key': 'attacker-supplied' } }),
    );
    await client.exchangeAnnotations([]);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Auth-Key']).toBe('a'.repeat(32));
  });
});
