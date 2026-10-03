import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { SystemSettings } from '@/types/settings';
import type { ReadSettings } from '@/types/settings';
import type { ViewSettings } from '@/types/book';

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn(),
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({ label: 'main' })),
}));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: vi.fn(() => true) }));

import { emit } from '@tauri-apps/api/event';
import { hlcPack } from '@/libs/crdt';
import { createBookshelf } from '@/services/bookshelves/definitions';
import { readBookshelves } from '@/services/bookshelves/state';
import {
  broadcastGlobalSettings,
  mergeSyncedGlobalSettings,
  type SettingsSyncPayload,
} from '@/utils/settingsSync';

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
      onedrive: { enabled: false, accountLabel: 'c@d' },
    } as Partial<SystemSettings>);
    const merged = mergeSyncedGlobalSettings(local, {
      globalViewSettings: local.globalViewSettings,
      globalReadSettings: local.globalReadSettings,
      cloudSyncProviders: {
        webdav: { enabled: true, providerSelectedAt: 999 },
        googleDrive: { enabled: false },
        onedrive: { enabled: true, providerSelectedAt: 888 },
      },
    });
    expect(merged.webdav.enabled).toBe(true);
    expect(merged.webdav.providerSelectedAt).toBe(999);
    expect(merged.webdav.password).toBe('secret');
    expect(merged.webdav.deviceId).toBe('d1');
    expect(merged.webdav.lastSyncedAt).toBe(42);
    expect(merged.googleDrive.enabled).toBe(false);
    expect(merged.googleDrive.accountLabel).toBe('a@b');
    expect(merged.onedrive.enabled).toBe(true);
    expect(merged.onedrive.providerSelectedAt).toBe(888);
    expect(merged.onedrive.accountLabel).toBe('c@d');
  });

  test('a payload without provider flags leaves the slices untouched', () => {
    const local = makeLocal({
      webdav: { enabled: true, password: 'secret' },
      onedrive: { enabled: true, accountLabel: 'c@d' },
    } as Partial<SystemSettings>);
    const merged = mergeSyncedGlobalSettings(local, {
      globalViewSettings: local.globalViewSettings,
      globalReadSettings: local.globalReadSettings,
    });
    expect(merged.webdav.enabled).toBe(true);
    expect(merged.webdav.password).toBe('secret');
    expect(merged.onedrive.enabled).toBe(true);
    expect(merged.onedrive.accountLabel).toBe('c@d');
  });

  test('an absent onedrive flag in the payload leaves the local slice untouched', () => {
    const local = makeLocal({
      webdav: { enabled: false },
      onedrive: { enabled: true, accountLabel: 'c@d' },
    } as Partial<SystemSettings>);
    const merged = mergeSyncedGlobalSettings(local, {
      globalViewSettings: local.globalViewSettings,
      globalReadSettings: local.globalReadSettings,
      cloudSyncProviders: {
        webdav: { enabled: true },
        googleDrive: { enabled: false },
      },
    });
    expect(merged.onedrive.enabled).toBe(true);
    expect(merged.onedrive.accountLabel).toBe('c@d');
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

// Shelf definitions are LWW rows shared across windows, not window-local state.
const shelfState = (name: string, at: number): SystemSettings['bookshelves'] => {
  const stamp = hlcPack(at, 0, 'dev-a');
  return {
    rows: {
      default: {
        user_id: '',
        kind: 'bookshelf',
        replica_id: 'default',
        fields_jsonb: { definition: { v: createBookshelf(name, 'default'), t: stamp, s: 'dev-a' } },
        deleted_at_ts: null,
        updated_at_ts: stamp,
        reincarnation: null,
        manifest_jsonb: null,
        schema_version: 1,
      },
    },
  };
};
const shelfNames = (settings: SystemSettings) => readBookshelves(settings).map((s) => s.name);

describe('mergeSyncedGlobalSettings bookshelves', () => {
  test('keeps the newer of the local and broadcast shelf rows', () => {
    const local = makeLocal({ bookshelves: shelfState('Local edit', 2000) });
    const stale = mergeSyncedGlobalSettings(local, {
      globalViewSettings: local.globalViewSettings,
      globalReadSettings: local.globalReadSettings,
      bookshelves: shelfState('Older window', 1000),
    });
    expect(shelfNames(stale)).toContain('Local edit');

    const fresh = mergeSyncedGlobalSettings(local, {
      globalViewSettings: local.globalViewSettings,
      globalReadSettings: local.globalReadSettings,
      bookshelves: shelfState('Newer window', 3000),
    });
    expect(shelfNames(fresh)).toContain('Newer window');
  });

  test('a payload without bookshelves leaves the local rows untouched', () => {
    const local = makeLocal({ bookshelves: shelfState('Local edit', 2000) });
    const merged = mergeSyncedGlobalSettings(local, {
      globalViewSettings: local.globalViewSettings,
      globalReadSettings: local.globalReadSettings,
    });
    expect(merged.bookshelves).toBe(local.bookshelves);
    expect(shelfNames(merged)).toContain('Local edit');
  });
});

describe('broadcastGlobalSettings bookshelves', () => {
  beforeEach(() => vi.mocked(emit).mockClear());

  test('carries the shelf rows so other windows adopt the edit', async () => {
    const settings = makeLocal({ bookshelves: shelfState('Shared edit', 2000) });

    await broadcastGlobalSettings(settings);

    const payload = vi.mocked(emit).mock.calls[0]![1] as SettingsSyncPayload;
    expect(payload.bookshelves).toEqual(settings.bookshelves);
  });
});
