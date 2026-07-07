import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAppRouter } from '@/hooks/useAppRouter';

const transitionRouter = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };
const plainRouter = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };

vi.mock('next-view-transitions', () => ({
  useTransitionRouter: () => transitionRouter,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => plainRouter,
}));

const useEnvMock = vi.fn();
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => useEnvMock(),
}));

afterEach(() => {
  useEnvMock.mockReset();
});

describe('useAppRouter', () => {
  it('routes through the View Transition router when the engine has the API', () => {
    useEnvMock.mockReturnValue({ appService: { supportsViewTransitionsAPI: true } });
    const { result } = renderHook(() => useAppRouter());
    expect(result.current).toBe(transitionRouter);
  });

  it('falls back to the plain router when the engine lacks the View Transitions API', () => {
    useEnvMock.mockReturnValue({ appService: { supportsViewTransitionsAPI: false } });
    const { result } = renderHook(() => useAppRouter());
    expect(result.current).toBe(plainRouter);
  });

  it('falls back to the plain router before the app service is ready', () => {
    useEnvMock.mockReturnValue({ appService: null });
    const { result } = renderHook(() => useAppRouter());
    expect(result.current).toBe(plainRouter);
  });
});
