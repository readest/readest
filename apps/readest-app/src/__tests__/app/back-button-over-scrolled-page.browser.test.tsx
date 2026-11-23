/**
 * The Back button of the sign-in and Hardcover connect pages stays on top of the
 * page body when the body scrolls under the fixed header, measured with a real
 * hit test.
 *
 * Both pages put the header in a `fixed z-10` box and the body in a `z-20` flex
 * item of the same scroll container. A flex item's z-index applies without
 * positioning, so the body stacked above the header: once it scrolled under the
 * header, taps on Back landed on the body and did nothing. On a Kindle (536x724)
 * the sign-in form scrolls, and a user tapped Back a dozen times without leaving.
 */

import { cleanup, render } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '@/styles/globals.css';

const h = vi.hoisted(() => ({
  device: {
    deviceCode: 'dc',
    userCode: 'ABCD1234',
    verificationUri: 'https://hardcover.app/link',
    verificationUriComplete: 'https://hardcover.app/link?code=ABCD1234',
    expiresIn: 900,
    interval: 5,
  },
}));

// Browser mode links ES modules strictly, so every named export a transitive
// import asks for has to exist; the real module pulls in the whole app.
vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => true,
  isWebAppPlatform: () => false,
  hasCli: () => false,
  isPWA: () => false,
  getBaseUrl: () => 'https://web.readest.com',
  getNodeBaseUrl: () => 'https://web.readest.com',
  needsPointerWindowControls: () => false,
  isMacPlatform: () => false,
  getCommandPaletteShortcut: () => '',
  getAPIBaseUrl: () => 'https://web.readest.com/api',
  getReadestVoiceAPIBaseUrl: () => 'https://web.readest.com/api',
  getNodeAPIBaseUrl: () => 'https://web.readest.com/api',
  getInitializedAppService: vi.fn(),
  default: {},
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ login: vi.fn() }),
}));

vi.mock('@/utils/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: vi.fn(),
    },
  },
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: {},
    appService: {
      hasSafeAreaInset: false,
      isMobileApp: false,
      isAndroidApp: false,
      hasTrafficLight: false,
      hasWindowBar: false,
      hasRoundedWindow: false,
    },
  }),
}));

vi.mock('@/hooks/useTheme', () => ({ useTheme: vi.fn() }));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    isRoundedWindow: false,
    isIPhoneDuo: false,
  }),
}));

vi.mock('@/store/settingsStore', () => {
  const state = { settings: {}, setSettings: vi.fn(), saveSettings: vi.fn() };
  return { useSettingsStore: Object.assign(() => state, { getState: () => state }) };
});

vi.mock('@/store/trafficLightStore', () => ({
  useTrafficLightStore: () => ({ isTrafficLightVisible: false }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    const { alt, ...rest } = props;
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={String(alt ?? '')} {...(rest as React.ImgHTMLAttributes<HTMLImageElement>)} />;
  },
}));

vi.mock('@tauri-apps/plugin-deep-link', () => ({ onOpenUrl: vi.fn() }));
vi.mock('@fabianlars/tauri-plugin-oauth', () => ({
  start: vi.fn().mockResolvedValue(12345),
  cancel: vi.fn(),
  onUrl: vi.fn(),
  onInvalidUrl: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  invoke: vi.fn().mockResolvedValue('false'),
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ listen: vi.fn() }),
  getAllWindows: () => Promise.resolve([]),
}));
vi.mock('@/app/auth/utils/appleIdAuth', () => ({ getAppleIdAuth: vi.fn() }));
vi.mock('@/app/auth/utils/nativeAuth', () => ({
  authWithCustomTab: vi.fn(),
  authWithSafari: vi.fn(),
}));
vi.mock('@/components/WindowButtons', () => ({ default: () => null }));
// A sign-in form taller than the Kindle's 724px, as the real one is there.
vi.mock('@/app/auth/components/AuthPanel', () => ({
  default: () => <div data-testid='form' style={{ height: 1200, width: '100%' }} />,
}));
vi.mock('@/hooks/useEnsureSettingsLoaded', () => ({ useEnsureSettingsLoaded: () => true }));
vi.mock('@/services/hardcover/hardcoverConnection', () => ({
  stashHardcoverReturnTarget: vi.fn(),
}));
vi.mock('@/services/hardcover/hardcoverOAuth', () => ({
  HardcoverOAuthError: class extends Error {},
  startDeviceAuth: vi.fn().mockResolvedValue(h.device),
  pollDeviceToken: () => new Promise(() => {}),
}));

import AuthPage from '@/app/auth/page';
import HardcoverConnectPage from '@/app/hardcover/connect/page';

/** Scrolls the page body to its end and names what a tap on Back would hit. */
const tapBackAfterScrolling = async (container: HTMLElement) => {
  const back = container.querySelector<HTMLElement>('button[aria-label="Go Back"]')!;
  const scroller = back.parentElement!.parentElement!;
  expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
  scroller.scrollTop = scroller.scrollHeight;
  await new Promise(requestAnimationFrame);
  const r = back.getBoundingClientRect();
  const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  // The tap's target: Back's label, or the class of whatever covers it.
  return back.contains(hit)
    ? back.getAttribute('aria-label')
    : `${hit?.localName}.${hit?.className}`;
};

beforeAll(async () => {
  if (!i18n.isInitialized) await i18n.use(initReactI18next).init({ lng: 'en', resources: {} });
});

afterEach(() => {
  cleanup();
});

describe('Back over a scrolled page body', () => {
  test('sign-in at the Kindle size (536x724): Back takes the tap', async () => {
    await page.viewport(536, 724);
    const { container } = render(<AuthPage />);
    expect(await tapBackAfterScrolling(container)).toBe('Go Back');
  });

  test('Hardcover connect on a phone held sideways (360x420): Back takes the tap', async () => {
    await page.viewport(360, 420);
    const { container, findByText } = render(<HardcoverConnectPage />);
    await findByText('Scan this QR code');
    expect(await tapBackAfterScrolling(container)).toBe('Go Back');
  });
});
