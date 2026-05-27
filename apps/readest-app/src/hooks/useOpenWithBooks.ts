import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getAllWindows, getCurrentWindow } from '@tauri-apps/api/window';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { isTauriAppPlatform } from '@/services/environment';
import { navigateToLibrary, showLibraryWindow } from '@/utils/nav';
import { eventDispatcher } from '@/utils/event';

/**
 * Handle "Open with Readest" file imports. Consumes the `app-incoming-url`
 * event published by `useAppUrlIngress`, filters URLs that look like a file
 * (file://, content://, or plain path), and routes them to the library.
 *
 * Non-file URL shapes (https, readest://, data:, blob:) are skipped here
 * — other consumers (e.g. `useOpenAnnotationLink`) act on those.
 *
 * Mount this hook alongside `useAppUrlIngress` so the ingress dispatcher is
 * actually running when URLs arrive.
 */
export function useOpenWithBooks() {
  const router = useRouter();
  const { appService } = useEnv();
  const { setCheckOpenWithBooks } = useLibraryStore();

  useEffect(() => {
    if (!isTauriAppPlatform() || !appService) return;

    const isFirstWindow = async () => {
      const allWindows = await getAllWindows();
      const currentWindow = getCurrentWindow();
      const sortedWindows = allWindows.sort((a, b) => a.label.localeCompare(b.label));
      return sortedWindows[0]?.label === currentWindow.label;
    };

    const handle = async (urls: string[]) => {
      const filePaths: string[] = [];
      for (let url of urls) {
        if (url.startsWith('file://')) {
          url = appService?.isIOSApp ? decodeURI(url) : decodeURI(url.replace('file://', ''));
        }
        if (!/^(https?:|data:|blob:|readest:)/i.test(url)) {
          filePaths.push(url);
        }
      }
      if (filePaths.length === 0) return;

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
    };

    const onIncoming = (event: CustomEvent) => {
      const { urls } = event.detail as { urls: string[] };
      handle(urls);
    };
    eventDispatcher.on('app-incoming-url', onIncoming);

    return () => {
      eventDispatcher.off('app-incoming-url', onIncoming);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService]);
}
