import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { SystemSettings } from '@/types/settings';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * The Readest Cloud opt-in persists asynchronously, and web OAuth leaves the
 * page with a full redirect (`signInWithOAuth` without `skipBrowserRedirect`).
 * Unchecking the box and immediately hitting a provider button could therefore
 * tear down the page mid-write and lose the opt-out — silently reinstating the
 * upload this whole change exists to prevent.
 */

let releaseSave: () => void;
const savePending = () => new Promise<void>((resolve) => (releaseSave = resolve));
const saveSettings = vi.fn(savePending);
const loadSettings = vi.fn(async () => useSettingsStore.getState().settings);

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: { getAppService: async () => ({ saveSettings, loadSettings }) },
    appService: null,
  }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  // Interpolate so the four provider buttons are distinguishable.
  useTranslation: () => (key: string, opts?: Record<string, string>) =>
    opts ? key.replace(/\{\{(\w+)\}\}/g, (_m, name) => opts[name] ?? _m) : key,
}));

vi.mock('@/utils/settingsSync', () => ({
  broadcastGlobalSettings: vi.fn(),
}));

import AuthPanel from '@/app/auth/components/AuthPanel';

const freshInstall = {
  version: 1,
  webdav: { enabled: false },
  googleDrive: { enabled: false },
} as unknown as SystemSettings;

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({ settings: freshInstall } as never);
});

afterEach(() => {
  cleanup();
});

describe('AuthPanel cloud choice vs OAuth redirect', () => {
  test('holds provider sign-in until the opt-out has been written', async () => {
    const onProviderSignIn = vi.fn(async () => {});
    render(
      <AuthPanel
        supabaseClient={{} as never}
        onProviderSignIn={onProviderSignIn}
        magicLink={true}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Sign in with Google/ }));

    // The save has not resolved, so nothing may navigate away yet.
    await Promise.resolve();
    expect(onProviderSignIn).not.toHaveBeenCalled();

    releaseSave();

    await waitFor(() => expect(onProviderSignIn).toHaveBeenCalledTimes(1));
    expect(useSettingsStore.getState().settings.readestCloud?.enabled).toBe(false);
  });

  test('does not delay sign-in when the box was never touched', async () => {
    const onProviderSignIn = vi.fn(async () => {});
    render(
      <AuthPanel
        supabaseClient={{} as never}
        onProviderSignIn={onProviderSignIn}
        magicLink={true}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Sign in with Google/ }));

    await waitFor(() => expect(onProviderSignIn).toHaveBeenCalledTimes(1));
  });
});
