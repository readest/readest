import { describe, test, expect, beforeEach, vi } from 'vitest';
import type { SystemSettings } from '@/types/settings';

vi.mock('@/utils/access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/access')>();
  return {
    ...actual,
    isCloudSyncAllowed: vi.fn(actual.isCloudSyncAllowed),
  };
});

import {
  applySyncBooksAutoEnable,
  cloudProviderDisplayName,
  getCloudSyncProvider,
  isReadestCloudStorageActive,
  resolveCloudSyncGate,
  setCachedUserPlan,
  settingsKeyForBackend,
} from '@/services/sync/cloudSyncProvider';
import { isCloudSyncAllowed } from '@/utils/access';

const makeSettings = (overrides: Partial<SystemSettings> = {}): SystemSettings =>
  ({
    webdav: { enabled: false },
    googleDrive: { enabled: false },
    ...overrides,
  }) as SystemSettings;

beforeEach(() => {
  vi.mocked(isCloudSyncAllowed).mockReturnValue(true);
  setCachedUserPlan('free');
});

describe('getCloudSyncProvider', () => {
  test('derives readest when no third-party provider is enabled', () => {
    expect(getCloudSyncProvider(makeSettings())).toBe('readest');
  });

  test('derives webdav when webdav is enabled', () => {
    const settings = makeSettings({ webdav: { enabled: true } } as Partial<SystemSettings>);
    expect(getCloudSyncProvider(settings)).toBe('webdav');
  });

  test('derives gdrive when google drive is enabled', () => {
    const settings = makeSettings({ googleDrive: { enabled: true } } as Partial<SystemSettings>);
    expect(getCloudSyncProvider(settings)).toBe('gdrive');
  });

  test('derives s3 when s3 is enabled', () => {
    const settings = makeSettings({ s3: { enabled: true } } as Partial<SystemSettings>);
    expect(getCloudSyncProvider(settings)).toBe('s3');
  });

  test('webdav wins deterministically over s3 when both are enabled (corrupt state)', () => {
    const settings = makeSettings({
      webdav: { enabled: true },
      s3: { enabled: true },
    } as Partial<SystemSettings>);
    expect(getCloudSyncProvider(settings)).toBe('webdav');
  });

  test('webdav wins deterministically when both flags are enabled (corrupt state)', () => {
    const settings = makeSettings({
      webdav: { enabled: true },
      googleDrive: { enabled: true },
    } as Partial<SystemSettings>);
    expect(getCloudSyncProvider(settings)).toBe('webdav');
  });

  test('defaults to readest for missing slices and missing settings', () => {
    expect(getCloudSyncProvider({} as SystemSettings)).toBe('readest');
    expect(getCloudSyncProvider(null)).toBe('readest');
    expect(getCloudSyncProvider(undefined)).toBe('readest');
  });
});

describe('resolveCloudSyncGate', () => {
  test('readest provider is never paused, even when cloud sync is disallowed', () => {
    vi.mocked(isCloudSyncAllowed).mockReturnValue(false);
    expect(resolveCloudSyncGate(makeSettings(), 'free')).toEqual({
      provider: 'readest',
      paused: false,
    });
  });

  test('third-party provider stays selected but paused when disallowed (no silent readest fallback)', () => {
    vi.mocked(isCloudSyncAllowed).mockReturnValue(false);
    const settings = makeSettings({ webdav: { enabled: true } } as Partial<SystemSettings>);
    expect(resolveCloudSyncGate(settings, 'free')).toEqual({ provider: 'webdav', paused: true });
  });

  test('third-party provider is active when allowed', () => {
    const settings = makeSettings({ googleDrive: { enabled: true } } as Partial<SystemSettings>);
    expect(resolveCloudSyncGate(settings, 'plus')).toEqual({ provider: 'gdrive', paused: false });
  });

  test('falls back to the cached user plan when no plan argument is given', () => {
    vi.mocked(isCloudSyncAllowed).mockImplementation((plan) => plan !== 'free');
    const settings = makeSettings({ webdav: { enabled: true } } as Partial<SystemSettings>);

    setCachedUserPlan('free');
    expect(resolveCloudSyncGate(settings).paused).toBe(true);

    setCachedUserPlan('pro');
    expect(resolveCloudSyncGate(settings).paused).toBe(false);
  });

  test('undefined cached plan is treated as free', () => {
    vi.mocked(isCloudSyncAllowed).mockImplementation((plan) => plan !== 'free');
    const settings = makeSettings({ webdav: { enabled: true } } as Partial<SystemSettings>);
    setCachedUserPlan(undefined);
    expect(resolveCloudSyncGate(settings).paused).toBe(true);
  });
});

