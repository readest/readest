import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KOSyncClient } from '@/services/sync/KOSyncClient';
import { KOSyncSettings } from '@/types/settings';

// The LAN-server branch of KOSyncClient.request uses window.fetch (mocked
// per-test); the Tauri HTTP plugin is never invoked here, so stub the import
// to keep the unit environment free of Tauri internals.
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));

const makeConfig = (overrides: Partial<KOSyncSettings> = {}): KOSyncSettings => ({
  enabled: true,
  // A LAN address makes request() take the direct window.fetch path.
  serverUrl: 'http://192.168.1.50',
  username: 'alice',
  userkey: '',
  password: '',
  deviceId: 'device-1',
  deviceName: 'Readest',
  checksumMethod: 'binary',
  strategy: 'prompt',
  ...overrides,
});

type FetchMock = ReturnType<typeof vi.fn>;

const setFetch = (impl: (...args: unknown[]) => unknown): FetchMock => {
  const mock = vi.fn(impl) as FetchMock;
  vi.stubGlobal('fetch', mock);
  window.fetch = mock as unknown as typeof window.fetch;
  return mock;
};

// Minimal Response-like object covering the fields KOSyncClient reads.
const htmlPage = (status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    throw new SyntaxError('Unexpected token < in JSON');
  },
});

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe('KOSyncClient.connect – server validation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fails when /users/auth returns 200 with a non-JSON (web UI) page', async () => {
    // A wrong Server URL that lands on the server's static web UI returns the
    // HTML index page with 200 OK. That must NOT be treated as a successful
    // login (it isn't a KOReader sync endpoint).
    setFetch(() => htmlPage(200));

    const client = new KOSyncClient(makeConfig());
    const result = await client.connect('alice', 'secret');

    expect(result.success).toBe(false);
  });

  it('succeeds when /users/auth returns a valid KOReader auth JSON', async () => {
    setFetch(() => jsonResponse(200, { authorized: 'OK' }));

    const client = new KOSyncClient(makeConfig());
    const result = await client.connect('alice', 'secret');

    expect(result.success).toBe(true);
  });

  it('fails when registration (/users/create) returns 200 with a non-JSON page', async () => {
    // /users/auth → 401 routes connect() into the create path; a web UI that
    // returns 200 HTML there must not be reported as a successful registration.
    const mock = setFetch((url: unknown) => {
      if (String(url).includes('/users/create')) return htmlPage(200);
      return htmlPage(401); // auth fails -> triggers create
    });

    const client = new KOSyncClient(makeConfig());
    const result = await client.connect('alice', 'secret');

    expect(result.success).toBe(false);
    expect(mock).toHaveBeenCalled();
  });
});
