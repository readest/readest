import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KOSyncClient } from '@/services/sync/KOSyncClient';
import { Book } from '@/types/book';
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

const makeBook = (): Book =>
  ({
    hash: 'f248ce0f15105ff390e5292085e0622b',
    title: 'A Book',
  }) as Book;

describe('KOSyncClient.getProgress – server response shapes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts a progress payload that omits `document`', async () => {
    // Not every KOSync-compatible server echoes the document hash back on GET.
    // koreader-sync only selects progress/percentage/device/device_id/timestamp,
    // so requiring `document` silently discarded a perfectly good remote
    // position and the reader then pushed its stale one over it. (#5063, #5065)
    setFetch(() =>
      jsonResponse(200, {
        progress: '/body/DocFragment[3]/body/div/p[12].0',
        percentage: 0.0174,
        device: 'KindlePaperWhite5',
        device_id: '8F6F541940B74D32B606503DB6B43E0F',
        timestamp: 1783773009,
      }),
    );

    const client = new KOSyncClient(makeConfig({ userkey: 'key' }));
    const progress = await client.getProgress(makeBook());

    expect(progress).not.toBeNull();
    expect(progress!.progress).toBe('/body/DocFragment[3]/body/div/p[12].0');
    expect(progress!.percentage).toBe(0.0174);
    // The requested hash stands in for the document the server left out.
    expect(progress!.document).toBe('f248ce0f15105ff390e5292085e0622b');
  });

  it('accepts a progress payload that includes `document`', async () => {
    setFetch(() =>
      jsonResponse(200, {
        document: 'f248ce0f15105ff390e5292085e0622b',
        progress: '/body/DocFragment[3]/body/div/p[12].0',
        percentage: 0.0174,
        timestamp: 1783773009,
      }),
    );

    const client = new KOSyncClient(makeConfig({ userkey: 'key' }));
    const progress = await client.getProgress(makeBook());

    expect(progress!.document).toBe('f248ce0f15105ff390e5292085e0622b');
  });

  it('returns null when a 200 body carries no usable position', async () => {
    // Some servers answer "no progress stored" with 200 and a status body
    // instead of a 404; that must not be mistaken for a remote position.
    setFetch(() => jsonResponse(200, { status: 'not found' }));

    const client = new KOSyncClient(makeConfig({ userkey: 'key' }));

    expect(await client.getProgress(makeBook())).toBeNull();
  });

  it('returns null when the server answers 404', async () => {
    setFetch(() => jsonResponse(404, { status: 'not found' }));

    const client = new KOSyncClient(makeConfig({ userkey: 'key' }));

    expect(await client.getProgress(makeBook())).toBeNull();
  });
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
