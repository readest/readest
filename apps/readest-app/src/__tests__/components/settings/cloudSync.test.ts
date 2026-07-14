import { describe, expect, test, vi, beforeEach } from 'vitest';

vi.mock('@/utils/settingsSync', () => ({
  broadcastGlobalSettings: vi.fn(),
}));

import { withActiveCloudProvider } from '@/components/settings/integrations/cloudSync';
import {
  persistCloudProviderEnabled,
  withCloudProviderEnabled,
} from '@/services/sync/cloudSyncActivation';
import { buildWebDAVConnectSettings } from '@/services/sync/providers/webdav/connectSettings';
import { useSettingsStore } from '@/store/settingsStore';
import { broadcastGlobalSettings } from '@/utils/settingsSync';
import type { WebDAVSettings } from '@/types/settings';
import { CLOUD_SYNC_REQUIRES_PREMIUM, isCloudSyncAllowed, isCloudSyncInPlan } from '@/utils/access';
import type { SystemSettings } from '@/types/settings';
import type { EnvConfigType } from '@/services/environment';

const mockBroadcastGlobalSettings = vi.mocked(broadcastGlobalSettings);

const base = {
  webdav: { enabled: true, serverUrl: 'https://dav', username: 'u', password: 'p', rootPath: '/' },
  googleDrive: { enabled: true, accountLabel: 'a@b.com' },
} as unknown as SystemSettings;

