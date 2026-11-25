// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CustomTheme, customThemeToTheme, themes } from '@/styles/themes';

const h = vi.hoisted(() => ({
  isWeb: true,
  isEink: false,
  customThemes: [] as CustomTheme[],
  onUpdateInsets: vi.fn(),
  appService: { isMobileApp: false, isIOSApp: false, isAndroidApp: false },
}));

vi.mock('@/services/environment', () => ({
  isWebAppPlatform: () => h.isWeb,
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: h.appService }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      globalViewSettings: {
        isEink: h.isEink,
        isColorEink: false,
      },
      globalReadSettings: {
        customThemes: h.customThemes,
      },
    },
  }),
}));
vi.mock('@/hooks/useSafeAreaInsets', () => ({
  useSafeAreaInsets: () => ({ onUpdateInsets: h.onUpdateInsets }),
}));
vi.mock('@/utils/bridge', () => ({
  getStatusBarHeight: vi.fn(),
  setSystemUIVisibility: vi.fn(() => Promise.resolve({ success: true })),
  getSystemColorScheme: vi.fn(() => Promise.resolve({ colorScheme: 'light' })),
  hasAmbientLightSensor: vi.fn(() => Promise.resolve({ available: false })),
  startAmbientLightUpdates: vi.fn(() => Promise.resolve({ success: true })),
  stopAmbientLightUpdates: vi.fn(() => Promise.resolve({ success: true })),
}));

import { useTheme } from '@/hooks/useTheme';
import { useThemeStore } from '@/store/themeStore';

const defaultDarkBase200 = themes.find((t) => t.name === 'default')!.colors.dark['base-200'];
const defaultLightBase200 = themes.find((t) => t.name === 'default')!.colors.light['base-200'];
const defaultLightBase100 = themes.find((t) => t.name === 'default')!.colors.light['base-100'];
const sepiaDarkBase200 = themes.find((t) => t.name === 'sepia')!.colors.dark['base-200'];
const sepiaLightBase200 = themes.find((t) => t.name === 'sepia')!.colors.light['base-200'];

const getMetaThemeColor = () =>
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.getAttribute('content');

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = '';
  document.documentElement.style.backgroundColor = '';
  h.isWeb = true;
  h.isEink = false;
  h.customThemes = [];
  useThemeStore.setState({
    themeMode: 'dark',
    themeColor: 'default',
    themeScope: 'library',
    readerThemeMode: 'dark',
    readerThemeColor: 'default',
    libraryThemeMode: null,
    libraryThemeColor: null,
    systemIsDarkMode: false,
    ambientIsDarkMode: false,
    isDarkMode: true,
  });
});

afterEach(cleanup);

describe('useTheme web theme-color and html background', () => {
  it('sets meta[name="theme-color"] and html backgroundColor for dark library on mount', () => {
    const { unmount } = renderHook(() =>
      useTheme({ systemUIVisible: true, appThemeColor: 'base-200', themeScope: 'library' }),
    );

    expect(getMetaThemeColor()).toBe(defaultDarkBase200);
    expect(document.documentElement.style.backgroundColor).toBeTruthy();
    expect(document.documentElement.style.backgroundColor).not.toBe('transparent');
    unmount();
  });

  it('reactively updates theme-color when switching mode or color', () => {
    const { unmount } = renderHook(() =>
      useTheme({ systemUIVisible: true, appThemeColor: 'base-200', themeScope: 'library' }),
    );
    expect(getMetaThemeColor()).toBe(defaultDarkBase200);

    act(() => {
      useThemeStore.getState().setThemeMode('light');
    });
    expect(getMetaThemeColor()).toBe(defaultLightBase200);

    act(() => {
      useThemeStore.getState().setThemeColor('sepia');
    });
    expect(getMetaThemeColor()).toBe(sepiaLightBase200);
    unmount();
  });

  it('uses decoupled library scope color instead of reader color', () => {
    const { unmount } = renderHook(() =>
      useTheme({ systemUIVisible: true, appThemeColor: 'base-200', themeScope: 'library' }),
    );

    act(() => {
      useThemeStore.getState().setScopedThemeColor('library', 'sepia');
    });
    expect(getMetaThemeColor()).toBe(sepiaDarkBase200);
    unmount();
  });

  it('uses base-100 on library when e-ink is enabled', () => {
    h.isEink = true;
    useThemeStore.setState({
      themeMode: 'light',
      readerThemeMode: 'light',
      isDarkMode: false,
    });
    const { unmount } = renderHook(() =>
      useTheme({ systemUIVisible: true, appThemeColor: 'base-200', themeScope: 'library' }),
    );
    expect(getMetaThemeColor()).toBe(defaultLightBase100);
    unmount();
  });

  it('keeps an open panel color when the theme changes under it', () => {
    const { unmount } = renderHook(() =>
      useTheme({ systemUIVisible: true, appThemeColor: 'base-100', themeScope: 'reader' }),
    );
    // The sidebar or notebook opens and asks for its own surface color.
    act(() => {
      useThemeStore.getState().updateAppTheme('base-200');
    });
    expect(getMetaThemeColor()).toBe(defaultDarkBase200);

    act(() => {
      useThemeStore.getState().setThemeMode('light');
    });
    expect(getMetaThemeColor()).toBe(defaultLightBase200);
    unmount();
  });

  it('does not touch meta[name="theme-color"] or html backgroundColor on non-web platforms', () => {
    h.isWeb = false;
    const { unmount } = renderHook(() =>
      useTheme({ systemUIVisible: true, appThemeColor: 'base-200', themeScope: 'library' }),
    );
    expect(getMetaThemeColor()).toBeUndefined();
    expect(document.documentElement.style.backgroundColor).toBe('');
    unmount();
  });

  it('updates theme-color and html backgroundColor when editing an active custom theme in place', () => {
    const initialTheme: CustomTheme = {
      name: 'atelier',
      label: 'Atelier',
      colors: {
        light: { fg: '#111111', bg: '#f8f5ee', primary: '#2255aa' },
        dark: { fg: '#eeeeee', bg: '#112233', primary: '#6699cc' },
      },
    };
    const editedTheme: CustomTheme = {
      ...initialTheme,
      colors: {
        ...initialTheme.colors,
        dark: { fg: '#eeeeee', bg: '#334455', primary: '#6699cc' },
      },
    };
    h.customThemes = [initialTheme];
    useThemeStore.setState({
      themeColor: 'atelier',
      readerThemeColor: 'atelier',
    });

    const { rerender, unmount } = renderHook(() =>
      useTheme({ systemUIVisible: true, appThemeColor: 'base-200', themeScope: 'library' }),
    );

    const firstExpected = customThemeToTheme(initialTheme).colors.dark['base-200'];
    expect(getMetaThemeColor()).toBe(firstExpected);
    const firstHtmlBg = document.documentElement.style.backgroundColor;

    h.customThemes = [editedTheme];
    rerender();

    const editedExpected = customThemeToTheme(editedTheme).colors.dark['base-200'];
    expect(editedExpected).not.toBe(firstExpected);
    expect(getMetaThemeColor()).toBe(editedExpected);
    expect(document.documentElement.style.backgroundColor).not.toBe(firstHtmlBg);
    unmount();
  });
});
