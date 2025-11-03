'use client';

import '@/utils/polyfill';
import i18n from '@/i18n/i18n';
import { useEffect } from 'react';
import { IconContext } from 'react-icons';
import { AuthProvider } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { CSPostHogProvider } from '@/context/PHContext';
import { SyncProvider } from '@/context/SyncContext';
import { initSystemThemeListener, loadDataTheme } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useDeviceControlStore } from '@/store/deviceStore';
import { useSafeAreaInsets } from '@/hooks/useSafeAreaInsets';
import { useDefaultIconSize } from '@/hooks/useResponsiveSize';
import { useBackgroundTexture } from '@/hooks/useBackgroundTexture';
import { useEinkMode } from '@/hooks/useEinkMode';
import { getLocale } from '@/utils/misc';
import { getDirFromUILanguage } from '@/utils/rtl';

const Providers = ({ children }: { children: React.ReactNode }) => {
  const { envConfig, appService } = useEnv();
  const { applyUILanguage } = useSettingsStore();
  const { setScreenBrightness } = useDeviceControlStore();
  const { applyBackgroundTexture } = useBackgroundTexture();
  const { applyEinkMode } = useEinkMode();
  const iconSize = useDefaultIconSize();
  useSafeAreaInsets(); // Initialize safe area insets

  useEffect(() => {
    const handlerLanguageChanged = (lng: string) => {
      document.documentElement.lang = lng;
      // Set RTL class on document for targeted styling without affecting layout
      const dir = getDirFromUILanguage();
      if (dir === 'rtl') {
        document.documentElement.classList.add('ui-rtl');
      } else {
        document.documentElement.classList.remove('ui-rtl');
      }
    };

    const locale = getLocale();
    handlerLanguageChanged(locale);
    i18n.on('languageChanged', handlerLanguageChanged);
    return () => {
      i18n.off('languageChanged', handlerLanguageChanged);
    };
  }, []);

  useEffect(() => {
    loadDataTheme();
    if (appService) {
      initSystemThemeListener(appService);
      appService.loadSettings().then((settings) => {
        const globalViewSettings = settings.globalViewSettings;
        applyUILanguage(globalViewSettings.uiLanguage);
        const brightness = settings.screenBrightness;
        const autoBrightness = settings.autoScreenBrightness;
        if (appService.hasScreenBrightness && !autoBrightness && brightness >= 0) {
          setScreenBrightness(brightness / 100);
        }
        applyBackgroundTexture(envConfig, globalViewSettings);
        if (globalViewSettings.isEink) {
          applyEinkMode(true);
        }
      });
    }
  }, [
    envConfig,
    appService,
    applyUILanguage,
    setScreenBrightness,
    applyBackgroundTexture,
    applyEinkMode,
  ]);

  // Make sure appService is available in all children components
  if (!appService) return;

  return (
    <CSPostHogProvider>
      <AuthProvider>
        <IconContext.Provider value={{ size: `${iconSize}px` }}>
          <SyncProvider>{children}</SyncProvider>
        </IconContext.Provider>
      </AuthProvider>
    </CSPostHogProvider>
  );
};

export default Providers;
