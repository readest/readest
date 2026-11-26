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
  isTauri: vi.fn(() => false),
  onOpenUrl: vi.fn(async (_handler: (urls: string[]) => void) => {}),
  onAuthStateChange: undefined as
    | ((
        event: string,
        session: { access_token: string; refresh_token: string; user: object } | null,
      ) => void)
    | undefined,
}));

vi.mock('@/libs/syncDevices', () => ({
  hasDeviceLimit: mocks.hasDeviceLimit,
  checkSignInDeviceLimit: mocks.checkSignInDeviceLimit,
  signOutSyncDevice: mocks.signOutSyncDevice,
}));
vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: mocks.isTauri,
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
      setSession: vi.fn(async () => ({ error: null })),
      getUser: vi.fn(async () => ({ data: { user: {} } })),
      getSession: vi.fn(async () => ({ data: { session: null } })),
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
vi.mock('@tauri-apps/plugin-deep-link', () => ({ onOpenUrl: mocks.onOpenUrl }));
vi.mock('@fabianlars/tauri-plugin-oauth', () => ({
  start: vi.fn(),
  cancel: vi.fn(),
  onUrl: vi.fn(),
  onInvalidUrl: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => 'false') }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ listen: vi.fn() }) }));
vi.mock('@/app/auth/utils/appleIdAuth', () => ({ getAppleIdAuth: vi.fn() }));
vi.mock('@/app/auth/utils/nativeAuth', () => ({
  authWithCustomTab: vi.fn(),
  authWithSafari: vi.fn(),
}));

const signIn = () =>
  act(() =>
    mocks.onAuthStateChange?.('SIGNED_IN', {
      access_token: 'free-token',
      refresh_token: 'free-refresh',
      user: {},
    }),
  );

// The app opens a sign-in link as a deep link (Tauri), handled on this page.
const openDeepLink = async (type: string) => {
  cleanup();
  mocks.isTauri.mockReturnValue(true);
  render(<AuthPage />);
  await waitFor(() => expect(mocks.onOpenUrl).toHaveBeenCalled());
  const token = `${btoa('{"alg":"none"}')}.${btoa('{"sub":"user-1"}')}.sig`;
  const handler = mocks.onOpenUrl.mock.calls[0]![0];
  act(() =>
    handler([`readest://auth-callback#access_token=${token}&refresh_token=r&type=${type}`]),
  );
  signIn();
  await waitFor(() => expect(mocks.checkSignInDeviceLimit).toHaveBeenCalledWith(token));
  await act(async () => {});
};

