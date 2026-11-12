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
import { useScreenBrightness } from '@/app/reader/hooks/useScreenBrightness';
import { useTransferQueue } from '@/hooks/useTransferQueue';
import { useReplicaPull } from '@/hooks/useReplicaPull';
import { eventDispatcher } from '@/utils/event';
import { interceptWindowOpen } from '@/utils/open';
import { mountAdditionalFonts } from '@/styles/fonts';
import { isTauriAppPlatform } from '@/services/environment';
import { getSysFontsList, setSystemUIVisibility } from '@/utils/bridge';
import { AboutWindow } from '@/components/AboutWindow';
import ReadingStatsDialog from '@/components/stats/ReadingStatsDialog';
import { VocabularyDialog } from '@/components/vocabulary/VocabularyDialog';
import { KeyboardShortcutsHelp } from '@/components/KeyboardShortcutsHelp';
import { UpdaterWindow } from '@/components/UpdaterWindow';
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
  // Only what the page renders or reacts to: it renders the whole reader, so a change to a book's
  // view state or to the sidebar must not re-render it (an opening book changes them many times).
  const settings = useSettingsStore((s) => s.settings);
  const { libraryLoaded } = useLibrary();
  const hoveredBookKey = useReaderStore((s) => s.hoveredBookKey);
  const isRoundedWindow = useThemeStore((s) => s.isRoundedWindow);

  const { onUpdateInsets } = useTheme({
    systemUIVisible: settings.alwaysShowStatusBar,
    appThemeColor: 'base-100',
    themeScope: 'reader',
  });
  useScreenWakeLock(settings.screenWakeLock, appService?.hasWindow, appService?.isIOSApp);
  useScreenBrightness();
  useTransferQueue(libraryLoaded, 5000);
  // Reader needs dictionaries for word-lookup, fonts for rendering, and
  // textures for the page background. Mounted here (not in the app-
  // router page wrapper) so the web pages-router entry at
  // `pages/reader/[ids].tsx` also gets the pull. Module-scoped dedup
  // means navigating between library and reader doesn't re-pull.
  useReplicaPull({ kinds: ['dictionary', 'font', 'texture'] });

  useEffect(() => {
    mountAdditionalFonts(document);
    interceptWindowOpen();
    if (isTauriAppPlatform()) {
      setTimeout(getSysFontsList, 3000);
    }
    initDayjs(getLocale());
  }, []);

  useEffect(() => {
    if (!appService?.isAndroidApp) return;
    const { acquireBackKeyInterception, releaseBackKeyInterception } =
      useDeviceControlStore.getState();
    acquireBackKeyInterception();
    return () => {
      releaseBackKeyInterception();
    };
  }, [appService?.isAndroidApp]);

  useEffect(() => {
    if (!appService?.isAndroidApp) return;
    // Reads the panels as they are when Back is pressed.
    const handleKeyDown = (event: CustomEvent) => {
      if (event.detail.keyName !== 'Back') return false;
      const { hoveredBookKey, setHoveredBookKey } = useReaderStore.getState();
      const { isSideBarVisible, isSideBarPinned, setSideBarVisible } = useSidebarStore.getState();
      const { isNotebookVisible, isNotebookPinned, setNotebookVisible } =
        useNotebookStore.getState();
      if (hoveredBookKey) {
        setHoveredBookKey('');
        (document.activeElement as HTMLElement)?.blur();
      } else if (isSideBarVisible && !isSideBarPinned) {
        setSideBarVisible(false);
      } else if (isNotebookVisible && !isNotebookPinned) {
        setNotebookVisible(false);
      } else {
        void eventDispatcher.dispatch('close-reader', { onClose: () => router.back() });
      }
      return true;
    };
    eventDispatcher.onSync('native-key-down', handleKeyDown);
    return () => {
      eventDispatcher.offSync('native-key-down', handleKeyDown);
    };
  }, [appService?.isAndroidApp, router]);

  useEffect(() => {
    if (!appService?.isMobileApp) return;
    const { isDarkMode, systemUIAlwaysHidden, showSystemUI, dismissSystemUI } =
      useThemeStore.getState();
    const systemUIVisible = !!hoveredBookKey || settings.alwaysShowStatusBar;
    const visible = !!(systemUIVisible && !systemUIAlwaysHidden);
    setSystemUIVisibility({ visible, darkMode: isDarkMode }).then(() => {
      // iPhone Duo's status bar carries a side inset of its own (its strip):
      // re-read it so the toolbar chrome clears the strip. Other devices never
      // re-read here.
      if (useThemeStore.getState().isIPhoneDuo) onUpdateInsets();
    });
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
        <ReadingStatsDialog />
        <VocabularyDialog />
        <KeyboardShortcutsHelp />
        <UpdaterWindow />
        <ProofreadRulesManager />
        <Toast />
      </Suspense>
    </div>
  ) : (
    <div className='full-height bg-base-100'></div>
  );
};

export default Reader;
