'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { Book } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { SystemSettings } from '@/types/settings';
import { parseOpenWithFiles } from '@/helpers/openWith';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { UnlistenFn } from '@tauri-apps/api/event';
import { tauriHandleClose, tauriHandleOnCloseWindow } from '@/utils/window';
import { isTauriAppPlatform } from '@/services/environment';
import { uniqueId } from '@/utils/misc';
import { throttle } from '@/utils/throttle';
import { eventDispatcher } from '@/utils/event';
import { navigateToLibrary } from '@/utils/nav';
import { BOOK_IDS_SEPARATOR } from '@/services/constants';
import { BookDetailModal } from '@/components/metadata';

import useBooksManager from '../hooks/useBooksManager';
import useBookShortcuts from '../hooks/useBookShortcuts';
import Spinner from '@/components/Spinner';
import SideBar from './sidebar/SideBar';
import Notebook from './notebook/Notebook';
import BooksGrid from './BooksGrid';

const ReaderContent: React.FC<{ ids?: string; settings: SystemSettings }> = ({ ids, settings }) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { envConfig, appService } = useEnv();
  const { bookKeys, dismissBook, getNextBookKey } = useBooksManager();
  const { sideBarBookKey, setSideBarBookKey } = useSidebarStore();
  const { saveSettings } = useSettingsStore();
  const { getConfig, getBookData, saveConfig } = useBookDataStore();
  const { getView, setBookKeys, getViewSettings } = useReaderStore();
  const { initViewState, getViewState, clearViewState } = useReaderStore();
  const [showDetailsBook, setShowDetailsBook] = useState<Book | null>(null);
  const isInitiating = useRef(false);
  const [loading, setLoading] = useState(false);

  useBookShortcuts({ sideBarBookKey, bookKeys });

  useEffect(() => {
    if (isInitiating.current) return;
    isInitiating.current = true;

    const bookIds = ids || searchParams?.get('ids') || '';
    const initialIds = bookIds.split(BOOK_IDS_SEPARATOR).filter(Boolean);
    const initialBookKeys = initialIds.map((id) => `${id}-${uniqueId()}`);
    setBookKeys(initialBookKeys);
    const uniqueIds = new Set<string>();
    console.log('Initialize books', initialBookKeys);
    initialBookKeys.forEach((key, index) => {
      const id = key.split('-')[0]!;
      const isPrimary = !uniqueIds.has(id);
      uniqueIds.add(id);
      if (!getViewState(key)) {
        initViewState(envConfig, id, key, isPrimary).catch((error) => {
          console.log('Error initializing book', key, error);
        });
        if (index === 0) setSideBarBookKey(key);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleShowBookDetails = (event: CustomEvent) => {
      setShowDetailsBook(event.detail as Book);
      return true;
    };
    eventDispatcher.onSync('show-book-details', handleShowBookDetails);

    return () => {
      eventDispatcher.offSync('show-book-details', handleShowBookDetails);
    };
  }, []);

  useEffect(() => {
    if (bookKeys && bookKeys.length > 0) {
      const settings = useSettingsStore.getState().settings;
      settings.lastOpenBooks = bookKeys.map((key) => key.split('-')[0]!);
      saveSettings(envConfig, settings);
    }

    let unlistenOnCloseWindow: Promise<UnlistenFn>;
    if (isTauriAppPlatform()) {
      unlistenOnCloseWindow = tauriHandleOnCloseWindow(handleCloseBooks);
    }
    window.addEventListener('beforeunload', handleCloseBooks);
    eventDispatcher.on('beforereload', handleCloseBooks);
    eventDispatcher.on('close-reader', handleCloseBooks);
    eventDispatcher.on('quit-app', handleCloseBooks);
    return () => {
      window.removeEventListener('beforeunload', handleCloseBooks);
      eventDispatcher.off('beforereload', handleCloseBooks);
      eventDispatcher.off('close-reader', handleCloseBooks);
      eventDispatcher.off('quit-app', handleCloseBooks);
      unlistenOnCloseWindow?.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKeys]);

  const saveBookConfig = async (bookKey: string) => {
    const config = getConfig(bookKey);
    const { book } = getBookData(bookKey) || {};
    const { isPrimary } = getViewState(bookKey) || {};
    if (isPrimary && book && config) {
      const settings = useSettingsStore.getState().settings;
      eventDispatcher.dispatch('sync-book-progress', { bookKey });
      eventDispatcher.dispatch('flush-kosync', { bookKey });
      await saveConfig(envConfig, bookKey, config, settings);
    }
  };

  const saveConfigAndCloseBook = async (bookKey: string) => {
    console.log('Closing book', bookKey);
    try {
      getView(bookKey)?.close();
      getView(bookKey)?.remove();
    } catch {
      console.info('Error closing book', bookKey);
    }
    eventDispatcher.dispatch('tts-stop', { bookKey });
    await saveBookConfig(bookKey);
    clearViewState(bookKey);
  };

  const saveSettingsAndGoToLibrary = () => {
    saveSettings(envConfig, settings);
    navigateToLibrary(router);
  };

  const handleCloseBooks = throttle(async () => {
    const settings = useSettingsStore.getState().settings;
    await Promise.all(bookKeys.map((key) => saveConfigAndCloseBook(key)));
    await saveSettings(envConfig, settings);
  }, 200);

  const handleCloseBooksToLibrary = () => {
    handleCloseBooks();
    if (isTauriAppPlatform()) {
      const currentWindow = getCurrentWindow();
      if (currentWindow.label === 'main') {
        navigateToLibrary(router);
      } else {
        currentWindow.close();
      }
    } else {
      navigateToLibrary(router);
    }
  };

  const handleCloseBook = async (bookKey: string) => {
    saveConfigAndCloseBook(bookKey);
    if (sideBarBookKey === bookKey) {
      setSideBarBookKey(getNextBookKey(sideBarBookKey));
    }
    dismissBook(bookKey);
    if (bookKeys.filter((key) => key !== bookKey).length == 0) {
      const openWithFiles = (await parseOpenWithFiles()) || [];
      if (appService?.hasWindow) {
        if (openWithFiles.length > 0) {
          return await tauriHandleClose();
        }
        const currentWindow = getCurrentWindow();
        if (currentWindow.label.startsWith('reader')) {
          return await currentWindow.close();
        }
      }
      saveSettingsAndGoToLibrary();
    }
  };

  if (!bookKeys || bookKeys.length === 0) return null;
  const bookData = getBookData(bookKeys[0]!);
  const viewSettings = getViewSettings(bookKeys[0]!);
  if (!bookData || !bookData.book || !bookData.bookDoc || !viewSettings) {
    setTimeout(() => setLoading(true), 200);
    return (
      loading && (
        <div className='hero hero-content h-[100vh]'>
          <Spinner loading={true} />
        </div>
      )
    );
  }

  return (
    <div className='reader-content flex h-[100vh]'>
      <SideBar onGoToLibrary={handleCloseBooksToLibrary} />
      <BooksGrid bookKeys={bookKeys} onCloseBook={handleCloseBook} />
      <Notebook />
      {showDetailsBook && (
        <BookDetailModal
          isOpen={!!showDetailsBook}
          book={showDetailsBook}
          onClose={() => setShowDetailsBook(null)}
        />
      )}
    </div>
  );
};

export default ReaderContent;
