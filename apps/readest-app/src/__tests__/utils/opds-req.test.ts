import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deserializeCustomHeaders } from '@/utils/customHeaders';

// Mock environment for web platform
vi.mock('@/services/environment', () => ({
  isWebAppPlatform: vi.fn(() => true),
  isTauriAppPlatform: vi.fn(() => false),
  getAPIBaseUrl: () => '/api',
  getNodeAPIBaseUrl: () => '/node-api',
  getBaseUrl: () => 'https://web.readest.com',
  getNodeBaseUrl: () => 'https://node.readest.com',
  isWebDevMode: () => true,
}));

// Mock tauriFetch to avoid import errors
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

type FakeResponseInit = {
  status?: number;
  body?: string;
  wwwAuthenticate?: string;
};

const makeResponse = ({ status = 200, body = '', wwwAuthenticate }: FakeResponseInit = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: {
    get: (name: string) =>
      name.toLowerCase() === 'www-authenticate' ? (wwwAuthenticate ?? null) : null,
  },
  text: async () => body,
});

describe('opdsReq', () => {
  let needsProxy: typeof import('@/app/opds/utils/opdsReq').needsProxy;
  let getProxiedURL: typeof import('@/app/opds/utils/opdsReq').getProxiedURL;
  let isWebAppPlatform: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    const envModule = await import('@/services/environment');
    isWebAppPlatform = envModule.isWebAppPlatform as ReturnType<typeof vi.fn>;
    const opdsReq = await import('@/app/opds/utils/opdsReq');
    needsProxy = opdsReq.needsProxy;
    getProxiedURL = opdsReq.getProxiedURL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('needsProxy', () => {
    it('should return true for HTTP URLs on web platform', () => {
      isWebAppPlatform.mockReturnValue(true);
      expect(needsProxy('http://my-opds-server.local/covers/book.jpg')).toBe(true);
    });

    it('should return true for HTTPS URLs on web platform', () => {
      isWebAppPlatform.mockReturnValue(true);
      expect(needsProxy('https://opds.example.com/feed')).toBe(true);
    });

    it('should return false on native/Tauri platform', () => {
      isWebAppPlatform.mockReturnValue(false);
      expect(needsProxy('http://my-opds-server.local/covers/book.jpg')).toBe(false);
    });

    it('should return false for non-HTTP URLs', () => {
      isWebAppPlatform.mockReturnValue(true);
      expect(needsProxy('/local/path/image.jpg')).toBe(false);
      expect(needsProxy('data:image/png;base64,...')).toBe(false);
    });
  });

  describe('getProxiedURL', () => {
    it('should generate proxy URL for image requests without auth', () => {
      const imageUrl = 'http://my-opds-server.local/covers/book.jpg';
      const proxied = getProxiedURL(imageUrl, '', true);
      expect(proxied).toContain('/api/opds/proxy');
      expect(proxied).toContain('url=' + encodeURIComponent(imageUrl));
      expect(proxied).toContain('stream=true');
    });

    it('should generate proxy URL with auth parameter', () => {
      const imageUrl = 'http://my-opds-server.local/covers/book.jpg';
      const auth = 'Basic dXNlcjpwYXNz';
      const proxied = getProxiedURL(imageUrl, auth, true);
      // URLSearchParams encodes spaces as '+' rather than '%20'
      expect(proxied).toContain('auth=Basic+dXNlcjpwYXNz');
    });

    it('should include serialized custom headers in the proxy URL', () => {
      const imageUrl = 'http://my-opds-server.local/covers/book.jpg';
      const proxied = getProxiedURL(imageUrl, '', true, {
        'CF-Access-Client-Id': 'client-id',
        'CF-Access-Client-Secret': 'secret',
      });
      const params = new URL(proxied, 'https://web.readest.com').searchParams;

      expect(deserializeCustomHeaders(params.get('headers'))).toEqual({
        'CF-Access-Client-Id': 'client-id',
        'CF-Access-Client-Secret': 'secret',
      });
    });

    it('should strip credentials from URL before proxying', () => {
      const imageUrl = 'http://user:pass@my-opds-server.local/covers/book.jpg';
      const proxied = getProxiedURL(imageUrl);
      expect(proxied).not.toContain('user:pass');
      expect(proxied).toContain(
        'url=' + encodeURIComponent('http://my-opds-server.local/covers/book.jpg'),
      );
    });

    it('should return non-HTTP URLs unchanged', () => {
      const localPath = '/local/path/image.jpg';
      expect(getProxiedURL(localPath)).toBe(localPath);
    });

    it('should use node proxy for standardebooks domain', () => {
      const url = 'https://standardebooks.org/opds/all';
      const proxied = getProxiedURL(url);
      expect(proxied).toContain('/node-api/opds/proxy');
    });
  });

  describe('fetchWithAuth', () => {
    let fetchWithAuth: typeof import('@/app/opds/utils/opdsReq').fetchWithAuth;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const opdsReq = await import('@/app/opds/utils/opdsReq');
      fetchWithAuth = opdsReq.fetchWithAuth;
      fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('sends Basic auth on the first request when credentials are provided', async () => {
      // Servers that allow anonymous access return 200 without a challenge.
      // The credentials must be sent preemptively or the user keeps seeing
      // guest content (issue #4202).
      fetchMock.mockResolvedValue(makeResponse({ status: 200, body: '<feed/>' }));

      await fetchWithAuth('https://opds.example.com/feed', 'alice', 's3cret', false);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const init = fetchMock.mock.calls[0]![1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe(`Basic ${btoa('alice:s3cret')}`);
    });

    it('does not send an Authorization header when no credentials are provided', async () => {
      fetchMock.mockResolvedValue(makeResponse({ status: 200, body: '<feed/>' }));

      await fetchWithAuth('https://opds.example.com/feed', undefined, undefined, false);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const init = fetchMock.mock.calls[0]![1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });

    it('passes preemptive auth through the proxy URL when useProxy is true', async () => {
      fetchMock.mockResolvedValue(makeResponse({ status: 200, body: '<feed/>' }));

      await fetchWithAuth('https://opds.example.com/feed', 'alice', 's3cret', true);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const proxyUrl = fetchMock.mock.calls[0]![0] as string;
      const auth = new URL(proxyUrl, 'https://web.readest.com').searchParams.get('auth');
      expect(auth).toBe(`Basic ${btoa('alice:s3cret')}`);
    });

    it('recovers when a Digest-only server rejects the preemptive Basic header with 400', async () => {
      // Calibre in 'digest' (or 'auto' over http) mode responds to a Basic
      // Authorization header with 400 "Unsupported authentication method"
      // instead of a 401 challenge, so the preemptive Basic header dead-ends
      // the request. The client must re-issue the request without credentials
      // to obtain the WWW-Authenticate challenge, then negotiate Digest.
      fetchMock
        .mockResolvedValueOnce(
          makeResponse({ status: 400, body: 'Unsupported authentication method' }),
        )
        .mockResolvedValueOnce(
          makeResponse({
            status: 401,
            wwwAuthenticate: 'Digest realm="calibre", nonce="abc123", algorithm="MD5", qop="auth"',
          }),
        )
        .mockResolvedValueOnce(makeResponse({ status: 200, body: '<feed/>' }));

      const res = await fetchWithAuth('http://calibre.example.com/opds', 'alice', 's3cret', false);

      expect(fetchMock).toHaveBeenCalledTimes(3);
      const bareInit = fetchMock.mock.calls[1]![1] as RequestInit;
      const bareHeaders = bareInit.headers as Record<string, string>;
      expect(bareHeaders['Authorization']).toBeUndefined();
      const digestInit = fetchMock.mock.calls[2]![1] as RequestInit;
      const digestHeaders = digestInit.headers as Record<string, string>;
      expect(digestHeaders['Authorization']).toMatch(/^Digest /);
      expect(res.status).toBe(200);
    });

    it('recovers from the preemptive-Basic 400 through the proxy as well', async () => {
      fetchMock
        .mockResolvedValueOnce(
          makeResponse({ status: 400, body: 'Unsupported authentication method' }),
        )
        .mockResolvedValueOnce(
          makeResponse({
            // The web proxy maps the upstream 401 to 403 and forwards the
            // WWW-Authenticate challenge.
            status: 403,
            wwwAuthenticate: 'Digest realm="calibre", nonce="abc123", algorithm="MD5", qop="auth"',
          }),
        )
        .mockResolvedValueOnce(makeResponse({ status: 200, body: '<feed/>' }));

      const res = await fetchWithAuth('http://calibre.example.com/opds', 'alice', 's3cret', true);

      expect(fetchMock).toHaveBeenCalledTimes(3);
      const bareUrl = fetchMock.mock.calls[1]![0] as string;
      expect(new URL(bareUrl, 'https://web.readest.com').searchParams.get('auth')).toBeNull();
      const digestUrl = fetchMock.mock.calls[2]![0] as string;
      expect(new URL(digestUrl, 'https://web.readest.com').searchParams.get('auth')).toMatch(
        /^Digest /,
      );
      expect(res.status).toBe(200);
    });

    it('does not add an Origin header to web-platform requests', async () => {
      fetchMock.mockResolvedValue(makeResponse({ status: 200, body: '<feed/>' }));

      await fetchWithAuth('https://komga.example.com/opds/v2/catalog', 'alice', 's3cret', true);

      const init = fetchMock.mock.calls[0]![1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect('Origin' in headers).toBe(false);
    });

    it('retries with Digest auth when the server issues a Digest challenge', async () => {
      fetchMock
        .mockResolvedValueOnce(
          makeResponse({
            status: 401,
            wwwAuthenticate: 'Digest realm="opds", nonce="abc123", qop="auth"',
          }),
        )
        .mockResolvedValueOnce(makeResponse({ status: 200, body: '<feed/>' }));

      const res = await fetchWithAuth('https://opds.example.com/feed', 'alice', 's3cret', false);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const init = fetchMock.mock.calls[1]![1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toMatch(/^Digest /);
      expect(res.status).toBe(200);
    });
  });

  describe('Origin header suppression on Tauri (#5698)', () => {
    // tauri-plugin-http appends the webview origin (`tauri://localhost`) as
    // the Origin header of every request unless the caller sets one.
    // Spring-based servers such as Komga treat it as a foreign CORS origin
    // and reject the request with 403 "Invalid CORS request" before
    // authentication ever happens. An explicit empty Origin makes the plugin
    // (built with `unsafe-headers`) drop the header entirely.
    let fetchWithAuth: typeof import('@/app/opds/utils/opdsReq').fetchWithAuth;
    let probeAuth: typeof import('@/app/opds/utils/opdsReq').probeAuth;
    let isTauriAppPlatform: ReturnType<typeof vi.fn>;
    let tauriFetchMock: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const envModule = await import('@/services/environment');
      isTauriAppPlatform = envModule.isTauriAppPlatform as ReturnType<typeof vi.fn>;
      isTauriAppPlatform.mockReturnValue(true);
      // The mock registry is not cleared by vi.resetModules(), so the plugin
      // fetch mock and its call history persist across tests unless reset.
      const pluginHttp = await import('@tauri-apps/plugin-http');
      tauriFetchMock = pluginHttp.fetch as ReturnType<typeof vi.fn>;
      tauriFetchMock.mockReset();
      const opdsReq = await import('@/app/opds/utils/opdsReq');
      fetchWithAuth = opdsReq.fetchWithAuth;
      probeAuth = opdsReq.probeAuth;
    });

    afterEach(() => {
      tauriFetchMock.mockReset();
      isTauriAppPlatform.mockReturnValue(false);
    });

    it('suppresses the webview Origin header on fetchWithAuth requests', async () => {
      tauriFetchMock.mockResolvedValue(makeResponse({ status: 200, body: '<feed/>' }));

      await fetchWithAuth('https://komga.example.com/opds/v2/catalog', 'alice', 's3cret', false);

      expect(tauriFetchMock).toHaveBeenCalledTimes(1);
      const init = tauriFetchMock.mock.calls[0]![1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['Origin']).toBe('');
    });

    it('lets a user-defined custom Origin header win over the suppression marker', async () => {
      tauriFetchMock.mockResolvedValue(makeResponse({ status: 200, body: '<feed/>' }));

      await fetchWithAuth(
        'https://komga.example.com/opds/v2/catalog',
        'alice',
        's3cret',
        false,
        {},
        { Origin: 'https://allowed.example.com' },
      );

      const init = tauriFetchMock.mock.calls[0]![1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['Origin']).toBe('https://allowed.example.com');
    });

    it('lets a lowercase custom origin header win without colliding with the marker', async () => {
      // Header names are case-insensitive on the wire but not in a JS object,
      // and `normalizeCustomHeaders` preserves whatever the user typed. A
      // `{ Origin: '' }` marker spread alongside a custom `origin` would leave
      // both keys in place, and the plugin's `new Headers()` merges the pair
      // into `", https://allowed.example.com"` — not empty, so the plugin never
      // drops it, and not a valid Origin either, so the catalog still 403s.
      tauriFetchMock.mockResolvedValue(makeResponse({ status: 200, body: '<feed/>' }));

      await fetchWithAuth(
        'https://komga.example.com/opds/v2/catalog',
        'alice',
        's3cret',
        false,
        {},
        { origin: 'https://allowed.example.com' },
      );

      const init = tauriFetchMock.mock.calls[0]![1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      // Assert through Headers, which is what the plugin builds internally, so
      // a reintroduced duplicate key fails here instead of silently on device.
      expect(new Headers(headers).get('origin')).toBe('https://allowed.example.com');
    });

    it('suppresses the webview Origin header on the HEAD probe', async () => {
      tauriFetchMock.mockResolvedValue(makeResponse({ status: 200 }));

      await probeAuth('https://komga.example.com/opds/v2/catalog', 'alice', 's3cret', false);

      expect(tauriFetchMock).toHaveBeenCalledTimes(1);
      const init = tauriFetchMock.mock.calls[0]![1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['Origin']).toBe('');
    });
  });
});
