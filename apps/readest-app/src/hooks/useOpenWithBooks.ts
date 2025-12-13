import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { addPluginListener, PluginListener } from '@tauri-apps/api/core';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { getCurrentWindow, getAllWindows } from '@tauri-apps/api/window';
import { isTauriAppPlatform } from '@/services/environment';
import { navigateToLibrary, showLibraryWindow } from '@/utils/nav';

interface SingleInstancePayload {
  args: string[];
  cwd: string;
}

interface SharedIntentPayload {
  urls: string[];
}

export function useOpenWithBooks() {
  const router = useRouter();
  const { appService } = useEnv();
  const { setCheckOpenWithBooks } = useLibraryStore();
  const listenedOpenWithBooks = useRef(false);

  const isFirstWindow = async () => {
    const allWindows = await getAllWindows();
    const currentWindow = getCurrentWindow();
    const sortedWindows = allWindows.sort((a, b) => a.label.localeCompare(b.label));
    return sortedWindows[0]?.label === currentWindow.label;
  };

  const handleOpenWithFileUrl = async (urls: string[]) => {
    console.log('Handle Open with URL:', urls);
    const filePaths = [];
    for (let url of urls) {
      if (url.startsWith('file://')) {
        if (appService?.isIOSApp) {
          url = decodeURI(url);
        } else {
          url = decodeURI(url.replace('file://', ''));
        }
      }
      if (!/^(https?:|data:|blob:)/i.test(url)) {
        filePaths.push(url);
      }
    }
    if (filePaths.length > 0) {
      const settings = useSettingsStore.getState().settings;
      if (appService?.hasWindow && settings.openBookInNewWindow) {
        if (await isFirstWindow()) {
          showLibraryWindow(appService, filePaths);
        }
      } else {
        window.OPEN_WITH_FILES = filePaths;
        setCheckOpenWithBooks(true);
        navigateToLibrary(router, `reload=${Date.now()}`);
      }
    }
  };

  const initializeListeners = async () => {
    return await addPluginListener<SharedIntentPayload>(
      'native-bridge',
      'shared-intent',
      (payload) => {
        console.log('Received shared intent:', payload);
        const { urls } = payload;
        handleOpenWithFileUrl(urls);
      },
    );
  };

  useEffect(() => {
    if (!isTauriAppPlatform() || !appService) return;
    if (listenedOpenWithBooks.current) return;
    listenedOpenWithBooks.current = true;

    // For Windows/Linux deep link and macOS open-file event
    const unlistenDeeplink = getCurrentWindow().listen<SingleInstancePayload>(
      'single-instance',
      ({ event, payload }) => {
        console.log('Received deep link:', event, payload);
        const { args } = payload;
        if (args?.[1]) {
          handleOpenWithFileUrl([args[1]]);
        }
      },
    );

    // For Android "Share to Readest" intent
    let unlistenSharedIntent: Promise<PluginListener> | null = null;
    // FIXME: register/unregister plugin listeniner on iOS might cause app freeze for unknown reason
    // so we only register it on Android for now to support "Shared to Readest" feature
    if (appService?.isAndroidApp) {
      unlistenSharedIntent = initializeListeners();
    }

    // iOS Open with URL event
    const listenOpenWithFiles = async () => {
      return await onOpenUrl((urls) => {
        handleOpenWithFileUrl(urls);
      });
    };
    const unlistenOpenUrl = listenOpenWithFiles();
    return () => {
      unlistenDeeplink.then((f) => f());
      unlistenOpenUrl.then((f) => f());
      unlistenSharedIntent?.then((f) => f.unregister());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService]);
}