beforeEach(() => {
  localStorage.clear();
  mocks.isTauri.mockReturnValue(false);
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
    // The app never published the held session, so nothing else stored it,
    // and an offline restart would find no refresh token and sign out.
    expect(localStorage.getItem('refresh_token')).toBe('free-refresh');
  });

  it('signs this device out again on Cancel', async () => {
    signIn();

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(await screen.findByText('sign-in form')).toBeTruthy();
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it('stays signed out when a device sign-out finishes after Cancel', async () => {
    let finish = (_value: unknown) => {};
    mocks.signOutSyncDevice.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    signIn();

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out Chrome on macOS' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(async () => finish({ ...BLOCKED, blocked: false }));

    expect(screen.getByText('sign-in form')).toBeTruthy();
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });

  // A refresh while the list is open starts another check; Cancel ends the
  // session before it answers, even when it answers with an error (null).
  it('drops a device check that answers after Cancel', async () => {
    signIn();
    await screen.findByText('Chrome on macOS');
    let finish = (_value: unknown) => {};
    mocks.checkSignInDeviceLimit.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    act(() =>
      mocks.onAuthStateChange?.('TOKEN_REFRESHED', {
        access_token: 'refreshed-token',
        refresh_token: 'refreshed-refresh',
        user: {},
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(async () => finish(null));

    expect(screen.getByText('sign-in form')).toBeTruthy();
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });

  it('drops a device check when the session ends while it runs', async () => {
    let finish = (_value: unknown) => {};
    mocks.checkSignInDeviceLimit.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    signIn();

    act(() => mocks.onAuthStateChange?.('SIGNED_OUT', null));
    await act(async () => finish(null));

    expect(screen.getByText('sign-in form')).toBeTruthy();
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });

  it('signs in only the newer session when one replaces it during the check', async () => {
    const answers: Record<string, (value: unknown) => void> = {};
    mocks.checkSignInDeviceLimit.mockImplementation(
      (token) => new Promise((resolve) => (answers[token] = resolve)),
    );
    signIn();
    act(() =>
      mocks.onAuthStateChange?.('TOKEN_REFRESHED', {
        access_token: 'refreshed-token',
        refresh_token: 'refreshed-refresh',
        user: {},
      }),
    );

    await act(async () => answers['free-token']!(null));
    expect(mocks.login).not.toHaveBeenCalled();
    await act(async () => answers['refreshed-token']!(null));

    expect(mocks.login).toHaveBeenCalledTimes(1);
    expect(mocks.login).toHaveBeenCalledWith('refreshed-token', {});
  });

  // A token refresh while the list shows uses up the old refresh token.
  it('finishes with the refreshed session when a device is signed out meanwhile', async () => {
    mocks.signOutSyncDevice.mockResolvedValue({ ...BLOCKED, blocked: false });
    signIn();
    await screen.findByText('Chrome on macOS');
    mocks.checkSignInDeviceLimit.mockReturnValue(new Promise(() => {}));
    act(() =>
      mocks.onAuthStateChange?.('TOKEN_REFRESHED', {
        access_token: 'refreshed-token',
        refresh_token: 'refreshed-refresh',
        user: {},
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign out Chrome on macOS' }));

    await waitFor(() => expect(mocks.login).toHaveBeenCalled());
    expect(mocks.login).toHaveBeenCalledWith('refreshed-token', {});
    expect(localStorage.getItem('refresh_token')).toBe('refreshed-refresh');
  });

  // Another tab can sign in a second account while the list shows.
  it('does not sign in another account on a sign-out answered for the first', async () => {
    let finish = (_value: unknown) => {};
    mocks.signOutSyncDevice.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    act(() =>
      mocks.onAuthStateChange?.('SIGNED_IN', {
        access_token: 'a-token',
        refresh_token: 'a-refresh',
        user: { id: 'a' },
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out Chrome on macOS' }));
    mocks.checkSignInDeviceLimit.mockReturnValue(new Promise(() => {}));
    act(() =>
      mocks.onAuthStateChange?.('SIGNED_IN', {
        access_token: 'b-token',
        refresh_token: 'b-refresh',
        user: { id: 'b' },
      }),
    );

    await act(async () => finish({ ...BLOCKED, blocked: false }));

    expect(mocks.signOutSyncDevice).toHaveBeenCalledWith('a-token', 'mac');
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it('abandons a sign-in whose device check is still running on Go Back', async () => {
    let finish = (_value: unknown) => {};
    mocks.checkSignInDeviceLimit.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    signIn();

    fireEvent.click(screen.getAllByRole('button', { name: 'Go Back' })[0]!);
    await waitFor(() => expect(mocks.router.back).toHaveBeenCalledTimes(1));
    await act(async () => finish(null));

    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.router.replace).not.toHaveBeenCalled();
    expect(mocks.router.back).toHaveBeenCalledTimes(1);
  });

  it('signs this device out again when leaving with Go Back', async () => {
    signIn();
    await screen.findByText('Chrome on macOS');

    fireEvent.click(screen.getAllByRole('button', { name: 'Go Back' })[0]!);

    await waitFor(() => expect(mocks.router.back).toHaveBeenCalled());
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it('opens the recovery form once a held password reset link is let in', async () => {
    mocks.signOutSyncDevice.mockResolvedValue({ ...BLOCKED, blocked: false });
    await openDeepLink('recovery');

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out Chrome on macOS' }));

    await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledWith('/auth/recovery'));
    expect(mocks.router.replace).toHaveBeenCalledTimes(1);
  });

  it('forgets a cancelled reset link when signing in again', async () => {
    await openDeepLink('recovery');
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    mocks.checkSignInDeviceLimit.mockResolvedValue(null);

    signIn();

    await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledWith('/library'));
    expect(mocks.router.replace).not.toHaveBeenCalledWith('/auth/recovery');
  });

  it('opens the recovery form when a device is signed out before the link check answers', async () => {
    mocks.checkSignInDeviceLimit.mockImplementation(async (token) =>
      token === 'free-token' ? BLOCKED : new Promise(() => {}),
    );
    mocks.signOutSyncDevice.mockResolvedValue({ ...BLOCKED, blocked: false });
    await openDeepLink('recovery');

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out Chrome on macOS' }));

    await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledWith('/auth/recovery'));
  });

  // The link's own device check runs after the page's, so it can answer
  // after Cancel; a later sign-in must not follow the cancelled link.
  it('forgets a reset link whose device check answers after Cancel', async () => {
    let finish = (_value: unknown) => {};
    const linkCheck = new Promise((resolve) => (finish = resolve));
    mocks.checkSignInDeviceLimit.mockImplementation(async (token) =>
      token === 'free-token' ? BLOCKED : linkCheck,
    );
    await openDeepLink('recovery');
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await act(async () => finish(BLOCKED));
    mocks.checkSignInDeviceLimit.mockResolvedValue(null);

    signIn();

    await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledWith('/library'));
    expect(mocks.router.replace).not.toHaveBeenCalledWith('/auth/recovery');
  });

  // The link's own check fails open, so an error after Cancel answers null.
  it('does not sign in a link whose own check lets it in after Cancel', async () => {
    let finish = (_value: unknown) => {};
    const linkCheck = new Promise((resolve) => (finish = resolve));
    mocks.checkSignInDeviceLimit.mockImplementation(async (token) =>
      token === 'free-token' ? BLOCKED : linkCheck,
    );
    await openDeepLink('recovery');
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await act(async () => finish(null));

    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it('opens the recovery form for a reset link under the limit, as before', async () => {
    mocks.checkSignInDeviceLimit.mockResolvedValue(null);
    await openDeepLink('recovery');

    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith('/auth/recovery'));
    expect(mocks.login).toHaveBeenCalled();
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
