import { describe, expect, test, vi, beforeEach } from 'vitest';
import type { SystemSettings } from '@/types/settings';
import type { FileSystem } from '@/types/system';

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({ label: 'main' })),
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: vi.fn(() => true),
}));

import { emit } from '@tauri-apps/api/event';
import { getDefaultViewSettings } from '@/services/settingsService';
import {
  DEFAULT_SYSTEM_SETTINGS,
  DEFAULT_READSETTINGS,
  DEFAULT_WEBDAV_SETTINGS,
} from '@/services/constants';
import {
  broadcastGlobalSettings,
  mergeSyncedGlobalSettings,
  type SettingsSyncPayload,
} from '@/utils/settingsSync';

const local = {
  webdav: { enabled: false, password: 'secret' },
  googleDrive: { enabled: false },
  readestCloud: { enabled: true },
  globalViewSettings: {},
  globalReadSettings: {},
} as unknown as SystemSettings;

const globals = {
  globalViewSettings: {} as SystemSettings['globalViewSettings'],
  globalReadSettings: {} as SystemSettings['globalReadSettings'],
};

describe('mergeSyncedGlobalSettings: readestCloud', () => {
  test('adopts a broadcast Readest Cloud switch-off', () => {
    const merged = mergeSyncedGlobalSettings(local, {
      ...globals,
      cloudSyncProviders: {
        webdav: { enabled: true },
        googleDrive: { enabled: false },
        readestCloud: { enabled: false, disabledAt: 1234 },
      },
    });
    expect(merged.readestCloud?.enabled).toBe(false);
    expect(merged.readestCloud?.disabledAt).toBe(1234);
    // Credentials never ride the wire, and the local copy is preserved.
    expect(merged.webdav.password).toBe('secret');
  });

  test('a payload without readestCloud leaves the local value untouched', () => {
    const merged = mergeSyncedGlobalSettings(local, {
      ...globals,
      cloudSyncProviders: {
        webdav: { enabled: true },
        googleDrive: { enabled: false },
      },
    });
    expect(merged.readestCloud?.enabled).toBe(true);
  });
});

// Real SystemSettings fixture built from the app's own default-settings
// factories (the same ones `loadSettings` uses), so this exercises the real
// `broadcastGlobalSettings` end to end instead of mocking the whole module.
const defaultGlobalViewSettings = getDefaultViewSettings({
  fs: {} as FileSystem,
  isMobile: false,
  isEink: false,
  isAppDataSandbox: false,
});

function makeFullSettings(overrides: Partial<SystemSettings> = {}): SystemSettings {
  return {
    ...DEFAULT_SYSTEM_SETTINGS,
    version: 1,
    localBooksDir: '/books',
    customFonts: [],
    customTextures: [],
    opdsCatalogs: [],
    savedBookCoverForLockScreen: '',
    savedBookCoverForLockScreenPath: '',
    globalReadSettings: DEFAULT_READSETTINGS,
    globalViewSettings: defaultGlobalViewSettings,
    ...overrides,
  } as SystemSettings;
}

describe('broadcastGlobalSettings: readestCloud in the emitted payload', () => {
  beforeEach(() => {
    vi.mocked(emit).mockClear();
  });

  const capturePayload = (): SettingsSyncPayload => {
    const call = vi.mocked(emit).mock.calls[0];
    return call![1] as SettingsSyncPayload;
  };

  test('omits the readestCloud key entirely when settings has no readestCloud slice', async () => {
    const settings = makeFullSettings();
    expect(settings.readestCloud).toBeUndefined();

    await broadcastGlobalSettings(settings, { includeCloudSyncProviders: true });

    const payload = capturePayload();
    expect(payload.cloudSyncProviders).toBeDefined();
    // A key present with value `undefined` is NOT the same as an absent key:
    // the receiving window's merge only touches `readestCloud` `if
    // (payload.cloudSyncProviders.readestCloud)`, so an explicit `{ enabled:
    // undefined }` would still be truthy and would clobber the receiver.
    expect('readestCloud' in payload.cloudSyncProviders!).toBe(false);
  });

  test('carries enabled:false and disabledAt faithfully', async () => {
    const settings = makeFullSettings({
      readestCloud: { enabled: false, disabledAt: 1234 },
    });

    await broadcastGlobalSettings(settings, { includeCloudSyncProviders: true });

    const payload = capturePayload();
    expect(payload.cloudSyncProviders?.readestCloud).toEqual({ enabled: false, disabledAt: 1234 });
  });

  test('carries enabled:true', async () => {
    const settings = makeFullSettings({
      readestCloud: { enabled: true },
    });

    await broadcastGlobalSettings(settings, { includeCloudSyncProviders: true });

    const payload = capturePayload();
    expect(payload.cloudSyncProviders?.readestCloud?.enabled).toBe(true);
  });

  test('never carries credentials or lastSyncedAt', async () => {
    const settings = makeFullSettings({
      webdav: {
        ...DEFAULT_WEBDAV_SETTINGS,
        enabled: true,
        password: 'hunter2',
        lastSyncedAt: 999,
      },
      readestCloud: { enabled: true },
    });

    await broadcastGlobalSettings(settings, { includeCloudSyncProviders: true });

    const payload = capturePayload();
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('lastSyncedAt');
  });
});
