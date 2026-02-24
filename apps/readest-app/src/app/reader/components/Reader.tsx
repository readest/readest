'use client';

import clsx from 'clsx';
import * as React from 'react';
import { useEffect, Suspense } from 'react';
import { useRouter } from 'next/navigation';

import { useEnv } from '@/context/EnvContext';
import { useTheme } from '@/hooks/useTheme';
import { useLibrary } from '@/hooks/useLibrary';
import { useThemeStore } from '@/store/themeStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useNotebookStore } from '@/store/notebookStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useDeviceControlStore } from '@/store/deviceStore';
import { useScreenWakeLock } from '@/hooks/useScreenWakeLock';
import { useTransferQueue } from '@/hooks/useTransferQueue';
import { eventDispatcher } from '@/utils/event';
import { interceptWindowOpen } from '@/utils/open';
import { mountAdditionalFonts } from '@/styles/fonts';
import { isTauriAppPlatform } from '@/services/environment';
import { getSysFontsList, setSystemUIVisibility } from '@/utils/bridge';
import { AboutWindow } from '@/components/AboutWindow';
import { UpdaterWindow } from '@/components/UpdaterWindow';
import { KOSyncSettingsWindow } from './KOSyncSettings';
import { ReadwiseSettingsWindow } from './ReadwiseSettings';
import { ProofreadRulesManager } from './ProofreadRules';
import { Toast } from '@/components/Toast';
import { getLocale } from '@/utils/misc';
import { initDayjs } from '@/utils/time';
import ReaderContent from './ReaderContent';

/*
Z-Index Layering Guide:
---------------------------------
99 – Window Border (Linux only)
     • Ensures the border stays on top of all UI elements.
50 – Loading Progress / Toast Notifications / Dialogs / Popups
     • Includes Settings, About, Updater, KOSync dialogs and Annotation popups.
45 – Sidebar / Notebook (Unpinned)
     • Floats above the content but below global dialogs.
40 – TTS Bar
     • Mini controls for TTS playback on top of the TTS Control.
30 – TTS Control
     • Persistent TTS icon/panel.
20 – Menu / Sidebar / Notebook (Pinned)
     • Docked navigation or note views.
10 – Headerbar / Footbar / Ribbon
     • Top toolbar, bottom footbar and ribbon elements.
 0 – Base Content
     • Main reading area or background content.
*/

const Reader: React.FC<{ ids?: string }> = ({ ids }) => {
  const router = useRouter();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const { libraryLoaded } = useLibrary();
  const { sideBarBookKey } = useSidebarStore();
  const { hoveredBookKey } = useReaderStore();
  const { showSystemUI, dismissSystemUI } = useThemeStore();
  const { getScreenBrightness, setScreenBrightness } = useDeviceControlStore();
  const { acquireBackKeyInterception, releaseBackKeyInterception } = useDeviceControlStore();
  const { isSideBarVisible, isSideBarPinned } = useSidebarStore();
  const { getIsSideBarVisible, setSideBarVisible } = useSidebarStore();
  const { isNotebookVisible, isNotebookPinned } = useNotebookStore();
  const { getIsNotebookVisible, setNotebookVisible } = useNotebookStore();
  const { isDarkMode, systemUIAlwaysHidden, isRoundedWindow } = useThemeStore();

  useTheme({ systemUIVisible: settings.alwaysShowStatusBar, appThemeColor: 'base-100' });
  useScreenWakeLock(settings.screenWakeLock);
  useTransferQueue(libraryLoaded, 5000);

  useEffect(() => {
    mountAdditionalFonts(document);
    interceptWindowOpen();
    if (isTauriAppPlatform()) {
      setTimeout(getSysFontsList, 3000);
    }
    initDayjs(getLocale());
  }, []);

  useEffect(() => {
    const brightness = settings.screenBrightness;
    const autoBrightness = settings.autoScreenBrightness;
    if (appService?.hasScreenBrightness && !autoBrightness && brightness >= 0) {
      setScreenBrightness(brightness / 100);
    }
    let previousBrightness = -1;
    if (appService?.isIOSApp) {
      getScreenBrightness().then((b) => {
        previousBrightness = b;
      });
    }

    return () => {
      if (appService?.hasScreenBrightness && !autoBrightness) {
        setScreenBrightness(previousBrightness);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService]);

  const handleKeyDown = (event: CustomEvent) => {
    if (event.detail.keyName === 'Back') {
      if (getIsSideBarVisible() && !isSideBarPinned) {
        setSideBarVisible(false);
      } else if (getIsNotebookVisible() && !isNotebookPinned) {
        setNotebookVisible(false);
      } else {
        eventDispatcher.dispatch('close-reader');
        router.back();
      }
      return true;
    }
    return false;
  };

  useEffect(() => {
    if (!appService?.isAndroidApp) return;
    acquireBackKeyInterception();
    return () => {
      releaseBackKeyInterception();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService?.isAndroidApp]);

  useEffect(() => {
    if (appService?.isAndroidApp) {
      eventDispatcher.onSync('native-key-down', handleKeyDown);
    }
    return () => {
      if (appService?.isAndroidApp) {
        eventDispatcher.offSync('native-key-down', handleKeyDown);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    appService?.isAndroidApp,
    sideBarBookKey,
    isSideBarPinned,
    isSideBarVisible,
    isNotebookPinned,
    isNotebookVisible,
  ]);

  useEffect(() => {
    if (!appService?.isMobileApp) return;
    const systemUIVisible = !!hoveredBookKey || settings.alwaysShowStatusBar;
    const visible = !!(systemUIVisible && !systemUIAlwaysHidden);
    setSystemUIVisibility({ visible, darkMode: isDarkMode });
    if (visible) {
      showSystemUI();
    } else {
      dismissSystemUI();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoveredBookKey]);

  return libraryLoaded && settings.globalReadSettings ? (
    <div
      className={clsx(
        'reader-page bg-base-100 text-base-content full-height select-none overflow-hidden',
        appService?.hasRoundedWindow && isRoundedWindow && 'window-border rounded-window',
      )}
    >
      <Suspense fallback={<div className='full-height'></div>}>
        <ReaderContent ids={ids} settings={settings} />
        <AboutWindow />
        <UpdaterWindow />
        <KOSyncSettingsWindow />
        <ReadwiseSettingsWindow />
        <ProofreadRulesManager />
        <Toast />
      </Suspense>
    </div>
  ) : (
    <div className={clsx('full-height', !appService?.isLinuxApp && 'bg-base-100')}></div>
  );
};

export default Reader;
