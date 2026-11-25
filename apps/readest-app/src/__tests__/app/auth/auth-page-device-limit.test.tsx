// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncDevicesResponse } from '@/utils/syncDevices';

import AuthPage from '@/app/auth/page';

// A Free plan syncs on up to three devices. Signing in on a fourth lists the
// other three on the login page, to sign one of them out, before this one is
// signed in.

const BLOCKED: SyncDevicesResponse = {
  limit: 3,
  blocked: true,
  devices: [
    {
      id: 'this',
      client: 'Readest',
      os: 'iPhone',
      lastActiveAt: '2026-11-26T08:00:00Z',
      current: true,
    },
    {
      id: 'mac',
      client: 'Chrome',
      os: 'macOS',
      lastActiveAt: '2026-11-25T08:00:00Z',
      current: false,
    },
    {
      id: 'pixel',
      client: 'Readest',
      os: 'Pixel 7',
      lastActiveAt: '2026-11-24T08:00:00Z',
      current: false,
    },
    { id: 'old', client: null, os: null, lastActiveAt: '2026-01-02T08:00:00Z', current: false },
  ],
};

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
  login: vi.fn(),
  signOut: vi.fn(async (_options?: unknown) => ({ error: null })),
  hasDeviceLimit: vi.fn((_token: string) => true),
  checkSignInDeviceLimit: vi.fn(async (_token: string): Promise<unknown> => null),
  signOutSyncDevice: vi.fn(async (_token: string, _id: string): Promise<unknown> => null),
  onAuthStateChange: undefined as
    | ((event: string, session: { access_token: string; user: object } | null) => void)
    | undefined,
}));

vi.mock('@/libs/syncDevices', () => ({
  hasDeviceLimit: mocks.hasDeviceLimit,
  checkSignInDeviceLimit: mocks.checkSignInDeviceLimit,
  signOutSyncDevice: mocks.signOutSyncDevice,
}));
vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
  getBaseUrl: () => 'https://web.readest.com',
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: { getState: () => ({ viewStates: {} }) },
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ login: mocks.login }),
}));
vi.mock('@/utils/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (callback: typeof mocks.onAuthStateChange) => {
        mocks.onAuthStateChange = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      signOut: mocks.signOut,
    },
  },
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: { getAppService: async () => ({ loadSettings: async () => ({}) }) },
    appService: { isMobileApp: true, isAndroidApp: true },
  }),
}));
vi.mock('@/hooks/useTheme', () => ({ useTheme: vi.fn() }));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 } }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: {}, setSettings: vi.fn(), saveSettings: vi.fn() }),
}));
vi.mock('@/hooks/useEnsureSettingsLoaded', () => ({ useEnsureSettingsLoaded: () => true }));
vi.mock('@/store/trafficLightStore', () => ({
  useTrafficLightStore: () => ({ isTrafficLightVisible: false }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation:
    () =>
    (key: string, options: Record<string, unknown> = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(options[name] ?? '')),
}));
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));
vi.mock('@/app/auth/components/AuthPanel', () => ({ default: () => <p>sign-in form</p> }));
vi.mock('@/components/WindowButtons', () => ({ default: () => null }));
vi.mock('@tauri-apps/plugin-deep-link', () => ({ onOpenUrl: vi.fn() }));
vi.mock('@fabianlars/tauri-plugin-oauth', () => ({
  start: vi.fn(),
  cancel: vi.fn(),
  onUrl: vi.fn(),
  onInvalidUrl: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ listen: vi.fn() }) }));
vi.mock('@/app/auth/utils/appleIdAuth', () => ({ getAppleIdAuth: vi.fn() }));
vi.mock('@/app/auth/utils/nativeAuth', () => ({
  authWithCustomTab: vi.fn(),
  authWithSafari: vi.fn(),
}));

const signIn = () =>
  act(() => mocks.onAuthStateChange?.('SIGNED_IN', { access_token: 'free-token', user: {} }));

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/auth');
  mocks.hasDeviceLimit.mockReturnValue(true);
  mocks.checkSignInDeviceLimit.mockResolvedValue(BLOCKED);
  render(<AuthPage />);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AuthPage over the Free plan device limit', () => {
  it('lists the other devices to sign out instead of signing in', async () => {
    signIn();

    expect(await screen.findByText('Chrome on macOS')).toBeTruthy();
    expect(screen.getByText('Readest on Pixel 7')).toBeTruthy();
    expect(screen.getByText('Unknown device')).toBeTruthy();
    // This device is the one signing in, so it isn't offered.
    expect(screen.queryByText('Readest on iPhone')).toBeNull();
    expect(screen.queryByText('sign-in form')).toBeNull();
    expect(mocks.checkSignInDeviceLimit).toHaveBeenCalledWith('free-token');
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });

  it('finishes signing in once a device is signed out', async () => {
    mocks.signOutSyncDevice.mockResolvedValue({
      ...BLOCKED,
      blocked: false,
      devices: BLOCKED.devices.filter((d) => d.id !== 'mac'),
    });
    signIn();

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out Chrome on macOS' }));

    await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledWith('/library'));
    expect(mocks.signOutSyncDevice).toHaveBeenCalledWith('free-token', 'mac');
    expect(mocks.login).toHaveBeenCalledWith('free-token', {});
  });

  it('signs this device out again on Cancel', async () => {
    signIn();

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(await screen.findByText('sign-in form')).toBeTruthy();
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it('signs this device out again when leaving with Go Back', async () => {
    signIn();
    await screen.findByText('Chrome on macOS');

    fireEvent.click(screen.getAllByRole('button', { name: 'Go Back' })[0]!);

    await waitFor(() => expect(mocks.router.back).toHaveBeenCalled());
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it('signs in at once under the limit', async () => {
    mocks.checkSignInDeviceLimit.mockResolvedValue(null);
    signIn();

    await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledWith('/library'));
    expect(mocks.login).toHaveBeenCalledWith('free-token', {});
  });

  it('signs a paid plan in without asking the server', () => {
    mocks.hasDeviceLimit.mockReturnValue(false);
    signIn();

    expect(mocks.router.replace).toHaveBeenCalledWith('/library');
    expect(mocks.checkSignInDeviceLimit).not.toHaveBeenCalled();
  });
});
