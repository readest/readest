// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AuthPage from '@/app/auth/page';

// Leaving the login page must not leave /auth on the history stack: the
// Android back key in the reader goes back through history, and a stranded
// /auth entry reopened the login page on every press (#7567).

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
  viewStates: {} as Record<string, unknown>,
  onAuthStateChange: undefined as
    | ((event: string, session: { access_token: string; user: object } | null) => void)
    | undefined,
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
  getBaseUrl: () => 'https://web.readest.com',
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: { getState: () => ({ viewStates: mocks.viewStates }) },
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ login: vi.fn() }),
}));
vi.mock('@/utils/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (callback: typeof mocks.onAuthStateChange) => {
        mocks.onAuthStateChange = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      signOut: vi.fn(),
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
  useTranslation: () => (key: string) => key,
}));
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));
vi.mock('@/app/auth/components/AuthPanel', () => ({ default: () => null }));
vi.mock('@/components/WindowButtons', () => ({ default: () => null }));
vi.mock('@tauri-apps/plugin-deep-link', () => ({ onOpenUrl: vi.fn() }));
vi.mock('@fabianlars/tauri-plugin-oauth', () => ({
  start: vi.fn(),
  cancel: vi.fn(),
  onUrl: vi.fn(),
  onInvalidUrl: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ listen: vi.fn() }) }));
vi.mock('@/app/auth/utils/appleIdAuth', () => ({ getAppleIdAuth: vi.fn() }));
vi.mock('@/app/auth/utils/nativeAuth', () => ({
  authWithCustomTab: vi.fn(),
  authWithSafari: vi.fn(),
}));

const READER = '/reader?ids=book1';

const openLoginPage = (redirect: string | null) => {
  window.history.replaceState(
    null,
    '',
    redirect ? `/auth?redirect=${encodeURIComponent(redirect)}` : '/auth',
  );
  render(<AuthPage />);
};

const signIn = () =>
  act(() => mocks.onAuthStateChange?.('SIGNED_IN', { access_token: 'token', user: {} }));

beforeEach(() => {
  mocks.viewStates = {};
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AuthPage back arrow', () => {
  it('goes back to the reader beneath when a book is open, leaving no /auth entry', () => {
    mocks.viewStates = { 'book1-abc': {} };
    openLoginPage(READER);

    fireEvent.click(screen.getAllByRole('button', { name: 'Go Back' })[0]!);

    expect(mocks.router.back).toHaveBeenCalledTimes(1);
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });

  it('replaces /auth with the redirect when no book is open beneath', () => {
    openLoginPage(READER);

    fireEvent.click(screen.getAllByRole('button', { name: 'Go Back' })[0]!);

    expect(mocks.router.replace).toHaveBeenCalledWith(READER);
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(mocks.router.back).not.toHaveBeenCalled();
  });
});

describe('AuthPage after signing in', () => {
  it('goes back to the reader beneath when a book is open', () => {
    mocks.viewStates = { 'book1-abc': {} };
    openLoginPage(READER);

    signIn();

    expect(mocks.router.back).toHaveBeenCalledTimes(1);
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });

  it('replaces /auth with the redirect when no book is open beneath', () => {
    openLoginPage(READER);

    signIn();

    expect(mocks.router.replace).toHaveBeenCalledWith(READER);
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it('replaces /auth with the library when there is no redirect', () => {
    mocks.viewStates = { 'book1-abc': {} };
    openLoginPage(null);

    signIn();

    expect(mocks.router.replace).toHaveBeenCalledWith('/library');
    expect(mocks.router.back).not.toHaveBeenCalled();
  });
});
