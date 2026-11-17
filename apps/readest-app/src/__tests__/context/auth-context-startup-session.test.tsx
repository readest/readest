// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { authFetch, app } = vi.hoisted(() => ({
  authFetch: vi.fn<typeof fetch>(),
  app: { client: null as SupabaseClient | null },
}));

// Keep the real SDK: the bug is how the app reacts to what the client reports
// at startup. Each test creates its client after seeding storage, so the
// client's own startup refresh runs on that storage as it does in the app.
vi.mock('@/utils/supabase', () => ({
  get supabase() {
    return app.client;
  },
}));

vi.mock('posthog-js', () => ({ default: { identify: vi.fn() } }));

import { AuthProvider, useAuth } from '@/context/AuthContext';

// Each test's client has its own storage key, and so its own lock: a client
// left mid-refresh by a failed test can't block the next one.
let launches = 0;
let SDK_KEY = '';

const user = {
  id: '00000000-0000-0000-0000-000000000001',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'reader@example.test',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
};

function sessionResponse(accessToken: string, refreshToken: string) {
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user,
  };
}

// What a previous sign-in left in the app's own keys.
function seedAppSession() {
  localStorage.setItem('token', 'access-token-a');
  localStorage.setItem('refresh_token', 'refresh-token-a');
  localStorage.setItem('user', JSON.stringify(user));
}

// The SDK's own stored session from that sign-in, already expired, as on a
// launch more than an hour after the last one.
function seedExpiredSdkSession() {
  localStorage.setItem(
    SDK_KEY,
    JSON.stringify({
      ...sessionResponse('access-token-a', 'refresh-token-a'),
      expires_at: Math.floor(Date.now() / 1000) - 60,
    }),
  );
}

function refreshRequests() {
  return authFetch.mock.calls.filter(([input]) => {
    const url = new URL(String(input));
    return (
      url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token'
    );
  });
}

function respondToRefresh(respond: () => Promise<Response>) {
  authFetch.mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/token') return respond();
    throw new Error(`Unexpected auth request: ${url.pathname}`);
  });
}

function launchApp() {
  app.client = createClient('https://auth.example.test', 'test-anon-key', {
    global: { fetch: authFetch },
    auth: { detectSessionInUrl: false, storageKey: SDK_KEY },
  });
  return renderHook(() => useAuth(), { wrapper: AuthProvider });
}

beforeEach(() => {
  launches += 1;
  SDK_KEY = `startup-test-session-${launches}`;
  localStorage.clear();
  authFetch.mockReset();
});

afterEach(async () => {
  cleanup();
  await app.client?.auth.stopAutoRefresh();
  app.client = null;
  vi.useRealTimers();
  localStorage.clear();
});

describe('AuthContext startup session restore', () => {
  it('keeps the user signed in when the network is down at launch, and refreshes once it is back', async () => {
    vi.useFakeTimers();
    seedAppSession();
    seedExpiredSdkSession();
    respondToRefresh(async () => {
      throw new TypeError('Failed to fetch');
    });

    const { result } = launchApp();
    // Run every retry the SDK schedules for the failed refreshes (each gives
    // up after 30 s) before checking what is left.
    await act(() => vi.advanceTimersByTimeAsync(70_000));

    expect(refreshRequests().length).toBeGreaterThan(1);
    expect(result.current.token).toBe('access-token-a');
    expect(result.current.user?.id).toBe(user.id);
    expect(localStorage.getItem('token')).toBe('access-token-a');
    expect(localStorage.getItem('refresh_token')).toBe('refresh-token-a');
    expect(localStorage.getItem(SDK_KEY)).not.toBeNull();

    // The network comes back: the SDK's auto-refresh renews the session.
    respondToRefresh(async () =>
      Response.json(sessionResponse('access-token-b', 'refresh-token-b')),
    );
    await act(() => vi.advanceTimersByTimeAsync(35_000));

    expect(result.current.token).toBe('access-token-b');
    expect(localStorage.getItem('refresh_token')).toBe('refresh-token-b');
  });

  it('signs out when the server rejects the stored refresh token', async () => {
    seedAppSession();
    seedExpiredSdkSession();
    respondToRefresh(async () =>
      Response.json(
        {
          error: 'invalid_grant',
          error_description: 'Invalid Refresh Token: Refresh Token Not Found',
        },
        { status: 400 },
      ),
    );

    const { result } = launchApp();

    await waitFor(() => expect(result.current.token).toBeNull());
    expect(result.current.user).toBeNull();
    for (const key of ['token', 'refresh_token', 'user', SDK_KEY]) {
      expect(localStorage.getItem(key), key).toBeNull();
    }
  });

  // The SDK drops its session when its own startup refresh fails with an
  // error it does not retry (e.g. a 500), before the app subscribes, so the
  // app never sees that SIGNED_OUT. Its stored refresh token can still work.
  it('restores the session from the app refresh token when the SDK has none', async () => {
    seedAppSession();
    respondToRefresh(async () =>
      Response.json(sessionResponse('access-token-b', 'refresh-token-b')),
    );

    const { result } = launchApp();

    expect(result.current.token).toBe('access-token-a');
    await waitFor(() => expect(result.current.token).toBe('access-token-b'));
    expect(result.current.user?.id).toBe(user.id);
    expect(localStorage.getItem('refresh_token')).toBe('refresh-token-b');
    expect(refreshRequests()).toHaveLength(1);
    const body = refreshRequests()[0]![1]?.body;
    expect(typeof body === 'string' ? body : '').toContain('refresh-token-a');
  });

  it('signs out when there is no stored session to restore', async () => {
    const { result } = launchApp();

    await waitFor(() => expect(result.current.token).toBeNull());
    expect(result.current.user).toBeNull();
    expect(refreshRequests()).toHaveLength(0);
  });
});
