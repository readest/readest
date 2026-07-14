import { describe, expect, test, vi, beforeEach } from 'vitest';

vi.mock('@/utils/settingsSync', () => ({
  broadcastGlobalSettings: vi.fn(),
}));

import {
  persistCloudProviderEnabled,
  withCloudProviderEnabled,
} from '@/services/sync/cloudSyncActivation';
import { useSettingsStore } from '@/store/settingsStore';
import { broadcastGlobalSettings } from '@/utils/settingsSync';
import { CLOUD_SYNC_REQUIRES_PREMIUM, isCloudSyncAllowed, isCloudSyncInPlan } from '@/utils/access';
import type { SystemSettings } from '@/types/settings';
import type { EnvConfigType } from '@/services/environment';

const mockBroadcastGlobalSettings = vi.mocked(broadcastGlobalSettings);

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

// The single write path for provider selection (#5062) — every side effect
// below must survive a future refactor of this 5-line orchestrator.
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

    // mutate sets syncBooks: false on a disabled provider. If the toggle runs
    // first (wrong order), it would set syncBooks: true, then mutate would
    // override it to false, and this assertion would fail. Correct order
    // (mutate then toggle) ensures the off-to-on edge fires after mutate,
    // so the toggle's syncBooks: true wins.
    const next = await persistCloudProviderEnabled(envConfig, 'webdav', true, (settings) => ({
      ...settings,
      webdav: {
        ...settings.webdav,
        serverUrl: 'https://dav.example.com',
        username: 'alice',
        password: 'hunter2',
        rootPath: '/Readest',
        syncBooks: false,
      },
    }));

    // The credentials from `mutate` made it through...
    expect(next.webdav.serverUrl).toBe('https://dav.example.com');
    expect(next.webdav.password).toBe('hunter2');
    // ...and because `mutate` didn't pre-set `enabled`, the toggle still saw
    // an off -> on edge and ran the activation side effects, overwriting
    // mutate's syncBooks: false with syncBooks: true.
    expect(next.webdav.enabled).toBe(true);
    expect(next.webdav.syncBooks).toBe(true);
    expect(next.webdav.providerSelectedAt).toBeTruthy();
  });
});
