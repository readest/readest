import { useEffect } from 'react';
import { useThemeStore } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { applyCustomTheme } from '@/styles/themes';
import { applyColorScheme } from '@/utils/style';

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
    const colorScheme = isDarkMode ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', `${themeColor}-${colorScheme}`);
    applyColorScheme(document, isDarkMode);
  }, [themeColor, isDarkMode]);
};
