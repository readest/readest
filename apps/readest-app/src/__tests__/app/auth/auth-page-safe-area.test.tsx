import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AuthPage from '@/app/auth/page';

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => true,
  getBaseUrl: () => 'https://web.readest.com',
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
    safeAreaInsets: { top: 44, right: 0, bottom: 34, left: 0 },
    isRoundedWindow: false,
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
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue('false') }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ listen: vi.fn() }),
}));
vi.mock('@/app/auth/utils/appleIdAuth', () => ({ getAppleIdAuth: vi.fn() }));
vi.mock('@/app/auth/utils/nativeAuth', () => ({
  authWithCustomTab: vi.fn(),
  authWithSafari: vi.fn(),
}));
vi.mock('@/components/WindowButtons', () => ({ default: () => null }));

describe('AuthPage safe area (notch clearance)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('offsets the fixed header with the top safe-area inset so the back button clears the notch', () => {
    const { container } = render(<AuthPage />);
    const header = container.querySelector('div.fixed') as HTMLElement;
    expect(header).toBeTruthy();
    expect(header.style.top).toBe('44px');
  });
});