describe('applySyncBooksAutoEnable (upgrade migration for already-enabled providers)', () => {
  test('flips syncBooks on for an enabled webdav provider, mutating the given settings', () => {
    const settings = makeSettings({
      webdav: { enabled: true, syncBooks: false },
    } as Partial<SystemSettings>);
    expect(applySyncBooksAutoEnable(settings)).toBe(true);
    expect(settings.webdav?.syncBooks).toBe(true);
  });

  test('flips syncBooks on for an enabled gdrive provider', () => {
    const settings = makeSettings({
      googleDrive: { enabled: true, syncBooks: false },
    } as Partial<SystemSettings>);
    expect(applySyncBooksAutoEnable(settings)).toBe(true);
    expect(settings.googleDrive?.syncBooks).toBe(true);
  });

  test('no-op when readest is the provider', () => {
    const settings = makeSettings();
    expect(applySyncBooksAutoEnable(settings)).toBe(false);
    expect(settings.webdav?.syncBooks).toBeUndefined();
  });

  test('no-op when syncBooks is already on', () => {
    const settings = makeSettings({
      webdav: { enabled: true, syncBooks: true },
    } as Partial<SystemSettings>);
    expect(applySyncBooksAutoEnable(settings)).toBe(false);
  });

  test('only the selected provider is flipped when both are enabled', () => {
    const settings = makeSettings({
      webdav: { enabled: true, syncBooks: false },
      googleDrive: { enabled: true, syncBooks: false },
    } as Partial<SystemSettings>);
    expect(applySyncBooksAutoEnable(settings)).toBe(true);
    expect(settings.webdav?.syncBooks).toBe(true);
    expect(settings.googleDrive?.syncBooks).toBe(false);
  });
});

describe('isReadestCloudStorageActive', () => {
  test('true when readest is the derived provider', () => {
    expect(isReadestCloudStorageActive(makeSettings())).toBe(true);
  });

  test('false when a third-party provider is selected', () => {
    const settings = makeSettings({ webdav: { enabled: true } } as Partial<SystemSettings>);
    expect(isReadestCloudStorageActive(settings)).toBe(false);
  });

  test('false while paused: uploads must not silently resume to Readest Cloud', () => {
    vi.mocked(isCloudSyncAllowed).mockReturnValue(false);
    const settings = makeSettings({ googleDrive: { enabled: true } } as Partial<SystemSettings>);
    expect(isReadestCloudStorageActive(settings, 'free')).toBe(false);
  });
});

describe('settingsKeyForBackend', () => {
  test('maps each backend kind to its settings slice', () => {
    expect(settingsKeyForBackend('webdav')).toBe('webdav');
    expect(settingsKeyForBackend('gdrive')).toBe('googleDrive');
    expect(settingsKeyForBackend('s3')).toBe('s3');
  });
});

describe('cloudProviderDisplayName', () => {
  test('names every provider kind', () => {
    expect(cloudProviderDisplayName('webdav')).toBe('WebDAV');
    expect(cloudProviderDisplayName('gdrive')).toBe('Google Drive');
    expect(cloudProviderDisplayName('s3')).toBe('S3');
    expect(cloudProviderDisplayName('readest')).toBe('Readest Cloud');
  });
});
