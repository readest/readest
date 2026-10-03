import { describe, expect, test, vi, beforeEach } from 'vitest';

vi.mock('@/utils/settingsSync', () => ({
  broadcastGlobalSettings: vi.fn(),
}));

import {
  persistCloudProviderEnabled,
  persistReadestCloudChoice,
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
    expect(isCloudSyncInPlan('plus', false)).toBe(true);
    expect(isCloudSyncInPlan('pro', false)).toBe(true);
    // A storage-only buyer reports `purchase` without being entitled.
    expect(isCloudSyncInPlan('purchase', false)).toBe(false);
  });

  test('free plan cannot', () => {
    expect(isCloudSyncInPlan('free', false)).toBe(false);
  });
});

describe('isCloudSyncAllowed (premium paywall)', () => {
  test('third-party cloud sync requires a paid plan', () => {
    expect(CLOUD_SYNC_REQUIRES_PREMIUM).toBe(true);
    expect(isCloudSyncAllowed('free', false)).toBe(false);
    expect(isCloudSyncAllowed('plus', false)).toBe(true);
    expect(isCloudSyncAllowed('pro', false)).toBe(true);
    expect(isCloudSyncAllowed('purchase', false)).toBe(false);
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

  test('reconnecting a provider selected here before keeps its syncBooks opt-out', () => {
    // #6010: Disconnect only writes `enabled: false`, so `providerSelectedAt`
    // and the sub-toggles survive it. The reconnect's off -> on edge must not
    // resurrect the "mirror my library here" default over a deliberate opt-out
    // — buildWebDAVConnectSettings preserves syncBooks precisely so that a
    // reconnect is not a reset.
    const reconnecting = {
      ...both,
      googleDrive: {
        enabled: false,
        accountLabel: 'a@b.com',
        syncBooks: false,
        providerSelectedAt: 1_700_000_000_000,
      },
    } as unknown as SystemSettings;

    const next = withCloudProviderEnabled(reconnecting, 'gdrive', true);

    expect(next.googleDrive.enabled).toBe(true);
    expect(next.googleDrive.syncBooks).toBe(false);
    // The stamp still tracks the most recent selection on this device.
    expect(next.googleDrive.providerSelectedAt).toBeGreaterThan(1_700_000_000_000);
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

/**
 * The Readest Cloud opt-in on the sign-in page (#6010) needs a third state
 * that `persistCloudProviderEnabled` cannot express: clearing the flag back to
 * `undefined`. That `undefined` is load-bearing — `isReadestCloudEnabled`
 * derives from it, which is what makes enabling WebDAV later switch Readest
 * Cloud off instead of uploading the library to both.
 */
describe('persistReadestCloudChoice', () => {
  beforeEach(() => {
    useSettingsStore.setState({ settings: {} as SystemSettings });
    mockBroadcastGlobalSettings.mockClear();
  });

  const makeEnvConfig = (
    saveSettings: (settings: SystemSettings) => Promise<void>,
  ): EnvConfigType =>
    ({
      getAppService: vi.fn().mockResolvedValue({ saveSettings }),
    }) as unknown as EnvConfigType;

  test('false writes an explicit opt-out and stamps disabledAt', async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    useSettingsStore.setState({ settings: { version: 1 } as unknown as SystemSettings });

    const next = await persistReadestCloudChoice(makeEnvConfig(saveSettings), false);

    expect(next.readestCloud?.enabled).toBe(false);
    expect(next.readestCloud?.disabledAt).toBeTruthy();
    expect(saveSettings).toHaveBeenCalledWith(next);
    expect(mockBroadcastGlobalSettings).toHaveBeenCalledWith(next, {
      includeCloudSyncProviders: true,
    });
  });

  test('undefined clears the flag so the derived fallback applies again', async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const envConfig = makeEnvConfig(saveSettings);
    useSettingsStore.setState({ settings: { version: 1 } as unknown as SystemSettings });

    await persistReadestCloudChoice(envConfig, false);
    const restored = await persistReadestCloudChoice(envConfig, undefined);

    expect(restored.readestCloud?.enabled).toBeUndefined();
    // disabledAt anchors the mixed-fleet probe for a device that stopped
    // writing native rows; a device back on the derived default never did.
    expect(restored.readestCloud?.disabledAt).toBeUndefined();
    expect(useSettingsStore.getState().settings.readestCloud?.enabled).toBeUndefined();
  });

  test('true writes an explicit opt-in and clears disabledAt', async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const envConfig = makeEnvConfig(saveSettings);
    useSettingsStore.setState({ settings: { version: 1 } as unknown as SystemSettings });

    await persistReadestCloudChoice(envConfig, false);
    const next = await persistReadestCloudChoice(envConfig, true);

    expect(next.readestCloud?.enabled).toBe(true);
    expect(next.readestCloud?.disabledAt).toBeUndefined();
  });
});

// Premium is now the plan OR an outright Full Customization purchase.
describe('isCloudSyncAllowed — customization unlock', () => {
  test('entitles a free user who bought Full Customization', () => {
    expect(isCloudSyncAllowed('free', true)).toBe(true);
  });

  test('entitles a grandfathered storage buyer, who carries the flag', () => {
    expect(isCloudSyncAllowed('purchase', true)).toBe(true);
  });

  test('does not entitle a storage-only buyer after the grace period', () => {
    expect(isCloudSyncAllowed('purchase', false)).toBe(false);
  });
});
