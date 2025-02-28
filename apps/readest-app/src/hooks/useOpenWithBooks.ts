import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { isTauriAppPlatform } from '@/services/environment';
import { useLibraryStore } from '@/store/libraryStore';
import { navigateToLibrary } from '@/utils/nav';

export function useOpenWithBooks() {
  const router = useRouter();
  const { setCheckOpenWithBooks } = useLibraryStore();
  const listenedOpenWithBooks = useRef(false);

  const handleOpenWithFileUrl = (url: string) => {
    let filePath = url;
    if (filePath.startsWith('file://')) {
      filePath = decodeURI(filePath.replace('file://', ''));
    }
    if (filePath.startsWith('/')) {
      window.OPEN_WITH_FILES = [filePath];
      setCheckOpenWithBooks(true);
      navigateToLibrary(router, `reload=${Date.now()}`);
    }
  };

  useEffect(() => {
    if (!isTauriAppPlatform()) return;
    if (listenedOpenWithBooks.current) return;
    listenedOpenWithBooks.current = true;

    const listenOpenWithFiles = async () => {
      return await onOpenUrl((urls) => {
        urls.forEach((url) => {
          handleOpenWithFileUrl(url);
        });
      });
    };

    const unlisten = listenOpenWithFiles();
    return () => {
      unlisten.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