describe('withActiveCloudProvider', () => {
  test('enabling WebDAV disables Google Drive (exclusive)', () => {
    const next = withActiveCloudProvider(base, 'webdav');
    expect(next.webdav.enabled).toBe(true);
    expect(next.googleDrive.enabled).toBe(false);
  });

  test('enabling Google Drive disables WebDAV (exclusive)', () => {
    const next = withActiveCloudProvider(base, 'gdrive');
    expect(next.webdav.enabled).toBe(false);
    expect(next.googleDrive.enabled).toBe(true);
  });

  test('enabling S3 disables WebDAV and Google Drive (exclusive)', () => {
    const withS3 = {
      ...base,
      s3: { enabled: false, endpoint: 'https://acc.r2.cloudflarestorage.com', bucket: 'b' },
    } as unknown as SystemSettings;
    const next = withActiveCloudProvider(withS3, 's3');
    expect(next.s3.enabled).toBe(true);
    expect(next.webdav.enabled).toBe(false);
    expect(next.googleDrive.enabled).toBe(false);
    // Activation hands S3 the book-file channel and anchors fleet detection.
    expect(next.s3.syncBooks).toBe(true);
    expect(next.s3.providerSelectedAt).toBeTruthy();
    // Config survives deactivation elsewhere; endpoint untouched here.
    expect(next.s3.endpoint).toBe('https://acc.r2.cloudflarestorage.com');
  });

  test('enabling WebDAV disables S3 (exclusive)', () => {
    const withS3 = { ...base, s3: { enabled: true } } as unknown as SystemSettings;
    const next = withActiveCloudProvider(withS3, 'webdav');
    expect(next.s3.enabled).toBe(false);
    expect(next.webdav.enabled).toBe(true);
  });

  test('enabling OneDrive disables WebDAV, Google Drive, and S3 (exclusive)', () => {
    const withOneDrive = {
      ...base,
      s3: { enabled: true },
      onedrive: { enabled: false },
    } as unknown as SystemSettings;
    const next = withActiveCloudProvider(withOneDrive, 'onedrive');
    expect(next.onedrive.enabled).toBe(true);
    expect(next.webdav.enabled).toBe(false);
    expect(next.googleDrive.enabled).toBe(false);
    expect(next.s3.enabled).toBe(false);
    // Activation hands OneDrive the book-file channel and anchors fleet detection.
    expect(next.onedrive.syncBooks).toBe(true);
    expect(next.onedrive.providerSelectedAt).toBeTruthy();
  });

  test('enabling WebDAV disables OneDrive (exclusive)', () => {
    const withOneDrive = { ...base, onedrive: { enabled: true } } as unknown as SystemSettings;
    const next = withActiveCloudProvider(withOneDrive, 'webdav');
    expect(next.onedrive.enabled).toBe(false);
    expect(next.webdav.enabled).toBe(true);
  });

  test('null disables both', () => {
    const next = withActiveCloudProvider(base, null);
    expect(next.webdav.enabled).toBe(false);
    expect(next.googleDrive.enabled).toBe(false);
  });

  test("'readest' behaves as deactivation of both third-party providers", () => {
    const next = withActiveCloudProvider(base, 'readest');
    expect(next.webdav.enabled).toBe(false);
    expect(next.googleDrive.enabled).toBe(false);
    // Config survives so switching back needs no re-entry.
    expect(next.webdav.serverUrl).toBe('https://dav');
    expect(next.googleDrive.accountLabel).toBe('a@b.com');
  });

  test('leaves the rest of each provider config untouched', () => {
    const next = withActiveCloudProvider(base, 'gdrive');
    expect(next.webdav.serverUrl).toBe('https://dav');
    expect(next.googleDrive.accountLabel).toBe('a@b.com');
  });

  // Selecting a third-party provider hands it the book-file channel:
  // native Readest Cloud uploads gate off, so without syncBooks the books
  // would back up nowhere. Activation therefore turns syncBooks on.
  describe('syncBooks auto-enable on activation', () => {
    const inactive = {
      webdav: { enabled: false, serverUrl: 'https://dav', syncBooks: false },
      googleDrive: { enabled: false, syncBooks: false },
    } as unknown as SystemSettings;

    test('activating a disabled provider turns its syncBooks on', () => {
      const next = withActiveCloudProvider(inactive, 'webdav');
      expect(next.webdav.syncBooks).toBe(true);
      expect(next.googleDrive.syncBooks).toBe(false);
    });

    test('activating gdrive turns only gdrive syncBooks on', () => {
      const next = withActiveCloudProvider(inactive, 'gdrive');
      expect(next.googleDrive.syncBooks).toBe(true);
      expect(next.webdav.syncBooks).toBe(false);
    });

    test('re-activating an already-active provider respects an explicit syncBooks opt-out', () => {
      const active = {
        webdav: { enabled: true, syncBooks: false },
        googleDrive: { enabled: false },
      } as unknown as SystemSettings;
      const next = withActiveCloudProvider(active, 'webdav');
      expect(next.webdav.syncBooks).toBe(false);
    });

    test('deactivating a provider leaves its syncBooks untouched', () => {
      const active = {
        webdav: { enabled: true, syncBooks: true },
        googleDrive: { enabled: false, syncBooks: false },
      } as unknown as SystemSettings;
      const next = withActiveCloudProvider(active, null);
      expect(next.webdav.syncBooks).toBe(true);
    });

    test('fresh WebDAV connect flow (builder + activation) auto-enables syncBooks', () => {
      // Regression: the builder must not pre-set `enabled`, or the
      // activation never sees a disabled -> enabled transition and the
      // most common path keeps the books-backed-up-nowhere default.
      const previous = { enabled: false, syncBooks: false } as WebDAVSettings;
      const connected = {
        webdav: buildWebDAVConnectSettings(previous, {
          serverUrl: 'https://dav.example.com',
          username: 'alice',
          password: 'hunter2',
          rootPath: '/Readest',
        }),
        googleDrive: { enabled: false },
      } as unknown as SystemSettings;
      const next = withActiveCloudProvider(connected, 'webdav');
      expect(next.webdav.enabled).toBe(true);
      expect(next.webdav.syncBooks).toBe(true);
    });
  });

  describe('providerSelectedAt stamp (mixed-fleet detection anchor)', () => {
    const inactive = {
      webdav: { enabled: false },
      googleDrive: { enabled: false },
    } as unknown as SystemSettings;

    test('stamps the newly-activated provider only', () => {
      const next = withActiveCloudProvider(inactive, 'webdav');
      expect(typeof next.webdav.providerSelectedAt).toBe('number');
      expect(next.webdav.providerSelectedAt!).toBeGreaterThan(0);
      expect(next.googleDrive.providerSelectedAt).toBeUndefined();
    });

    test('does not re-stamp an already-active provider', () => {
      const active = {
        webdav: { enabled: true, providerSelectedAt: 111 },
        googleDrive: { enabled: false },
      } as unknown as SystemSettings;
      expect(withActiveCloudProvider(active, 'webdav').webdav.providerSelectedAt).toBe(111);
    });

    test('deactivation leaves the stamp untouched', () => {
      const active = {
        webdav: { enabled: true, providerSelectedAt: 111 },
        googleDrive: { enabled: false },
      } as unknown as SystemSettings;
      expect(withActiveCloudProvider(active, null).webdav.providerSelectedAt).toBe(111);
    });
  });
});

