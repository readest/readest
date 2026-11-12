// @vitest-environment happy-dom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/context/AuthContext';

const { refreshSession } = vi.hoisted(() => ({ refreshSession: vi.fn() }));
vi.mock('@/utils/supabase', () => ({
  supabase: {
    auth: {
      refreshSession,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));
vi.mock('posthog-js', () => ({ default: { identify: vi.fn() } }));
afterEach(cleanup);

it.each([
  {
    name: 'success',
    response: { data: { session: { access_token: 'test-token' } }, error: null },
    expected: true,
  },
  {
    name: 'API error',
    response: { data: { session: null }, error: new Error('refresh failed') },
    expected: false,
  },
  { name: 'missing session', response: { data: { session: null }, error: null }, expected: false },
])('reports refresh $name to its caller', async ({ response, expected }) => {
  refreshSession.mockResolvedValue(response);
  const { result } = renderHook(useAuth, { wrapper: AuthProvider });
  expect(await result.current.refresh()).toBe(expected);
});

it('reports a rejected refresh to its caller', async () => {
  refreshSession.mockRejectedValue(new Error('offline'));
  const { result } = renderHook(useAuth, { wrapper: AuthProvider });
  expect(await result.current.refresh()).toBe(false);
});
