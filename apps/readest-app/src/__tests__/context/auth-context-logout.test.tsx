import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { authFetch } = vi.hoisted(() => ({ authFetch: vi.fn<typeof fetch>() }));

// Keep the real SDK: the regression is the scope sent to the auth server,
// together with the SIGNED_OUT event that clears the app's local session.
vi.mock('@/utils/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return {
    supabase: createClient('https://auth.example.test', 'test-anon-key', {
      global: { fetch: authFetch },
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: 'logout-test-session',
      },
    }),
  };
});

vi.mock('posthog-js', () => ({ default: { identify: vi.fn() } }));

import { AuthProvider, useAuth } from '@/context/AuthContext';
import { supabase } from '@/utils/supabase';

const user = {
  id: '00000000-0000-0000-0000-000000000001',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'reader@example.test',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
};

beforeEach(async () => {
  localStorage.clear();
  authFetch.mockReset();
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const accessToken = [
    btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    btoa(JSON.stringify({ sub: user.id, exp: expiresAt })),
    btoa('test-signature'),
  ].join('.');
  authFetch.mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/token') {
      return Response.json({
        access_token: accessToken,
        refresh_token: 'test-refresh-token',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: expiresAt,
        user,
      });
    }
    if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
    throw new Error(`Unexpected auth request: ${url.pathname}`);
  });
  const { error } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: 'test-password',
  });
  expect(error).toBeNull();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('AuthContext logout', () => {
  it('revokes only the current session and clears the local SDK and app state', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.user?.id).toBe(user.id));
    expect(localStorage.getItem('refresh_token')).toBe('test-refresh-token');

    await act(async () => {
      await result.current.logout();
    });

    const requests = authFetch.mock.calls.filter(
      ([input]) => new URL(String(input)).pathname === '/auth/v1/logout',
    );
    expect(requests).toHaveLength(1);
    expect(new URL(String(requests[0]![0])).searchParams.get('scope')).toBe('local');
    expect(requests[0]![1]?.method).toBe('POST');
    expect((await supabase.auth.getSession()).data.session).toBeNull();
    expect(result.current.token).toBeNull();
    expect(result.current.user).toBeNull();
    for (const key of ['token', 'refresh_token', 'user', 'logout-test-session']) {
      expect(localStorage.getItem(key), key).toBeNull();
    }
  });
});
