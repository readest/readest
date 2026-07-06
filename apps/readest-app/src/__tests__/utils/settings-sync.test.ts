import { describe, test, expect } from 'vitest';
import type { SystemSettings } from '@/types/settings';
import type { ReadSettings } from '@/types/settings';
import type { ViewSettings } from '@/types/book';
import { mergeSyncedGlobalSettings } from '@/utils/settingsSync';

const makeLocal = (overrides: Partial<SystemSettings> = {}): SystemSettings =>
  ({
    localBooksDir: '/device-local/books',
    customRootDir: '/device-local/root',
    lastOpenBooks: ['book-only-open-in-this-window'],
    screenBrightness: 0.42,
    lastSyncedAtBooks: 1234,
    globalViewSettings: { disableClick: false, disableSwipe: false } as ViewSettings,
    globalReadSettings: { sideBarWidth: '15%' } as ReadSettings,
    ...overrides,
  }) as SystemSettings;

describe('mergeSyncedGlobalSettings cloud sync provider flags', () => {
  test('adopts enabled flags and providerSelectedAt, preserving credentials and cursors', () => {
    const local = makeLocal({
      webdav: {
        enabled: false,
        serverUrl: 'https://dav',
        password: 'secret',
        deviceId: 'd1',
        lastSyncedAt: 42,
      },
      googleDrive: { enabled: true, accountLabel: 'a@b' },
    } as Partial<SystemSettings>);
    const merged = mergeSyncedGlobalSettings(local, {
      globalViewSettings: local.globalViewSettings,
      globalReadSettings: local.globalReadSettings,
      cloudSyncProviders: {
        webdav: { enabled: true, providerSelectedAt: 999 },
        googleDrive: { enabled: false },
      },
    });
    expect(merged.webdav.enabled).toBe(true);
    expect(merged.webdav.providerSelectedAt).toBe(999);
    expect(merged.webdav.password).toBe('secret');
    expect(merged.webdav.deviceId).toBe('d1');
    expect(merged.webdav.lastSyncedAt).toBe(42);
    expect(merged.googleDrive.enabled).toBe(false);
    expect(merged.googleDrive.accountLabel).toBe('a@b');
  });

  test('a payload without provider flags leaves the slices untouched', () => {
    const local = makeLocal({
      webdav: { enabled: true, password: 'secret' },
    } as Partial<SystemSettings>);
    const merged = mergeSyncedGlobalSettings(local, {
      globalViewSettings: local.globalViewSettings,
      globalReadSettings: local.globalReadSettings,
    });
    expect(merged.webdav.enabled).toBe(true);
    expect(merged.webdav.password).toBe('secret');
  });
});

describe('mergeSyncedGlobalSettings', () => {
  test('adopts the broadcasting window global view settings', () => {
    const local = makeLocal();
    const merged = mergeSyncedGlobalSettings(local, {
      globalViewSettings: { disableClick: true, disableSwipe: true } as ViewSettings,
      globalReadSettings: { sideBarWidth: '15%' } as ReadSettings,
    });

    expect(merged.globalViewSettings.disableClick).toBe(true);
    expect(merged.globalViewSettings.disableSwipe).toBe(true);
  });

  test('adopts the broadcasting window global read settings', () => {
    const local = makeLocal();
    const merged = mergeSyncedGlobalSettings(local, {
      globalViewSettings: local.globalViewSettings,
      globalReadSettings: { sideBarWidth: '30%' } as ReadSettings,
    });

    expect(merged.globalReadSettings.sideBarWidth).toBe('30%');
  });

  test('preserves device/window-local fields from the local copy', () => {
    const local = makeLocal();
    const merged = mergeSyncedGlobalSettings(local, {
      globalViewSettings: { disableClick: true } as ViewSettings,
      globalReadSettings: { sideBarWidth: '30%' } as ReadSettings,
    });

    expect(merged.localBooksDir).toBe('/device-local/books');
    expect(merged.customRootDir).toBe('/device-local/root');
    expect(merged.lastOpenBooks).toEqual(['book-only-open-in-this-window']);
    expect(merged.screenBrightness).toBe(0.42);
    expect(merged.lastSyncedAtBooks).toBe(1234);
  });

  test('returns a new object without mutating the local settings', () => {
    const local = makeLocal();
    const merged = mergeSyncedGlobalSettings(local, {
      globalViewSettings: { disableClick: true } as ViewSettings,
      globalReadSettings: { sideBarWidth: '30%' } as ReadSettings,
    });

    expect(merged).not.toBe(local);
    expect(local.globalViewSettings.disableClick).toBe(false);
  });
});
