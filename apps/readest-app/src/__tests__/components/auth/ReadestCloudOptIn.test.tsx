import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { SystemSettings } from '@/types/settings';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * #6010: signing in used to start a Readest Cloud upload before the user had
 * seen a single sync option. Third-party backends need premium, premium needs
 * an account, so at the moment of sign-in there is by construction no
 * third-party provider — `isReadestCloudEnabled` derives ON and
 * `useBooksSync`'s `user` effect fires. This opt-in puts the decision on the
 * sign-in page itself.
 *
 * It writes through the moment it is toggled rather than on submit: the choice
 * has to survive an OAuth redirect and a magic-link round-trip, and it has to
 * be on disk before /library mounts.
 */

const saveSettings = vi.fn(async () => {});
// useEnsureSettingsLoaded reads through this when the store is unhydrated.
const loadSettings = vi.fn(async () => useSettingsStore.getState().settings);

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: { getAppService: async () => ({ saveSettings, loadSettings }) },
    appService: null,
  }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/utils/settingsSync', () => ({
  broadcastGlobalSettings: vi.fn(),
}));

import ReadestCloudOptIn from '@/app/auth/components/ReadestCloudOptIn';

/** A fresh install: no explicit flag, no third-party backend. */
const freshInstall = {
  version: 1,
  webdav: { enabled: false },
  googleDrive: { enabled: false },
} as unknown as SystemSettings;

const withWebDAV = {
  version: 1,
  webdav: { enabled: true, serverUrl: 'https://dav.example.com', username: 'alice' },
  googleDrive: { enabled: false },
} as unknown as SystemSettings;

const box = () => screen.getByRole('checkbox') as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('ReadestCloudOptIn', () => {
  test('renders nothing until the settings store is hydrated', () => {
    // A cold /auth load leaves the store empty, and isReadestCloudEnabled
    // derives ON from `{}` — showing a checked box over a stored opt-out.
    useSettingsStore.setState({ settings: {} as SystemSettings } as never);
    render(<ReadestCloudOptIn />);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  test('reflects a stored opt-out rather than the empty-object default', () => {
    useSettingsStore.setState({
      settings: {
        ...freshInstall,
        readestCloud: { enabled: false, disabledAt: 1_700_000_000_000 },
      } as unknown as SystemSettings,
    } as never);
    render(<ReadestCloudOptIn />);
    expect(box().checked).toBe(false);
  });

  test('starts checked on a fresh install, matching the derived default', () => {
    useSettingsStore.setState({ settings: freshInstall } as never);
    render(<ReadestCloudOptIn />);
    expect(box().checked).toBe(true);
  });

  test('unchecking writes the same explicit opt-out the Integrations checkbox does', async () => {
    useSettingsStore.setState({ settings: freshInstall } as never);
    render(<ReadestCloudOptIn />);

    fireEvent.click(box());

    await waitFor(() => {
      expect(useSettingsStore.getState().settings.readestCloud?.enabled).toBe(false);
    });
    expect(useSettingsStore.getState().settings.readestCloud?.disabledAt).toBeTruthy();
    expect(saveSettings).toHaveBeenCalled();
    expect(box().checked).toBe(false);
  });

  test('re-checking clears the flag instead of pinning it to true', async () => {
    useSettingsStore.setState({ settings: freshInstall } as never);
    render(<ReadestCloudOptIn />);

    fireEvent.click(box());
    await waitFor(() => {
      expect(useSettingsStore.getState().settings.readestCloud?.enabled).toBe(false);
    });
    fireEvent.click(box());

    // An explicit `true` here would retire the `?? !hasAnyThirdPartyEnabled`
    // fallback, so enabling WebDAV later would leave Readest Cloud on and the
    // library would upload to both.
    await waitFor(() => {
      expect(useSettingsStore.getState().settings.readestCloud?.enabled).toBeUndefined();
    });
    expect(useSettingsStore.getState().settings.readestCloud?.disabledAt).toBeUndefined();
    expect(box().checked).toBe(true);
  });

  test('shows the derived off state when a third-party backend already syncs, and pins true when checked', async () => {
    useSettingsStore.setState({ settings: withWebDAV } as never);
    render(<ReadestCloudOptIn />);

    // Derivation says off while WebDAV owns the library channels.
    expect(box().checked).toBe(false);

    fireEvent.click(box());

    // Clearing the flag would derive back to off, so this one has to be explicit.
    await waitFor(() => {
      expect(useSettingsStore.getState().settings.readestCloud?.enabled).toBe(true);
    });
    expect(box().checked).toBe(true);
  });
});
