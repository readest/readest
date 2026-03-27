import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
});
