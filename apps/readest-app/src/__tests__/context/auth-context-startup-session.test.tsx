// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { authFetch } = vi.hoisted(() => ({ authFetch: vi.fn<typeof fetch>() }));

// Keep the real SDK: the regression is the app's reaction to the null
// INITIAL_SESSION the client emits when its own stored session is gone at
// startup, together with the refresh the app then attempts.
vi.mock('@/utils/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return {
    supabase: createClient('https://auth.example.test', 'test-anon-key', {
      global: { fetch: authFetch },
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: 'startup-test-session',
      },
    }),
  };
});

vi.mock('posthog-js', () => ({ default: { identify: vi.fn() } }));

import { AuthProvider, useAuth } from '@/context/AuthContext';

const user = {
  id: '00000000-0000-0000-0000-000000000001',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'reader@example.test',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
};

const expiresAt = Math.floor(Date.now() / 1000) + 3600;

function sessionResponse(accessToken: string, refreshToken: string) {
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    user,
  };
}

// Seed the app's own stored credentials (what a previous sign-in left behind)
// while the SDK's own stored session is gone, as after a failed startup
// refresh on Windows/WebView2. The provider then receives a null
// INITIAL_SESSION while the app still holds a refresh token.
function seedAppSession(accessToken = 'access-token-a', refreshToken = 'refresh-token-a') {
  localStorage.setItem('token', accessToken);
  localStorage.setItem('refresh_token', refreshToken);
  localStorage.setItem('user', JSON.stringify(user));
}

function refreshRequests() {
  return authFetch.mock.calls.filter(([input]) => {
    const url = new URL(String(input));
    return (
      url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token'
    );
  });
}

beforeEach(() => {
  localStorage.clear();
  authFetch.mockReset();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('AuthContext startup session restore', () => {
  it('restores the session from the stored refresh token instead of signing out', async () => {
    seedAppSession();
    authFetch.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/auth/v1/token') {
        return Response.json(sessionResponse('access-token-b', 'refresh-token-b'));
      }
      throw new Error(`Unexpected auth request: ${url.pathname}`);
    });

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    // The provider starts with the stored access token.
    expect(result.current.token).toBe('access-token-a');
    await waitFor(() => expect(result.current.token).toBe('access-token-b'));
    expect(result.current.user?.id).toBe(user.id);
    expect(localStorage.getItem('token')).toBe('access-token-b');
    expect(localStorage.getItem('refresh_token')).toBe('refresh-token-b');
    expect(localStorage.getItem('user')).toBe(JSON.stringify(user));
    expect(refreshRequests()).toHaveLength(1);
    const body = refreshRequests()[0]![1]?.body;
    expect(typeof body === 'string' ? body : '').toContain('refresh-token-a');
  });

  it('signs out only when the stored refresh token is definitively invalid', async () => {
    seedAppSession();
    authFetch.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/auth/v1/token') {
        return Response.json(
          {
            error: 'invalid_grant',
            error_description: 'Invalid Refresh Token: Refresh Token Not Found',
          },
          { status: 400 },
        );
      }
      throw new Error(`Unexpected auth request: ${url.pathname}`);
    });

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    await waitFor(() => expect(result.current.token).toBeNull());
    expect(result.current.user).toBeNull();
    for (const key of ['token', 'refresh_token', 'user']) {
      expect(localStorage.getItem(key), key).toBeNull();
    }
    expect(refreshRequests()).toHaveLength(1);
  });

  it('keeps the stored session when the restore fails with a transient network error', async () => {
    seedAppSession();
    authFetch.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/auth/v1/token') {
        throw new TypeError('Failed to fetch');
      }
      throw new Error(`Unexpected auth request: ${url.pathname}`);
    });

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    // Give the async restore attempt time to run and settle.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(result.current.token).toBe('access-token-a');
    expect(result.current.user?.id).toBe(user.id);
    expect(localStorage.getItem('token')).toBe('access-token-a');
    expect(localStorage.getItem('refresh_token')).toBe('refresh-token-a');
    expect(refreshRequests()).toHaveLength(1);
  });

  it('signs out when there is no stored session to restore', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    await waitFor(() => expect(result.current.token).toBeNull());
    expect(result.current.user).toBeNull();
  });
});
