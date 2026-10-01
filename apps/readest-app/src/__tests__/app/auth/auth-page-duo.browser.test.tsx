/**
 * Where the sign-in page's fixed header and Back button land on iPhone Duo,
 * measured with real layout (#6307).
 *
 * The Duo's status bar is an 84pt side strip reported as a left or right
 * safe-area inset. The page wrapper pads by it, and the header adds it to its
 * own padding. The header is fixed and full width with no `left`, so it took
 * its static position, centred in the padded wrapper: 42px away from the strip,
 * which put Back partly off-screen with the strip on the right. Off the Duo the
 * page keeps main's layout.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '@/styles/globals.css';

import type { Insets } from '@/types/misc';

const h = vi.hoisted(() => ({
  isIPhoneDuo: false,
  insets: { top: 0, right: 0, bottom: 0, left: 0 } as Insets,
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
      hasSafeAreaInset: true,
      isMobileApp: true,
      isAndroidApp: true,
      hasTrafficLight: false,
      hasWindowBar: false,
      hasRoundedWindow: false,
    },
  }),
}));

vi.mock('@/hooks/useTheme', () => ({ useTheme: vi.fn() }));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    safeAreaInsets: h.insets,
    isRoundedWindow: false,
    isIPhoneDuo: h.isIPhoneDuo,
  }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: {}, setSettings: vi.fn(), saveSettings: vi.fn() }),
}));

vi.mock('@/store/trafficLightStore', () => ({
  useTrafficLightStore: () => ({ isTrafficLightVisible: false }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
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
}));
vi.mock('@/app/auth/utils/appleIdAuth', () => ({ getAppleIdAuth: vi.fn() }));
vi.mock('@/app/auth/utils/nativeAuth', () => ({
  authWithCustomTab: vi.fn(),
  authWithSafari: vi.fn(),
}));
vi.mock('@/components/WindowButtons', () => ({ default: () => null }));
// Only the header is measured; the sign-in form isn't needed for it.
vi.mock('@/app/auth/components/AuthPanel', () => ({ default: () => null }));
vi.mock('@/hooks/useEnsureSettingsLoaded', () => ({ useEnsureSettingsLoaded: () => {} }));

import AuthPage from '@/app/auth/page';

const W = 951;
const STRIP = 84;
// The header's ps-4 / pe-6 padding off the Duo.
const PS = 16;

const measure = () => {
  const { container } = render(<AuthPage />);
  const header = container.querySelector<HTMLElement>('div.fixed')!;
  const back = container.querySelector<HTMLElement>('button[aria-label="Go Back"]')!;
  return { header: header.getBoundingClientRect(), back: back.getBoundingClientRect() };
};

beforeEach(async () => {
  await page.viewport(W, 669);
  h.isIPhoneDuo = false;
  h.insets = { top: 0, right: 0, bottom: 0, left: 0 };
});

afterEach(() => {
  cleanup();
});

describe('sign-in header on the iPhone Duo inner display (951x669)', () => {
  test('with the strip on the left, the header spans the screen and Back clears the strip', () => {
    h.isIPhoneDuo = true;
    h.insets = { top: 0, right: 0, bottom: 0, left: STRIP };
    const { header, back } = measure();
    expect(header.left).toBe(0);
    expect(header.right).toBe(W);
    expect(back.left).toBe(STRIP + PS);
  });

  test('with the strip on the right, Back keeps its usual spot', () => {
    h.isIPhoneDuo = true;
    h.insets = { top: 0, right: STRIP, bottom: 0, left: 0 };
    const { header, back } = measure();
    expect(header.left).toBe(0);
    expect(header.right).toBe(W);
    expect(back.left).toBe(PS);
  });

  test('off the Duo a side inset is ignored, as on main', () => {
    h.insets = { top: 0, right: 0, bottom: 21, left: 59 };
    const { header, back } = measure();
    expect(header.left).toBe(0);
    expect(header.right).toBe(W);
    expect(back.left).toBe(PS);
  });
});
