import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

vi.mock('@/utils/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      refreshSession: vi.fn().mockResolvedValue(undefined),
      signOut: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

vi.mock('posthog-js', () => ({
  default: { identify: vi.fn() },
}));

import { AuthProvider, useAuth } from '@/context/AuthContext';

describe('AuthContext memoization', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.clear();
    }
  });

  afterEach(() => {
    cleanup();
  });

  test('returns the same context value reference when parent re-renders without state change', () => {
    const captured: ReturnType<typeof useAuth>[] = [];

    function Probe() {
      const value = useAuth();
      captured.push(value);
      return null;
    }

    function Wrapper({ tick }: { tick: number }) {
      // The tick prop forces a parent re-render but does not change AuthProvider state
      return (
        <AuthProvider>
          <span data-tick={tick} />
          <Probe />
        </AuthProvider>
      );
    }

    const { rerender } = render(<Wrapper tick={0} />);
    act(() => {
      rerender(<Wrapper tick={1} />);
    });
    act(() => {
      rerender(<Wrapper tick={2} />);
    });

    // Probe captures one value per render. We expect at least 3 captures.
    expect(captured.length).toBeGreaterThanOrEqual(3);

    // The first capture happens during initial mount (state may settle async),
    // but subsequent captures from parent-only re-renders should reuse the same
    // memoized context value reference. If login/logout/refresh are not stable
    // (no useCallback), useMemo's deps change every render and produce a fresh
    // object each time — this assertion catches that regression.
    const firstStable = captured[captured.length - 2]!;
    const secondStable = captured[captured.length - 1]!;
    expect(secondStable).toBe(firstStable);
  });

  test('login/logout/refresh callbacks are stable across re-renders', () => {
    const captured: ReturnType<typeof useAuth>[] = [];

    function Probe() {
      const value = useAuth();
      captured.push(value);
      return null;
    }

    function Wrapper({ tick }: { tick: number }) {
      return (
        <AuthProvider>
          <span data-tick={tick} />
          <Probe />
        </AuthProvider>
      );
    }

    const { rerender } = render(<Wrapper tick={0} />);
    act(() => {
      rerender(<Wrapper tick={1} />);
    });

    const last = captured[captured.length - 1]!;
    const prev = captured[captured.length - 2]!;
    expect(last.login).toBe(prev.login);
    expect(last.logout).toBe(prev.logout);
    expect(last.refresh).toBe(prev.refresh);
  });
});
