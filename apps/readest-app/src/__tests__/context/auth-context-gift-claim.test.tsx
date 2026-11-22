// @vitest-environment happy-dom
// Signing in claims the gift cards bought for this email, so a new account
// gets its gifted year without waiting for the cron sweep.
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { User } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  claimGiftCards: vi.fn(),
  refreshSession: vi.fn(),
}));

vi.mock('@/utils/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      refreshSession: h.refreshSession,
      signOut: vi.fn().mockResolvedValue(undefined),
    },
  },
}));
vi.mock('posthog-js', () => ({ default: { identify: vi.fn() } }));
vi.mock('@/libs/payment/gift/client', () => ({ claimGiftCards: h.claimGiftCards }));

import { AuthProvider, useAuth } from '@/context/AuthContext';

const user = { id: 'user-1', email: 'sam@example.test', user_metadata: {} } as unknown as User;

const signIn = async () => {
  const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
  // The provider refreshes once on mount; count only what login does.
  await waitFor(() => expect(h.refreshSession).toHaveBeenCalled());
  h.refreshSession.mockClear();
  act(() => result.current.login('token-1', user));
};

beforeEach(() => {
  localStorage.clear();
  h.refreshSession.mockResolvedValue({ data: { session: {} }, error: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('claims gift cards on login and refreshes the session when one was claimed', async () => {
  h.claimGiftCards.mockResolvedValue(1);
  await signIn();

  await waitFor(() => expect(h.claimGiftCards).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(h.refreshSession).toHaveBeenCalledTimes(1));
});

it('does not refresh when nothing was claimed', async () => {
  h.claimGiftCards.mockResolvedValue(0);
  await signIn();

  await waitFor(() => expect(h.claimGiftCards).toHaveBeenCalledTimes(1));
  expect(h.refreshSession).not.toHaveBeenCalled();
});

it('logs and swallows a failed claim', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  h.claimGiftCards.mockRejectedValue(new Error('gift_request_failed'));
  await signIn();

  await waitFor(() =>
    expect(consoleError).toHaveBeenCalledWith('Failed to claim gift cards:', expect.any(Error)),
  );
  expect(h.refreshSession).not.toHaveBeenCalled();
  consoleError.mockRestore();
});
