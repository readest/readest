import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('@/utils/style', () => ({
  getThemeCode: vi.fn(() => ({
    bg: '#ffffff',
    fg: '#000000',
    primary: '#0066cc',
    palette: { 'base-100': '#fff' },
    isDarkMode: false,
  })),
}));

vi.mock('@/utils/bridge', () => ({
  getSystemColorScheme: vi.fn(() => Promise.resolve({ colorScheme: 'light' })),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({
    isFullscreen: vi.fn(() => Promise.resolve(false)),
    isMaximized: vi.fn(() => Promise.resolve(false)),
  })),
}));

vi.mock('@/services/environment', () => ({
  isWebAppPlatform: vi.fn(() => false),
}));

import { useThemeStore, loadDataTheme } from '@/store/themeStore';

describe('themeStore', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset store to initial state
    useThemeStore.setState({
      themeMode: 'auto',
      themeColor: 'default',
      systemIsDarkMode: false,
      isDarkMode: false,
      systemUIVisible: false,
      statusBarHeight: 24,
      systemUIAlwaysHidden: false,
      safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      isRoundedWindow: true,
    });
  });

  describe('initial state', () => {
    test('has correct default values', () => {
      const state = useThemeStore.getState();
      expect(state.themeMode).toBe('auto');
      expect(state.themeColor).toBe('default');
      expect(state.systemUIVisible).toBe(false);
      expect(state.statusBarHeight).toBe(24);
      expect(state.systemUIAlwaysHidden).toBe(false);
      expect(state.safeAreaInsets).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
      expect(state.isRoundedWindow).toBe(true);
    });
  });

  describe('setThemeMode', () => {
    test('stores mode in localStorage and sets isDarkMode false for light mode', () => {
      useThemeStore.getState().setThemeMode('light');
      expect(localStorage.getItem('themeMode')).toBe('light');

      const state = useThemeStore.getState();
      expect(state.themeMode).toBe('light');
      expect(state.isDarkMode).toBe(false);
    });

    test('stores mode in localStorage and sets isDarkMode true for dark mode', () => {
      useThemeStore.getState().setThemeMode('dark');
      expect(localStorage.getItem('themeMode')).toBe('dark');

      const state = useThemeStore.getState();
      expect(state.themeMode).toBe('dark');
      expect(state.isDarkMode).toBe(true);
    });

    test('in auto mode, uses systemIsDarkMode to compute isDarkMode', () => {
      // When systemIsDarkMode is false, auto => light
      useThemeStore.setState({ systemIsDarkMode: false });
      useThemeStore.getState().setThemeMode('auto');
      expect(useThemeStore.getState().isDarkMode).toBe(false);

      // When systemIsDarkMode is true, auto => dark
      useThemeStore.setState({ systemIsDarkMode: true });
      useThemeStore.getState().setThemeMode('auto');
      expect(useThemeStore.getState().isDarkMode).toBe(true);
    });

    test('sets data-theme attribute on documentElement', () => {
      useThemeStore.getState().setThemeMode('dark');
      expect(document.documentElement.getAttribute('data-theme')).toBe('default-dark');

      useThemeStore.getState().setThemeMode('light');
      expect(document.documentElement.getAttribute('data-theme')).toBe('default-light');
    });
  });

  describe('setThemeColor', () => {
    test('stores color in localStorage', () => {
      useThemeStore.getState().setThemeColor('sepia');
      expect(localStorage.getItem('themeColor')).toBe('sepia');

      const state = useThemeStore.getState();
      expect(state.themeColor).toBe('sepia');
    });

    test('sets data-theme attribute using color and current dark mode', () => {
      useThemeStore.setState({ isDarkMode: false });
      useThemeStore.getState().setThemeColor('sepia');
      expect(document.documentElement.getAttribute('data-theme')).toBe('sepia-light');

      useThemeStore.setState({ isDarkMode: true });
      useThemeStore.getState().setThemeColor('ocean');
      expect(document.documentElement.getAttribute('data-theme')).toBe('ocean-dark');
    });
  });

  describe('handleSystemThemeChange', () => {
    test('updates isDarkMode based on systemIsDarkMode when in auto mode', () => {
      useThemeStore.setState({ themeMode: 'auto' });

      useThemeStore.getState().handleSystemThemeChange(true);
      let state = useThemeStore.getState();
      expect(state.systemIsDarkMode).toBe(true);
      expect(state.isDarkMode).toBe(true);

      useThemeStore.getState().handleSystemThemeChange(false);
      state = useThemeStore.getState();
      expect(state.systemIsDarkMode).toBe(false);
      expect(state.isDarkMode).toBe(false);
    });

    test('isDarkMode stays true when themeMode is dark regardless of system theme', () => {
      useThemeStore.setState({ themeMode: 'dark' });

      useThemeStore.getState().handleSystemThemeChange(false);
      const state = useThemeStore.getState();
      expect(state.systemIsDarkMode).toBe(false);
      expect(state.isDarkMode).toBe(true);
    });

    test('isDarkMode stays false when themeMode is light regardless of system theme', () => {
      useThemeStore.setState({ themeMode: 'light' });

      useThemeStore.getState().handleSystemThemeChange(true);
      const state = useThemeStore.getState();
      expect(state.systemIsDarkMode).toBe(true);
      expect(state.isDarkMode).toBe(false);
    });

    test('updates themeCode when system theme changes to dark', async () => {
      const styleModule = await import('@/utils/style');
      const mockGetThemeCode = vi.mocked(styleModule.getThemeCode);
      const darkThemeCode = {
        bg: '#1a1a1a',
        fg: '#ffffff',
        primary: '#4d9fff',
        palette: {
          'base-100': '#1a1a1a',
          'base-200': '#2a2a2a',
          'base-300': '#3a3a3a',
          'base-content': '#ffffff',
          neutral: '#333333',
          'neutral-content': '#ffffff',
          primary: '#4d9fff',
          secondary: '#6c757d',
          accent: '#4d9fff',
        },
        isDarkMode: true,
      };
      mockGetThemeCode.mockReturnValueOnce(darkThemeCode);

      useThemeStore.setState({ themeMode: 'auto' });
      useThemeStore.getState().handleSystemThemeChange(true);

      expect(useThemeStore.getState().themeCode).toEqual(darkThemeCode);
    });

    test('updates data-theme attribute when system theme changes', () => {
      useThemeStore.setState({ themeMode: 'auto', themeColor: 'default' });
      useThemeStore.getState().handleSystemThemeChange(true);
      expect(document.documentElement.getAttribute('data-theme')).toBe('default-dark');

      useThemeStore.getState().handleSystemThemeChange(false);
      expect(document.documentElement.getAttribute('data-theme')).toBe('default-light');
    });
  });

  describe('showSystemUI / dismissSystemUI', () => {
    test('showSystemUI sets systemUIVisible to true', () => {
      useThemeStore.getState().showSystemUI();
      expect(useThemeStore.getState().systemUIVisible).toBe(true);
    });

    test('dismissSystemUI sets systemUIVisible to false', () => {
      useThemeStore.setState({ systemUIVisible: true });
      useThemeStore.getState().dismissSystemUI();
      expect(useThemeStore.getState().systemUIVisible).toBe(false);
    });
  });

  describe('setStatusBarHeight', () => {
    test('updates statusBarHeight', () => {
      useThemeStore.getState().setStatusBarHeight(48);
      expect(useThemeStore.getState().statusBarHeight).toBe(48);
    });
  });

  describe('setSystemUIAlwaysHidden', () => {
    test('updates systemUIAlwaysHidden', () => {
      useThemeStore.getState().setSystemUIAlwaysHidden(true);
      expect(useThemeStore.getState().systemUIAlwaysHidden).toBe(true);

      useThemeStore.getState().setSystemUIAlwaysHidden(false);
      expect(useThemeStore.getState().systemUIAlwaysHidden).toBe(false);
    });
  });

  describe('updateSafeAreaInsets', () => {
    test('updates safeAreaInsets', () => {
      const insets = { top: 10, right: 5, bottom: 20, left: 5 };
      useThemeStore.getState().updateSafeAreaInsets(insets);
      expect(useThemeStore.getState().safeAreaInsets).toEqual(insets);
    });
  });

  describe('loadDataTheme', () => {
    test('sets data-theme attribute when localStorage has themeMode and themeColor', () => {
      localStorage.setItem('themeMode', 'dark');
      localStorage.setItem('themeColor', 'sepia');
      loadDataTheme();
      expect(document.documentElement.getAttribute('data-theme')).toBe('sepia-dark');
    });

    test('sets light theme in auto mode when system prefers light', () => {
      localStorage.setItem('themeMode', 'auto');
      localStorage.setItem('themeColor', 'default');
      // jsdom matchMedia mock returns matches: false by default (from vitest.setup.ts)
      loadDataTheme();
      expect(document.documentElement.getAttribute('data-theme')).toBe('default-light');
    });

    test('does nothing when themeMode is not in localStorage', () => {
      localStorage.setItem('themeColor', 'default');
      document.documentElement.removeAttribute('data-theme');
      loadDataTheme();
      expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    });

    test('does nothing when themeColor is not in localStorage', () => {
      localStorage.setItem('themeMode', 'dark');
      document.documentElement.removeAttribute('data-theme');
      loadDataTheme();
      expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    });
  });

  describe('getIsDarkMode', () => {
    test('returns the current isDarkMode value', () => {
      useThemeStore.setState({ isDarkMode: true });
      expect(useThemeStore.getState().getIsDarkMode()).toBe(true);

      useThemeStore.setState({ isDarkMode: false });
      expect(useThemeStore.getState().getIsDarkMode()).toBe(false);
    });
  });
});
