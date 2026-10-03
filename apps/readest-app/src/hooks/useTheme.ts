import { useCallback, useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSafeAreaInsets } from './useSafeAreaInsets';
import { applyCustomTheme, Palette, ThemeScope } from '@/styles/themes';
import { getStatusBarHeight, setSystemUIVisibility } from '@/utils/bridge';
import { getOverlayerBlendMode } from '@/utils/style';
import { getOSPlatform } from '@/utils/misc';
import { isStatusBarHiddenBySystem } from '@/utils/insets';

type UseThemeProps = {
  systemUIVisible?: boolean;
  appThemeColor?: keyof Palette;
  /**
   * Which page's theme this route paints (issue #5945). Only the reader owns
   * its own scope; the library, OPDS, player, auth and user pages all share
   * the library's so no route paints a third look.
   */
  themeScope?: ThemeScope;
};

export const useTheme = ({
  systemUIVisible = true,
  appThemeColor = 'base-100',
  themeScope = 'library',
}: UseThemeProps = {}) => {
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const isEink = settings?.globalViewSettings?.isEink;
  const isColorEink = settings?.globalViewSettings?.isColorEink;
  const isBwEink = isEink && !isColorEink;
  const highlightOpacity = settings?.globalViewSettings?.highlightOpacity ?? 0.4;
  const {
    themeColor,
    isDarkMode,
    showSystemUI,
    dismissSystemUI,
    updateAppTheme,
    setStatusBarHeight,
    systemUIAlwaysHidden,
    isIPhoneDuo,
    setSystemUIAlwaysHidden,
    setThemeScope,
  } = useThemeStore();
  const { onUpdateInsets } = useSafeAreaInsets();

  // Point the store at this route's scope. `themeColor`/`isDarkMode` below
  // are the resolved values for whichever scope is active, so the data-theme
  // effect repaints for free when the user moves between library and reader.
  useEffect(() => {
    setThemeScope(themeScope);
  }, [themeScope, setThemeScope]);

  useEffect(() => {
    updateAppTheme(appThemeColor);
    if (appService?.isAndroidApp) {
      getStatusBarHeight().then((res) => {
        if (res.height && res.height > 0) {
          setStatusBarHeight(res.height / window.devicePixelRatio);
        }
      });
      handleSystemUIVisibility(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService?.isAndroidApp]);

  const handleSystemUIVisibility = useCallback(
    (updateInsets = false) => {
      if (!appService?.isMobileApp) return;

      // iPhone Duo's rule sets systemUIAlwaysHidden and calls this in one tick,
      // so read it fresh there; other devices keep the render's value.
      const state = useThemeStore.getState();
      const alwaysHidden = state.isIPhoneDuo ? state.systemUIAlwaysHidden : systemUIAlwaysHidden;
      const visible = !!(systemUIVisible && !alwaysHidden);
      if (visible) {
        showSystemUI();
      } else {
        dismissSystemUI();
      }
      setSystemUIVisibility({ visible, darkMode: isDarkMode }).then(() => {
        // iPhone Duo's status bar carries a side safe-area inset of its own
        // (its strip), so re-read the insets for the new state. Other iOS
        // devices never did, and a re-read would change their top inset.
        if (updateInsets || useThemeStore.getState().isIPhoneDuo) {
          onUpdateInsets();
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appService, isDarkMode, systemUIVisible],
  );

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
    // iPhone Duo: a status bar is hidden by the system only in a compact-height
    // window (its cover display, not the 669pt inner one). innerHeight can still
    // be stale when the orientation event fires; the resize that follows
    // re-evaluates, and covers folding between two landscape displays, which
    // fires no orientation event.
    const updateDuoStatusBarRule = () => {
      const hidden = isStatusBarHiddenBySystem(screen.orientation?.type, window.innerHeight);
      if (hidden === useThemeStore.getState().systemUIAlwaysHidden) return;
      setSystemUIAlwaysHidden(hidden);
      handleSystemUIVisibility();
    };
    const handleOrientationChange = () => {
      if (appService?.isIOSApp && getOSPlatform() === 'ios') {
        if (isIPhoneDuo) {
          updateDuoStatusBarRule();
          return;
        }
        // FIXME: This is a workaround for iPhone apps where the system UI is not visible in landscape mode
        // when the app is in fullscreen mode until we find a better solution to override the prefersStatusBarHidden
        // in the ViewController. Note that screen.orientation.type is not abailable in iOS before 16.4.
        const systemUIAlwaysHidden = screen.orientation?.type.includes('landscape');
        setSystemUIAlwaysHidden(systemUIAlwaysHidden);
        handleSystemUIVisibility();
      }
    };
    const handleResize = () => {
      if (isIPhoneDuo && appService?.isIOSApp && getOSPlatform() === 'ios') {
        updateDuoStatusBarRule();
      }
    };
    handleResize();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    screen.orientation?.addEventListener('change', handleOrientationChange);
    window.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      screen.orientation?.removeEventListener('change', handleOrientationChange);
      window.removeEventListener('resize', handleResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleSystemUIVisibility, isIPhoneDuo]);

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
    document.documentElement.style.setProperty('--scroll-bg-opacity', isBwEink ? '1.0' : '0.5');
    document.documentElement.style.setProperty(
      '--overlayer-highlight-opacity',
      isBwEink ? '1.0' : String(highlightOpacity),
    );
    // The global default assumes a page painted in the theme colors. Books that
    // keep their own page (PDFs, comics) override it per view in FoliateViewer.
    document.documentElement.style.setProperty(
      '--overlayer-highlight-blend-mode',
      getOverlayerBlendMode({ isDarkMode, isBwEink: !!isBwEink }),
    );
    document.documentElement.style.setProperty(
      '--bg-texture-blend-mode',
      isDarkMode ? 'lighten' : 'multiply',
    );
  }, [themeColor, isDarkMode, isBwEink, highlightOpacity]);

  return { onUpdateInsets };
};
