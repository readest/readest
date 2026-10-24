import { describe, expect, it, vi } from 'vitest';

import { getCacheSources } from '@/app/library/components/CacheManagerWindow';
import type { AppService } from '@/types/system';

/**
 * Manage Cache on desktop: the app cache root is not Readest's alone there
 * (WebKit's cache on macOS, the WebView2 profile on Windows) and Temp is the
 * system-wide temp dir on macOS and Linux, so desktop clears only the cache
 * dirs Readest writes and can rebuild. Mobile keeps clearing its sandboxed
 * Cache and Temp roots.
 */

vi.mock('@tauri-apps/api/path', () => ({
  documentDir: vi.fn(async () => '/docs'),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));

const service = (flags: Partial<AppService>) =>
  ({ isIOSApp: false, isMobileApp: false, isDesktopApp: false, ...flags }) as AppService;

describe('getCacheSources', () => {
  it('clears only Readest-owned cache dirs on desktop, never a cache or temp root', async () => {
    const sources = await getCacheSources(service({ isDesktopApp: true }));

    expect(sources).toEqual([
      { base: 'Cache', dir: 'browser-downloads' },
      { base: 'Cache', dir: 'page-thumbnails' },
    ]);
  });

  it('clears the sandboxed Cache and Temp roots on Android', async () => {
    const sources = await getCacheSources(service({ isMobileApp: true }));

    expect(sources).toEqual([
      { base: 'Cache', dir: '' },
      { base: 'Temp', dir: '' },
    ]);
  });

  it('adds the Documents/Inbox folder on iOS', async () => {
    const sources = await getCacheSources(service({ isMobileApp: true, isIOSApp: true }));

    expect(sources).toEqual([
      { base: 'Cache', dir: '' },
      { base: 'Temp', dir: '' },
      { base: 'None', dir: '/docs/Inbox' },
    ]);
  });
});
