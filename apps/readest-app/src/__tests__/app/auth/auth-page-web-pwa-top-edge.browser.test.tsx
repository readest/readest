/**
 * The web sign-in page in an installed web app (#7887): iOS 26+ blurs the top
 * of a Home Screen web app unless an opaque fixed or sticky box covers that
 * edge. The page's only fixed element there was the transparent Back button,
 * so the button and the logo below it went soft. On a web app the page now
 * puts an opaque strip under Back. Back must still take the tap once the form
 * scrolls under the strip. A browser tab gets nothing new.
 */

import { cleanup, render } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '@/styles/globals.css';

const h = vi.hoisted(() => ({ installed: true }));

// Browser mode links ES modules strictly, so every named export a transitive
// import asks for has to exist; the real module pulls in the whole app.
vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
  isWebAppPlatform: () => true,
  hasCli: () => false,
  isPWA: () => h.installed,
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
      appPlatform: 'web',
      hasSafeAreaInset: h.installed,
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
// A sign-in form taller than the phone, so the page scrolls under the top edge.
vi.mock('@/app/auth/components/AuthPanel', () => ({
  default: () => <div data-testid='form' style={{ height: 1600, width: '100%' }} />,
}));

import AuthPage from '@/app/auth/page';

/** What covers the middle of the page's top edge: fixed and opaque, or not. */
const topEdge = () => {
  const hit = document.elementFromPoint(window.innerWidth / 2, 1)!;
  const style = getComputedStyle(hit);
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.fillStyle = style.backgroundColor;
  probe.fillRect(0, 0, 1, 1);
  return { position: style.position, opaque: probe.getImageData(0, 0, 1, 1).data[3] === 255 };
};

/** Scrolls the form under the top edge and names what a tap on Back would hit. */
const tapBackAfterScrolling = async (container: HTMLElement) => {
  const back = container.querySelector<HTMLElement>('button[aria-label="Go Back"]')!;
  window.scrollTo(0, document.documentElement.scrollHeight);
  await new Promise(requestAnimationFrame);
  expect(window.scrollY).toBeGreaterThan(0);
  const r = back.getBoundingClientRect();
  const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return back.contains(hit)
    ? back.getAttribute('aria-label')
    : `${hit?.localName}.${hit?.className}`;
};

beforeAll(async () => {
  if (!i18n.isInitialized) await i18n.use(initReactI18next).init({ lng: 'en', resources: {} });
});

afterEach(() => {
  cleanup();
  window.scrollTo(0, 0);
});

describe('web sign-in page top edge', () => {
  test('installed web app: an opaque fixed box covers the top edge, and Back takes the tap', async () => {
    h.installed = true;
    await page.viewport(393, 852);
    const { container } = render(<AuthPage />);
    expect(topEdge()).toEqual({ position: 'fixed', opaque: true });
    expect(await tapBackAfterScrolling(container)).toBe('Go Back');
    expect(topEdge()).toEqual({ position: 'fixed', opaque: true });
  });

  test('browser tab: no box is added at the top edge', async () => {
    h.installed = false;
    await page.viewport(393, 852);
    const { container } = render(<AuthPage />);
    expect(topEdge().position).not.toBe('fixed');
    expect(await tapBackAfterScrolling(container)).toBe('Go Back');
  });
});
