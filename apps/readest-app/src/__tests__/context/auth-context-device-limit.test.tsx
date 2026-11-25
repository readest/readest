// @vitest-environment happy-dom
// A sign-in held at the Free plan's device limit stays out of the app: the
// login page lists the devices, and nothing else may treat the account as
// signed in, now or after a restart, until one of them is signed out.
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

type Listener = (event: string, session: unknown) => void;

const h = vi.hoisted(() => ({
  listener: undefined as Listener | undefined,
  hasDeviceLimit: vi.fn((_token: string) => true),
  fetchSyncDevices: vi.fn(
    async (_token: string): Promise<{ blocked: boolean }> => ({
      blocked: false,
    }),
  ),
  refreshSession: vi.fn(async (): Promise<unknown> => ({ data: { session: null }, error: null })),
}));

vi.mock('@/utils/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (listener: Listener) => {
        h.listener = listener;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      refreshSession: h.refreshSession,
      signOut: vi.fn().mockResolvedValue(undefined),
    },
  },
}));
vi.mock('posthog-js', () => ({ default: { identify: vi.fn() } }));
vi.mock('@/libs/payment/gift/client', () => ({ claimGiftCards: vi.fn().mockResolvedValue(0) }));
vi.mock('@/libs/syncDevices', () => ({
  hasDeviceLimit: h.hasDeviceLimit,
  fetchSyncDevices: h.fetchSyncDevices,
  // As the real one: the devices when held, null when let in or on an error.
  checkSignInDeviceLimit: (token: string) =>
    h.fetchSyncDevices(token).then(
      (response) => (response.blocked ? response : null),
      () => null,
    ),
}));

import { AuthProvider, useAuth } from '@/context/AuthContext';

const user = { id: 'user-1', email: 'sam@example.test', user_metadata: {} };
const session = (token: string) => ({ access_token: token, refresh_token: 'r', user });
const BLOCKED = { devices: [], limit: 3, blocked: true };
const ALLOWED = { devices: [], limit: 3, blocked: false };

const renderAuth = () => renderHook(() => useAuth(), { wrapper: AuthProvider }).result;

beforeEach(() => {
  localStorage.clear();
  h.hasDeviceLimit.mockReturnValue(true);
  h.fetchSyncDevices.mockResolvedValue(ALLOWED);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('keeps a sign-in over the device limit out of the app', async () => {
  h.fetchSyncDevices.mockResolvedValue(BLOCKED);
  const auth = renderAuth();

  act(() => h.listener?.('SIGNED_IN', session('held-token')));

  await waitFor(() => expect(h.fetchSyncDevices).toHaveBeenCalledWith('held-token'));
  await act(async () => {});
  expect(auth.current.token).toBeNull();
  expect(auth.current.user).toBeNull();
  expect(localStorage.getItem('token')).toBeNull();
  expect(localStorage.getItem('user')).toBeNull();
});

// Restarting the app while the device list was open restores the held
// session from the SDK's storage; it must still not count as signed in.
it('keeps a held session out after a restart', async () => {
  h.fetchSyncDevices.mockResolvedValue(BLOCKED);
  const auth = renderAuth();

  act(() => h.listener?.('INITIAL_SESSION', session('held-token')));

  await waitFor(() => expect(h.fetchSyncDevices).toHaveBeenCalledWith('held-token'));
  await act(async () => {});
  expect(auth.current.token).toBeNull();
});

it('signs in once the check lets the device in', async () => {
  const auth = renderAuth();

  act(() => h.listener?.('SIGNED_IN', session('new-token')));

  await waitFor(() => expect(auth.current.token).toBe('new-token'));
  expect(localStorage.getItem('token')).toBe('new-token');
});

// The browser aborts a check still running when the page reloads; taking that
// for an answer let a held sign-in in for good.
it('does not sign in when the device check fails', async () => {
  h.fetchSyncDevices.mockRejectedValue(new TypeError('Failed to fetch'));
  const auth = renderAuth();

  act(() => h.listener?.('SIGNED_IN', session('new-token')));

  await waitFor(() => expect(h.fetchSyncDevices).toHaveBeenCalledWith('new-token'));
  await act(async () => {});
  expect(auth.current.token).toBeNull();
  expect(localStorage.getItem('user')).toBeNull();
});

it('does not check a device that is already signed in', () => {
  localStorage.setItem('user', JSON.stringify(user));
  const auth = renderAuth();

  act(() => h.listener?.('TOKEN_REFRESHED', session('refreshed-token')));

  expect(auth.current.token).toBe('refreshed-token');
  expect(h.fetchSyncDevices).not.toHaveBeenCalled();
});

it('does not sign in when the session ended while the check ran', async () => {
  let finish = (_value: { blocked: boolean }) => {};
  h.fetchSyncDevices.mockReturnValue(new Promise((resolve) => (finish = resolve)));
  const auth = renderAuth();

  act(() => h.listener?.('SIGNED_IN', session('new-token')));
  act(() => h.listener?.('SIGNED_OUT', null));
  await act(async () => finish(ALLOWED));

  expect(auth.current.token).toBeNull();
  expect(localStorage.getItem('token')).toBeNull();
});

// Sign Out clears the app at once and then waits on the network; a device
// check answering meanwhile must not sign the user back in.
it('does not sign in when the device check answers during Sign Out', async () => {
  let finishCheck = (_value: { blocked: boolean }) => {};
  h.fetchSyncDevices.mockReturnValue(new Promise((resolve) => (finishCheck = resolve)));
  const auth = renderAuth();
  await act(async () => {});

  act(() => h.listener?.('SIGNED_IN', session('new-token')));
  let finishRefresh = (_value: unknown) => {};
  h.refreshSession.mockReturnValue(new Promise((resolve) => (finishRefresh = resolve)));
  let loggingOut: Promise<void> = Promise.resolve();
  act(() => {
    loggingOut = Promise.resolve(auth.current.logout());
  });
  await act(async () => finishCheck(ALLOWED));

  expect(auth.current.token).toBeNull();
  expect(localStorage.getItem('token')).toBeNull();
  await act(async () => {
    finishRefresh({ data: { session: null }, error: null });
    await loggingOut;
  });
});
