import { describe, it, expect, afterEach } from 'vitest';
import { parseWebViewInfo, parseWebViewVersion } from '@/utils/ua';

type AppServiceParam = Parameters<typeof parseWebViewInfo>[0];

const setUserAgent = (ua: string) => {
  Object.defineProperty(navigator, 'userAgent', {
    value: ua,
    writable: true,
    configurable: true,
  });
};

// Save original UA to restore after tests
const originalUA = navigator.userAgent;

afterEach(() => {
  setUserAgent(originalUA);
});

describe('parseWebViewInfo', () => {
  it('should detect Android WebView', () => {
    setUserAgent(
      'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36',
    );
    const appService = { isAndroidApp: true } as unknown as AppServiceParam;
    const result = parseWebViewInfo(appService);
    expect(result).toBe('WebView 120.0.6099.230');
  });

  it('should fallback for Android WebView without Chrome version', () => {
    setUserAgent('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Mobile Safari/537.36');
    const appService = { isAndroidApp: true } as unknown as AppServiceParam;
    const result = parseWebViewInfo(appService);
    expect(result).toBe('Android WebView');
  });

  it('should detect iOS WebView', () => {
    setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    );
    const appService = { isIOSApp: true } as unknown as AppServiceParam;
    const result = parseWebViewInfo(appService);
    expect(result).toBe('WebView 605.1.15');
  });

  it('should detect macOS WebView', () => {
    setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko)',
    );
    const appService = { isMacOSApp: true } as unknown as AppServiceParam;
    const result = parseWebViewInfo(appService);
    expect(result).toBe('WebView 605.1.15');
  });

  it('should detect Windows WebView2', () => {
    setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.91',
    );
    const appService = {
      appPlatform: 'tauri',
      osPlatform: 'windows',
    } as unknown as AppServiceParam;
    const result = parseWebViewInfo(appService);
    expect(result).toBe('Edge 120.0.2210.91');
  });

  it('should detect Linux WebView', () => {
    setUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );
    const appService = {
      appPlatform: 'tauri',
      osPlatform: 'linux',
    } as unknown as AppServiceParam;
    const result = parseWebViewInfo(appService);
    expect(result).toBe('WebView 537.36');
  });

  it('should detect desktop Chrome on macOS', () => {
    setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );
    const result = parseWebViewInfo(null);
    expect(result).toBe('Chrome 120.0.0.0');
  });

  it('should detect desktop Safari on macOS', () => {
    setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    );
    const result = parseWebViewInfo(null);
    expect(result).toBe('Safari 605.1.15');
  });

  it('should detect Firefox', () => {
    setUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0');
    const result = parseWebViewInfo(null);
    expect(result).toBe('Firefox 121.0');
  });

  it('should detect Edge browser', () => {
    setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.91',
    );
    const result = parseWebViewInfo(null);
    expect(result).toBe('Edge 120.0.2210.91');
  });

  it('should return Unknown for unrecognized user agent', () => {
    setUserAgent('SomeUnknownBrowser/1.0');
    const result = parseWebViewInfo(null);
    expect(result).toBe('Unknown');
  });
});

describe('parseWebViewVersion', () => {
  it('should extract major version number', () => {
    setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );
    const result = parseWebViewVersion(null);
    expect(result).toBe(120);
  });

  it('should return 0 for unknown browser', () => {
    setUserAgent('SomeUnknownBrowser/1.0');
    const result = parseWebViewVersion(null);
    expect(result).toBe(0);
  });

  it('should extract version from Android WebView', () => {
    setUserAgent(
      'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36',
    );
    const appService = { isAndroidApp: true } as unknown as AppServiceParam;
    const result = parseWebViewVersion(appService);
    expect(result).toBe(120);
  });
});
