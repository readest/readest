import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const h = vi.hoisted(() => ({
  replace: vi.fn(),
  toasts: [] as Array<{ message: string; type: string }>,
  start: vi.fn(),
  poll: vi.fn(),
  stash: vi.fn(),
  saveSettings: vi.fn().mockResolvedValue(undefined),
  setSettings: vi.fn(),
  settings: { hardcover: undefined as undefined | { accessToken: string } },
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: h.replace }) }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { hasWindowBar: false } }),
}));
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => {} }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));
vi.mock('@/hooks/useEnsureSettingsLoaded', () => ({ useEnsureSettingsLoaded: () => true }));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: null, isRoundedWindow: false, isIPhoneDuo: false }),
}));
vi.mock('@/store/trafficLightStore', () => ({
  useTrafficLightStore: () => ({ isTrafficLightVisible: false }),
}));
vi.mock('@/store/settingsStore', () => {
  const state = {
    get settings() {
      return h.settings;
    },
    setSettings: h.setSettings,
    saveSettings: h.saveSettings,
  };
  return { useSettingsStore: Object.assign(() => state, { getState: () => state }) };
});
vi.mock('@/components/WindowButtons', () => ({ default: () => null }));
vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    dispatch: (_: string, d: { message: string; type: string }) => h.toasts.push(d),
  },
}));
vi.mock('@/services/hardcover/hardcoverConnection', () => ({
  stashHardcoverReturnTarget: h.stash,
}));
vi.mock('@/services/hardcover/hardcoverOAuth', () => ({
  HardcoverOAuthError: class extends Error {
    constructor(public code: string) {
      super(code);
    }
  },
  startDeviceAuth: h.start,
  pollDeviceToken: h.poll,
}));

import HardcoverConnectPage from '@/app/hardcover/connect/page';
import { HardcoverOAuthError } from '@/services/hardcover/hardcoverOAuth';

const device = {
  deviceCode: 'dc',
  userCode: 'ABCD1234',
  verificationUri: 'https://hardcover.app/link',
  verificationUriComplete: 'https://hardcover.app/link?code=ABCD1234',
  expiresIn: 900,
  interval: 5,
};

describe('Hardcover connect page', () => {
  afterEach(cleanup);

  beforeEach(async () => {
    if (!i18n.isInitialized)
      await i18n
        .use(initReactI18next)
        .init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } });
    vi.clearAllMocks();
    h.toasts.length = 0;
    h.settings = { hardcover: undefined };
    h.saveSettings.mockResolvedValue(undefined);
    h.start.mockResolvedValue(device);
  });

  it('shows the code and QR, then saves tokens and returns to Settings on approval', async () => {
    h.poll.mockResolvedValue({ accessToken: 'a', refreshToken: 'r', expiresAt: 1 });
    const { container } = render(<HardcoverConnectPage />);
    expect(await screen.findByText('ABCD1234')).toBeTruthy();
    expect(container.querySelector('img[src^="data:image/svg+xml"]')).toBeTruthy();
    const link = container.querySelector('a.link')!;
    expect(link.textContent).toBe('https://hardcover.app/link');
    expect(link.getAttribute('href')).toBe(device.verificationUriComplete);
    await waitFor(() => expect(h.replace).toHaveBeenCalled());
    expect(h.saveSettings).toHaveBeenCalled();
    expect(h.saveSettings.mock.invocationCallOrder[0]).toBeLessThan(
      h.setSettings.mock.invocationCallOrder[0]!,
    );
    expect(h.stash).toHaveBeenCalled();
    expect(h.toasts).toHaveLength(0);
  });

  it('returns to the page Connect was pressed on (e.g. a book) instead of the library', async () => {
    window.history.pushState({}, '', '/hardcover/connect?redirect=%2Freader%3Fids%3Dabc');
    h.poll.mockResolvedValue({ accessToken: 'a', refreshToken: 'r', expiresAt: 1 });
    render(<HardcoverConnectPage />);
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/reader?ids=abc'));
    window.history.pushState({}, '', '/');
  });

  it.each([
    '//evil.example',
    '/\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    'https://evil.example',
  ])('falls back to the library instead of redirecting to %j', async (redirect) => {
    window.history.pushState({}, '', `/hardcover/connect?redirect=${encodeURIComponent(redirect)}`);
    h.poll.mockResolvedValue({ accessToken: 'a', refreshToken: 'r', expiresAt: 1 });
    render(<HardcoverConnectPage />);
    await waitFor(() => expect(h.replace).toHaveBeenCalled());
    expect(h.replace).toHaveBeenCalledTimes(1);
    expect(h.replace.mock.calls[0]![0]).toMatch(/^\/library/);
    window.history.pushState({}, '', '/');
  });

  it('toasts the reason and returns when access is denied', async () => {
    h.poll.mockRejectedValue(new HardcoverOAuthError('access_denied'));
    render(<HardcoverConnectPage />);
    await waitFor(() => expect(h.replace).toHaveBeenCalled());
    expect(h.toasts).toEqual([{ message: 'Hardcover access was denied.', type: 'error' }]);
    expect(h.saveSettings).not.toHaveBeenCalled();
  });

  it('keeps a pasted token, and a failed save toasts but still returns', async () => {
    h.settings = { hardcover: { accessToken: 'pasted' } };
    h.poll.mockResolvedValue({ accessToken: 'a', refreshToken: 'r', expiresAt: 1 });
    h.saveSettings.mockRejectedValueOnce(new Error('disk full'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<HardcoverConnectPage />);
    await waitFor(() => expect(h.replace).toHaveBeenCalled());
    const saved = h.saveSettings.mock.calls[0]![1] as { hardcover: { accessToken: string } };
    expect(saved.hardcover.accessToken).toBe('pasted');
    expect(h.setSettings).not.toHaveBeenCalled();
    expect(h.toasts).toEqual([{ message: 'Connection failed', type: 'error' }]);
  });

  it('ignores tokens that arrive after the user left the page', async () => {
    let resolve!: (t: object) => void;
    h.poll.mockReturnValue(new Promise((r) => (resolve = r)));
    const { unmount } = render(<HardcoverConnectPage />);
    await screen.findByText('ABCD1234');
    unmount();
    resolve({ accessToken: 'a', refreshToken: 'r', expiresAt: 1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(h.saveSettings).not.toHaveBeenCalled();
    expect(h.replace).not.toHaveBeenCalled();
  });
});
