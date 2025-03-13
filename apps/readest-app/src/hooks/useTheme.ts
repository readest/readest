import { useEffect } from 'react';
import { useThemeStore } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { applyCustomTheme } from '@/styles/themes';

export const useTheme = () => {
  const { settings } = useSettingsStore();
  const { themeColor, isDarkMode } = useThemeStore();
  useEffect(() => {
    const customThemes = settings.globalReadSettings?.customThemes ?? [];
    customThemes.forEach((customTheme) => {
      applyCustomTheme(customTheme);
    });
  }, [settings]);

  useEffect(() => {
    document.documentElement.setAttribute(
      'data-theme',
      `${themeColor}-${isDarkMode ? 'dark' : 'light'}`,
    );
  }, [themeColor, isDarkMode]);
};
