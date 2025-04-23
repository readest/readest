'use client';

import clsx from 'clsx';
import * as React from 'react';
import { useEffect, Suspense, useRef, useState } from 'react';

import { useEnv } from '@/context/EnvContext';
import { useTheme } from '@/hooks/useTheme';
import { useThemeStore } from '@/store/themeStore';
import { useReaderStore } from '@/store/readerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useScreenWakeLock } from '@/hooks/useScreenWakeLock';
import { setSystemUIVisibility } from '@/utils/bridge';
import { AboutWindow } from '@/components/AboutWindow';
import { UpdaterWindow } from '@/components/UpdaterWindow';
import { Toast } from '@/components/Toast';
import ReaderContent from './ReaderContent';

const Reader: React.FC<{ ids?: string }> = ({ ids }) => {
  const { envConfig, appService } = useEnv();
  const { settings, setSettings } = useSettingsStore();
  const { isDarkMode, showSystemUI, dismissSystemUI } = useThemeStore();
  const { hoveredBookKey } = useReaderStore();
  const { isSideBarVisible } = useSidebarStore();
  const { setLibrary } = useLibraryStore();
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const isInitiating = useRef(false);

  useTheme({ systemUIVisible: false, appThemeColor: 'base-100' });
  useScreenWakeLock(settings.screenWakeLock);

  useEffect(() => {
    if (isInitiating.current) return;
    isInitiating.current = true;
    const initLibrary = async () => {
      const appService = await envConfig.getAppService();
      const settings = await appService.loadSettings();
      setSettings(settings);
      setLibrary(await appService.loadLibraryBooks());
      setLibraryLoaded(true);
    };

    initLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!appService?.isMobile) return;
    const systemUIVisible = !!hoveredBookKey;
    setSystemUIVisibility({ visible: systemUIVisible, darkMode: isDarkMode });
    if (systemUIVisible) {
      showSystemUI();
    } else {
      dismissSystemUI();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoveredBookKey]);

  return (
    libraryLoaded &&
    settings.globalReadSettings && (
      <div
        className={clsx(
          `reader-page bg-base-100 text-base-content select-none`,
          !isSideBarVisible && appService?.hasRoundedWindow && 'rounded-window',
        )}
      >
        <Suspense>
          <ReaderContent ids={ids} settings={settings} />
          <AboutWindow />
          {appService?.isAndroidApp && <UpdaterWindow />}
          <Toast />
        </Suspense>
      </div>
    )
  );
};

export default Reader;