describe('isCloudSyncInPlan', () => {
  test('any paid plan can use cloud sync', () => {
    expect(isCloudSyncInPlan('plus')).toBe(true);
    expect(isCloudSyncInPlan('pro')).toBe(true);
    expect(isCloudSyncInPlan('purchase')).toBe(true); // lifetime
  });

  test('free plan cannot', () => {
    expect(isCloudSyncInPlan('free')).toBe(false);
  });
});

describe('isCloudSyncAllowed (premium paywall)', () => {
  test('third-party cloud sync requires a paid plan', () => {
    expect(CLOUD_SYNC_REQUIRES_PREMIUM).toBe(true);
    expect(isCloudSyncAllowed('free')).toBe(false);
    expect(isCloudSyncAllowed('plus')).toBe(true);
    expect(isCloudSyncAllowed('pro')).toBe(true);
    expect(isCloudSyncAllowed('purchase')).toBe(true);
  });
});

describe('withCloudProviderEnabled', () => {
  const both = {
    webdav: {
      enabled: true,
      serverUrl: 'https://dav',
      username: 'u',
      password: 'p',
      rootPath: '/',
    },
    googleDrive: { enabled: false, accountLabel: 'a@b.com' },
    s3: { enabled: false },
    onedrive: { enabled: false },
  } as unknown as SystemSettings;

  test('enabling one provider leaves the others alone', () => {
    const next = withCloudProviderEnabled(both, 'gdrive', true);
    expect(next.googleDrive.enabled).toBe(true);
    expect(next.webdav.enabled).toBe(true);
  });

  test('activation stamps syncBooks and providerSelectedAt on the off-to-on edge only', () => {
    const next = withCloudProviderEnabled(both, 'gdrive', true);
    expect(next.googleDrive.syncBooks).toBe(true);
    expect(next.googleDrive.providerSelectedAt).toBeTruthy();

    // An explicit opt-out survives a redundant re-activation.
    const optedOut = {
      ...next,
      googleDrive: { ...next.googleDrive, syncBooks: false },
    } as SystemSettings;
    const again = withCloudProviderEnabled(optedOut, 'gdrive', true);
    expect(again.googleDrive.syncBooks).toBe(false);
  });

  test('disabling a provider keeps its config so reconnecting is one click', () => {
    const next = withCloudProviderEnabled(both, 'webdav', false);
    expect(next.webdav.enabled).toBe(false);
    expect(next.webdav.serverUrl).toBe('https://dav');
    expect(next.webdav.password).toBe('p');
  });

  test('turning Readest Cloud off writes an explicit false and stamps disabledAt', () => {
    const next = withCloudProviderEnabled(both, 'readest', false);
    expect(next.readestCloud?.enabled).toBe(false);
    expect(next.readestCloud?.disabledAt).toBeTruthy();
    expect(next.webdav.enabled).toBe(true);
  });

  test('turning Readest Cloud on writes an explicit true and clears disabledAt', () => {
    const off = withCloudProviderEnabled(both, 'readest', false);
    const on = withCloudProviderEnabled(off, 'readest', true);
    expect(on.readestCloud?.enabled).toBe(true);
    expect(on.readestCloud?.disabledAt).toBeUndefined();
  });

  test('every provider can be off at once', () => {
    let next = withCloudProviderEnabled(both, 'webdav', false);
    next = withCloudProviderEnabled(next, 'readest', false);
    expect(next.webdav.enabled).toBe(false);
    expect(next.readestCloud?.enabled).toBe(false);
  });
});

