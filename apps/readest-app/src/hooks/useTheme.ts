import { useCallback, useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { applyCustomTheme, Palette } from '@/styles/themes';
import { getStatusBarHeight, setSystemUIVisibility } from '@/utils/bridge';
import { getOSPlatform } from '@/utils/misc';

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
  const {
    themeColor,
    isDarkMode,
    showSystemUI,
    dismissSystemUI,
    updateAppTheme,
    setStatusBarHeight,
    systemUIAlwaysHidden,
    setSystemUIAlwaysHidden,
  } = useThemeStore();

  useEffect(() => {
    updateAppTheme(appThemeColor);
    if (appService?.isAndroidApp) {
      getStatusBarHeight().then((res) => {
        if (res.height && res.height > 0) {
          setStatusBarHeight(res.height / window.devicePixelRatio);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSystemUIVisibility = useCallback(() => {
    if (!appService?.isMobileApp) return;

    const visible = systemUIVisible && !systemUIAlwaysHidden;
    if (visible) {
      showSystemUI();
    } else {
      dismissSystemUI();
    }
    setSystemUIVisibility({ visible, darkMode: isDarkMode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService, isDarkMode, systemUIVisible]);

  useEffect(() => {
    if (appService?.isMobileApp) {
      handleSystemUIVisibility();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleSystemUIVisibility]);

  useEffect(() => {
    if (!appService?.isMobileApp) return;

    handleSystemUIVisibility();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleSystemUIVisibility();
      }
    };
    const handleOrientationChange = () => {
      if (appService?.isIOSApp && getOSPlatform() === 'ios') {
        // FIXME: This is a workaround for iPhone apps where the system UI is not visible in landscape mode
        // when the app is in fullscreen mode until we find a better solution to override the prefersStatusBarHidden
        // in the ViewController. Note that screen.orientation.type is not abailable in iOS before 16.4.
        const systemUIAlwaysHidden = screen.orientation?.type.includes('landscape');
        setSystemUIAlwaysHidden(systemUIAlwaysHidden);
        handleSystemUIVisibility();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    screen.orientation?.addEventListener('change', handleOrientationChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      screen.orientation?.removeEventListener('change', handleOrientationChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleSystemUIVisibility]);

  useEffect(() => {
    const customThemes = settings.globalReadSettings?.customThemes ?? [];
    customThemes.forEach((customTheme) => {
      applyCustomTheme(customTheme);
    });
    localStorage.setItem('customThemes', JSON.stringify(customThemes));
  }, [settings.globalReadSettings?.customThemes]);

  useEffect(() => {
    const colorScheme = isDarkMode ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', `${themeColor}-${colorScheme}`);
    document.documentElement.style.setProperty('color-scheme', colorScheme);
    document.documentElement.style.setProperty(
      '--overlayer-highlight-blend-mode',
      isDarkMode ? 'lighten' : 'normal',
    );
  }, [themeColor, isDarkMode]);
};
