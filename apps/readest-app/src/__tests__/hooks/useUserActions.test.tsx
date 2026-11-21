// @vitest-environment happy-dom
// After Sign Out the library opens with the user signed out. It reads
// keepLogin from disk when it opens and sends a signed-out user it is set for
// to the login page, so the library opens only once keepLogin=false is saved.
// The sign-out requests aren't waited for: offline they retry for up to 30 s
// (#7726).
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUserActions } from '@/hooks/useUserActions';

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  finishSave: () => {},
  failSave: (_error: Error) => {},
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({}) }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {}, appService: {} }) }));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    logout: () => {
      mocks.calls.push('sign out');
      return new Promise<void>(() => {});
    },
  }),
}));
vi.mock('@/helpers/settings', () => ({
  saveSysSettings: (_envConfig: unknown, key: string, value: unknown) => {
    mocks.calls.push(`${key}=${value}`);
    return new Promise<void>((resolve, reject) => {
      mocks.finishSave = resolve;
      mocks.failSave = reject;
    });
  },
}));
vi.mock('@/utils/nav', () => ({
  navigateToLibrary: () => mocks.calls.push('open library'),
  navigateToResetPassword: vi.fn(),
  navigateToUpdatePassword: vi.fn(),
}));
vi.mock('@/libs/user', () => ({ deleteUser: vi.fn() }));
vi.mock('@/services/deleteLibraryService', () => ({ deleteAllBooks: vi.fn() }));

afterEach(() => {
  mocks.calls = [];
});

describe('useUserActions sign out', () => {
  it('opens the library once keepLogin=false is saved, without waiting for the network', async () => {
    const { result } = renderHook(() => useUserActions());

    let signingOut: Promise<void> | void;
    act(() => {
      signingOut = result.current.handleLogout();
    });
    expect(mocks.calls).toEqual(['sign out', 'keepLogin=false']);
    expect(result.current.signingOut).toBe(true);

    await act(async () => {
      mocks.finishSave();
      await signingOut;
    });
    expect(mocks.calls).toEqual(['sign out', 'keepLogin=false', 'open library']);
  });

  // A failed write must not leave the profile page on "Loading profile..."
  // with the hand-off to the login page turned off.
  it('opens the library even when saving keepLogin fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useUserActions());

    let signingOut: Promise<void> | void;
    act(() => {
      signingOut = result.current.handleLogout();
    });
    await act(async () => {
      mocks.failSave(new Error('disk full'));
      await Promise.resolve(signingOut).catch(() => {});
    });
    error.mockRestore();
    expect(mocks.calls).toEqual(['sign out', 'keepLogin=false', 'open library']);
  });
});