// The single write path for provider selection once #5062's Task 14 removes
// `persistActiveCloudProvider` — every side effect below must survive a
// future refactor of this 5-line orchestrator.
describe('persistCloudProviderEnabled', () => {
  beforeEach(() => {
    useSettingsStore.setState({ settings: {} as SystemSettings });
    mockBroadcastGlobalSettings.mockClear();
  });

  const makeEnvConfig = (
    saveSettings: (settings: SystemSettings) => Promise<void>,
    loadSettings?: () => Promise<SystemSettings>,
  ): EnvConfigType =>
    ({
      getAppService: vi.fn().mockResolvedValue({ saveSettings, loadSettings }),
    }) as unknown as EnvConfigType;

  test('hydrates the store, persists, and broadcasts with the provider flags included', async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const envConfig = makeEnvConfig(saveSettings);
    useSettingsStore.setState({
      settings: { version: 1, webdav: { enabled: false } } as unknown as SystemSettings,
    });

    const next = await persistCloudProviderEnabled(envConfig, 'gdrive', true);

    expect(useSettingsStore.getState().settings.googleDrive.enabled).toBe(true);
    expect(saveSettings).toHaveBeenCalledWith(next);
    expect(mockBroadcastGlobalSettings).toHaveBeenCalledWith(next, {
      includeCloudSyncProviders: true,
    });
  });

  test('loads settings from the app service when the store was never hydrated (OAuth callback route)', async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const loadSettings = vi
      .fn()
      .mockResolvedValue({ version: 1, webdav: { enabled: false } } as unknown as SystemSettings);
    const envConfig = makeEnvConfig(saveSettings, loadSettings);
    // Store starts unhydrated, as on a route that never loaded settings.
    useSettingsStore.setState({ settings: {} as SystemSettings });

    const next = await persistCloudProviderEnabled(envConfig, 'webdav', true);

    expect(loadSettings).toHaveBeenCalled();
    expect(useSettingsStore.getState().settings.webdav.enabled).toBe(true);
    expect(saveSettings).toHaveBeenCalledWith(next);
    expect(mockBroadcastGlobalSettings).toHaveBeenCalledWith(next, {
      includeCloudSyncProviders: true,
    });
  });

  test('mutate runs before the toggle, so a connect flow supplying credentials still activates syncBooks', async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const envConfig = makeEnvConfig(saveSettings);
    useSettingsStore.setState({
      settings: {
        version: 1,
        webdav: { enabled: false, syncBooks: false },
      } as unknown as SystemSettings,
    });

    const next = await persistCloudProviderEnabled(envConfig, 'webdav', true, (settings) => ({
      ...settings,
      webdav: {
        ...(settings as unknown as { webdav: WebDAVSettings }).webdav,
        serverUrl: 'https://dav.example.com',
        username: 'alice',
        password: 'hunter2',
        rootPath: '/Readest',
      },
    }));

    // The credentials from `mutate` made it through...
    expect(next.webdav.serverUrl).toBe('https://dav.example.com');
    expect(next.webdav.password).toBe('hunter2');
    // ...and because `mutate` didn't pre-set `enabled`, the toggle still saw
    // an off -> on edge and ran the activation side effects.
    expect(next.webdav.enabled).toBe(true);
    expect(next.webdav.syncBooks).toBe(true);
    expect(next.webdav.providerSelectedAt).toBeTruthy();
  });
});
