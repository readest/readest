import { useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { applyCustomTheme, Palette } from '@/styles/themes';
import { setSystemUIVisibility } from '@/utils/bridge';

type UseThemeProps = {
  systemUIVisible?: boolean;
  appThemeColor?: keyof Palette;
};

export const useTheme = ({
  systemUIVisible = true,
  appThemeColor = 'base-100',
}: UseThemeProps = {}) => {
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const { themeColor, isDarkMode, updateAppTheme } = useThemeStore();

  useEffect(() => {
    updateAppTheme(appThemeColor);
    if (appService?.isMobile) {
      setSystemUIVisibility({ visible: systemUIVisible, darkMode: isDarkMode });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDarkMode]);

  useEffect(() => {
    const customThemes = settings.globalReadSettings?.customThemes ?? [];
    customThemes.forEach((customTheme) => {
      applyCustomTheme(customTheme);
    });
  }, [settings]);

  useEffect(() => {
    const colorScheme = isDarkMode ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', `${themeColor}-${colorScheme}`);
    document.documentElement.style.setProperty('color-scheme', colorScheme);
  }, [themeColor, isDarkMode]);
};
