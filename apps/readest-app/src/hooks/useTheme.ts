import { useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { applyCustomTheme, Palette } from '@/styles/themes';
import { getStatusBarHeight, setSystemUIVisibility } from '@/utils/bridge';

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
  const { themeColor, isDarkMode, updateAppTheme, setStatusBarHeight } = useThemeStore();

  useEffect(() => {
    updateAppTheme(appThemeColor);
    if (appService?.isMobile) {
      setSystemUIVisibility({ visible: systemUIVisible, darkMode: isDarkMode });
    }
    if (appService?.isAndroidApp) {
      getStatusBarHeight().then((res) => {
        if (res.height && res.height > 0) {
          setStatusBarHeight(res.height / window.devicePixelRatio);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService, isDarkMode]);

  useEffect(() => {
    const customThemes = settings.globalReadSettings?.customThemes ?? [];
    customThemes.forEach((customTheme) => {
      applyCustomTheme(customTheme);
    });
    localStorage.setItem('customThemes', JSON.stringify(customThemes));
  }, [settings]);

  useEffect(() => {
    const colorScheme = isDarkMode ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', `${themeColor}-${colorScheme}`);
    document.documentElement.style.setProperty('color-scheme', colorScheme);
  }, [themeColor, isDarkMode]);
};
