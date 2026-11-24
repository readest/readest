// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AuthPage from '@/app/auth/page';

// Leaving the login page must not leave /auth on the history stack: the
// Android back key in the reader goes back through history, and a stranded
// /auth entry reopened the login page on every press (#7567).

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
  saveSettings: vi.fn(async (_envConfig: unknown, _settings: { keepLogin?: boolean }) => {}),
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
  useSettingsStore: () => ({
    settings: {},
    setSettings: vi.fn(),
    saveSettings: mocks.saveSettings,
  }),
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
  it('goes back to the reader beneath when a book is open, leaving no /auth entry', async () => {
    mocks.viewStates = { 'book1-abc': {} };
    openLoginPage(READER);

    fireEvent.click(screen.getAllByRole('button', { name: 'Go Back' })[0]!);

    await waitFor(() => expect(mocks.router.back).toHaveBeenCalledTimes(1));
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });

  it('replaces /auth with the redirect when no book is open beneath', async () => {
    openLoginPage(READER);

    fireEvent.click(screen.getAllByRole('button', { name: 'Go Back' })[0]!);

    await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledWith(READER));
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(mocks.router.back).not.toHaveBeenCalled();
  });

  // The library re-reads settings when it mounts and sends a user it should
  // keep signed in back here. Leaving before keepLogin=false was on disk
  // opened the login page a second time (#7726).
  it('leaves only after keepLogin=false is saved', async () => {
    let finishSave = () => {};
    mocks.saveSettings.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishSave = resolve)),
    );
    openLoginPage(null);

    fireEvent.click(screen.getAllByRole('button', { name: 'Go Back' })[0]!);

    await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledTimes(1));
    expect(mocks.saveSettings.mock.calls[0]![1].keepLogin).toBe(false);
    expect(mocks.router.back).not.toHaveBeenCalled();

    await act(async () => finishSave());
    expect(mocks.router.back).toHaveBeenCalledTimes(1);
  });

  // A second press while the save is pending would go back past the reader.
  it('goes back once when pressed again while saving', async () => {
    let finishSave = () => {};
    mocks.saveSettings.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishSave = resolve)),
    );
    mocks.viewStates = { 'book1-abc': {} };
    openLoginPage(null);

    const goBack = screen.getAllByRole('button', { name: 'Go Back' })[0]!;
    fireEvent.click(goBack);
    fireEvent.click(goBack);
    await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalled());

    await act(async () => finishSave());
    await waitFor(() => expect(mocks.router.back).toHaveBeenCalled());
    expect(mocks.router.back).toHaveBeenCalledTimes(1);
  });

  // Opened as the first history entry, Go Back has nowhere to go; a sign-in
  // afterwards must still leave the login page.
  it('still leaves after signing in when Go Back had nowhere to go', async () => {
    openLoginPage(null);

    fireEvent.click(screen.getAllByRole('button', { name: 'Go Back' })[0]!);
    await waitFor(() => expect(mocks.router.back).toHaveBeenCalledTimes(1));
    signIn();

    expect(mocks.router.replace).toHaveBeenCalledWith('/library');
  });

  // With nothing beneath and no redirect, Go Back's router.back() goes
  // nowhere; the sign-in's own navigation must not be dropped.
  it('leaves for the sign-in that completes while Go Back saves', async () => {
    let finishSave = () => {};
    mocks.saveSettings.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishSave = resolve)),
    );
    openLoginPage(null);

    fireEvent.click(screen.getAllByRole('button', { name: 'Go Back' })[0]!);
    await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalled());
    signIn();
    expect(mocks.router.replace).toHaveBeenCalledWith('/library');

    await act(async () => finishSave());
    expect(mocks.router.back).not.toHaveBeenCalled();
    expect(mocks.router.replace).toHaveBeenCalledTimes(1);
  });

  it('does not go back again when pressed after signing in', async () => {
    mocks.viewStates = { 'book1-abc': {} };
    openLoginPage(READER);

    signIn();
    fireEvent.click(screen.getAllByRole('button', { name: 'Go Back' })[0]!);
    await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalled());
    await act(async () => {});

    expect(mocks.router.back).toHaveBeenCalledTimes(1);
  });

  it('goes back once when sign-in completes while saving', async () => {
    let finishSave = () => {};
    mocks.saveSettings.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishSave = resolve)),
    );
    mocks.viewStates = { 'book1-abc': {} };
    openLoginPage(READER);

    fireEvent.click(screen.getAllByRole('button', { name: 'Go Back' })[0]!);
    await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalled());
    signIn();

    await act(async () => finishSave());
    await waitFor(() => expect(mocks.router.back).toHaveBeenCalled());
    expect(mocks.router.back).toHaveBeenCalledTimes(1);
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
