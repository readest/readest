import { create } from 'zustand';
import { getThemeCode, ThemeCode } from '@/utils/style';
import { CustomTheme, Palette, ThemeMode } from '@/styles/themes';
import { EnvConfigType, isWebAppPlatform } from '@/services/environment';
import { SystemSettings } from '@/types/settings';

interface ThemeState {
  themeMode: ThemeMode;
  themeColor: string;
  systemIsDarkMode: boolean;
  themeCode: ThemeCode;
  isDarkMode: boolean;
  getIsDarkMode: () => boolean;
  setThemeMode: (mode: ThemeMode) => void;
  setThemeColor: (color: string) => void;
  updateAppTheme: (color: keyof Palette) => void;
  saveCustomTheme: (
    envConfig: EnvConfigType,
    settings: SystemSettings,
    theme: CustomTheme,
    isDelete?: boolean,
  ) => void;
}

const getInitialThemeMode = (): ThemeMode => {
  if (typeof window !== 'undefined' && localStorage) {
    return (localStorage.getItem('themeMode') as ThemeMode) || 'auto';
  }
  return 'auto';
};

const getInitialThemeColor = (): string => {
  if (typeof window !== 'undefined' && localStorage) {
    return localStorage.getItem('themeColor') || 'default';
  }
  return 'default';
};

export const useThemeStore = create<ThemeState>((set, get) => {
  const initialThemeMode = getInitialThemeMode();
  const initialThemeColor = getInitialThemeColor();
  const systemIsDarkMode =
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDarkMode =
    initialThemeMode === 'dark' || (initialThemeMode === 'auto' && systemIsDarkMode);
  const themeCode = getThemeCode();

  if (typeof window !== 'undefined') {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = () => {
      const mode = get().themeMode;
      const isDarkMode = mode === 'dark' || (mode === 'auto' && mediaQuery.matches);
      set({ systemIsDarkMode: mediaQuery.matches, isDarkMode });
    };

    mediaQuery.addEventListener('change', handleSystemThemeChange);
  }

  return {
    themeMode: initialThemeMode,
    themeColor: initialThemeColor,
    systemIsDarkMode,
    isDarkMode,
    themeCode,
    getIsDarkMode: () => get().isDarkMode,
    setThemeMode: (mode) => {
      if (typeof window !== 'undefined' && localStorage) {
        localStorage.setItem('themeMode', mode);
      }
      const isDarkMode = mode === 'dark' || (mode === 'auto' && get().systemIsDarkMode);
      document.documentElement.setAttribute(
        'data-theme',
        `${get().themeColor}-${isDarkMode ? 'dark' : 'light'}`,
      );
      set({ themeMode: mode, isDarkMode });
      set({ themeCode: getThemeCode() });
    },
    setThemeColor: (color) => {
      if (typeof window !== 'undefined' && localStorage) {
        localStorage.setItem('themeColor', color);
      }
      document.documentElement.setAttribute(
        'data-theme',
        `${color}-${get().isDarkMode ? 'dark' : 'light'}`,
      );
      set({ themeColor: color });
      set({ themeCode: getThemeCode() });
    },
    updateAppTheme: (color) => {
      if (isWebAppPlatform()) {
        const { palette } = get().themeCode;
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', palette[color]);
      }
    },
    saveCustomTheme: async (envConfig, settings, theme, isDelete) => {
      const customThemes = settings.globalReadSettings.customThemes || [];
      const index = customThemes.findIndex((t) => t.name === theme.name);
      if (isDelete) {
        if (index > -1) {
          customThemes.splice(index, 1);
        }
      } else {
        if (index > -1) {
          customThemes[index] = theme;
        } else {
          customThemes.push(theme);
        }
      }
      settings.globalReadSettings.customThemes = customThemes;
      localStorage.setItem('customThemes', JSON.stringify(customThemes));
      const appService = await envConfig.getAppService();
      await appService.saveSettings(settings);
    },
  };
});
