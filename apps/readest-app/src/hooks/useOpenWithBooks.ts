import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriAppPlatform } from '@/services/environment';
import { useLibraryStore } from '@/store/libraryStore';
import { navigateToLibrary } from '@/utils/nav';

interface SingleInstancePayload {
  args: string[];
  cwd: string;
}

export function useOpenWithBooks() {
  const router = useRouter();
  const { setCheckOpenWithBooks } = useLibraryStore();
  const listenedOpenWithBooks = useRef(false);

  const handleOpenWithFileUrl = (url: string) => {
    console.log('Handle Open with URL:', url);
    let filePath = url;
    if (filePath.startsWith('file://')) {
      filePath = decodeURI(filePath.replace('file://', ''));
    }
    if (!/^(https?:|data:|blob:)/i.test(filePath)) {
      window.OPEN_WITH_FILES = [filePath];
      setCheckOpenWithBooks(true);
      navigateToLibrary(router, `reload=${Date.now()}`);
    }
  };

  useEffect(() => {
    if (!isTauriAppPlatform()) return;
    if (listenedOpenWithBooks.current) return;
    listenedOpenWithBooks.current = true;

    const unlistenDeeplink = getCurrentWindow().listen('single-instance', ({ event, payload }) => {
      console.log('Received deep link:', event, payload);
      const { args } = payload as SingleInstancePayload;
      if (args?.[1]) {
        handleOpenWithFileUrl(args[1]);
      }
    });
    const listenOpenWithFiles = async () => {
      return await onOpenUrl((urls) => {
        urls.forEach((url) => {
          handleOpenWithFileUrl(url);
        });
      });
    };
    const unlistenOpenUrl = listenOpenWithFiles();
    return () => {
      unlistenDeeplink.then((f) => f());
      unlistenOpenUrl.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
