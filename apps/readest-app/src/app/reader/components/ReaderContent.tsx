'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { Book } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useGamepad } from '@/hooks/useGamepad';
import { useTranslation } from '@/hooks/useTranslation';
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
import { clearDiscordPresence } from '@/utils/discord';
import { BOOK_IDS_SEPARATOR } from '@/services/constants';
import { BookDetailModal } from '@/components/metadata';

import useBooksManager from '../hooks/useBooksManager';
import useBookShortcuts from '../hooks/useBookShortcuts';
import Spinner from '@/components/Spinner';
import SideBar from './sidebar/SideBar';
import Notebook from './notebook/Notebook';
import BooksGrid from './BooksGrid';
import SettingsDialog from '@/components/settings/SettingsDialog';

const ReaderContent: React.FC<{ ids?: string; settings: SystemSettings }> = ({ ids, settings }) => {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { envConfig, appService } = useEnv();
  const { bookKeys, dismissBook, getNextBookKey } = useBooksManager();
  const { sideBarBookKey, setSideBarBookKey } = useSidebarStore();
  const { saveSettings } = useSettingsStore();
  const { getConfig, getBookData, saveConfig } = useBookDataStore();
  const { getView, setBookKeys, getViewSettings } = useReaderStore();
  const { initViewState, getViewState, clearViewState } = useReaderStore();
  const { isSettingsDialogOpen, settingsDialogBookKey } = useSettingsStore();
  const [showDetailsBook, setShowDetailsBook] = useState<Book | null>(null);
  const isInitiating = useRef(false);
  const [loading, setLoading] = useState(false);
  const [errorLoading, setErrorLoading] = useState(false);

  useBookShortcuts({ sideBarBookKey, bookKeys });
  useGamepad();

  useEffect(() => {
    if (isInitiating.current) return;
    isInitiating.current = true;

    const pathname = window.location.pathname;
    const bookIds = ids || searchParams?.get('ids') || pathname.split('/reader/')[1] || '';
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
          setErrorLoading(true);
          eventDispatcher.dispatch('toast', {
            message: _('Unable to open book'),
            callback: () => navigateBackToLibrary(),
            timeout: 2000,
            type: 'error',
          });
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
      const lastOpenBooks = bookKeys.map((key) => key.split('-')[0]!);
      if (settings.lastOpenBooks?.toString() !== lastOpenBooks.toString()) {
        settings.lastOpenBooks = lastOpenBooks;
        saveSettings(envConfig, settings);
      }
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

    const viewState = getViewState(bookKey);
    if (viewState?.isPrimary && appService?.isDesktopApp) {
      await clearDiscordPresence(appService);
    }

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

  const navigateBackToLibrary = () => {
    navigateToLibrary(router, '', undefined, true);
  };

  const saveSettingsAndGoToLibrary = () => {
    saveSettings(envConfig, settings);
    navigateBackToLibrary();
  };

  const handleCloseBooks = throttle(async () => {
    const settings = useSettingsStore.getState().settings;
    await Promise.all(bookKeys.map(async (key) => await saveConfigAndCloseBook(key)));
    await saveSettings(envConfig, settings);
  }, 200);

  const handleCloseBooksToLibrary = () => {
    handleCloseBooks();
    if (isTauriAppPlatform()) {
      const currentWindow = getCurrentWindow();
      if (currentWindow.label === 'main') {
        navigateBackToLibrary();
      } else {
        currentWindow.close();
      }
    } else {
      navigateBackToLibrary();
    }
  };

  const handleCloseBook = async (bookKey: string) => {
    saveConfigAndCloseBook(bookKey);
    if (sideBarBookKey === bookKey) {
      setSideBarBookKey(getNextBookKey(sideBarBookKey));
    }
    dismissBook(bookKey);
    if (bookKeys.filter((key) => key !== bookKey).length == 0) {
      const openWithFiles = (await parseOpenWithFiles(appService)) || [];
      if (appService?.hasWindow) {
        if (openWithFiles.length > 0) {
          tauriHandleOnCloseWindow(handleCloseBooks);
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
      loading &&
      !errorLoading && (
        <div className='hero hero-content full-height'>
          <Spinner loading={true} />
        </div>
      )
    );
  }

  return (
    <div className='reader-content citadel-reader-shell full-height flex'>
      <SideBar />
      <BooksGrid
        bookKeys={bookKeys}
        onCloseBook={handleCloseBook}
        onGoToLibrary={handleCloseBooksToLibrary}
      />
      {isSettingsDialogOpen && <SettingsDialog bookKey={settingsDialogBookKey} />}
      <Notebook />
      {showDetailsBook && (
        <BookDetailModal
          isOpen={!!showDetailsBook}
          book={showDetailsBook}
          onClose={() => setShowDetailsBook(null)}
        />
      )}
      <style jsx global>{`
        @media (min-width: 640px) {
          .citadel-reader-shell {
            background:
              radial-gradient(circle at 50% 14%, rgba(138, 36, 28, 0.2), transparent 32%),
              linear-gradient(180deg, rgba(25, 13, 11, 0.98), rgba(10, 7, 6, 1));
          }

          .citadel-reader-shell .books-grid {
            position: relative;
            padding: 28px 24px 22px 16px;
            background: transparent;
          }

          .citadel-reader-shell .books-grid > [id^='gridcell-'] {
            position: relative;
            overflow: visible;
            margin: 8px 0;
            border-radius: 28px;
          }

          .citadel-reader-shell .books-grid > [id^='gridcell-']::before {
            content: '';
            position: absolute;
            inset: 12px 18px;
            border-radius: 30px;
            background:
              radial-gradient(circle at 50% 48%, rgba(131, 24, 17, 0.2), transparent 40%),
              linear-gradient(180deg, rgba(34, 19, 16, 0.94), rgba(14, 10, 9, 0.98));
            box-shadow:
              0 0 0 1px rgba(226, 194, 125, 0.5),
              0 0 0 2px rgba(112, 81, 37, 0.42),
              0 0 0 4px rgba(210, 169, 93, 0.24),
              inset 0 0 0 1px rgba(241, 215, 159, 0.06),
              0 30px 70px rgba(0, 0, 0, 0.42),
              0 0 44px rgba(131, 24, 17, 0.24);
            pointer-events: none;
            z-index: 0;
          }

          .citadel-reader-shell .books-grid > [id^='gridcell-']::after {
            content: '';
            position: absolute;
            inset: 42px 58px 62px;
            border-radius: 18px;
            background:
              radial-gradient(circle at 50% 50%, rgba(255, 243, 212, 0.03), transparent 42%),
              linear-gradient(
                90deg,
                rgba(0, 0, 0, 0) 46.5%,
                rgba(132, 96, 43, 0.08) 48.6%,
                rgba(224, 196, 127, 0.12) 49.3%,
                rgba(0, 0, 0, 0.34) 50%,
                rgba(224, 196, 127, 0.12) 50.7%,
                rgba(132, 96, 43, 0.08) 51.4%,
                rgba(0, 0, 0, 0) 53.5%
              ),
              linear-gradient(
                180deg,
                rgba(33, 24, 20, 0.88) 0%,
                rgba(24, 18, 15, 0.9) 40%,
                rgba(16, 11, 10, 0.94) 100%
              );
            box-shadow:
              inset 0 0 0 1px rgba(223, 189, 114, 0.22),
              inset 0 0 0 3px rgba(84, 62, 33, 0.32),
              inset 16px 0 24px rgba(0, 0, 0, 0.08),
              inset -16px 0 24px rgba(0, 0, 0, 0.08),
              inset 0 28px 46px rgba(255, 255, 255, 0.03),
              inset 0 -18px 30px rgba(0, 0, 0, 0.35);
            pointer-events: none;
            z-index: 0;
          }

          .citadel-reader-shell .books-grid > [id^='gridcell-'] > .foliate-viewer {
            top: 50px;
            right: 68px;
            bottom: 92px;
            left: 68px;
            height: auto;
            width: auto;
            border-radius: 16px;
            background:
              linear-gradient(
                90deg,
                rgba(221, 190, 117, 0.07) 0%,
                rgba(0, 0, 0, 0) 5%,
                rgba(0, 0, 0, 0) 95%,
                rgba(221, 190, 117, 0.07) 100%
              ),
              linear-gradient(180deg, rgba(33, 25, 21, 0.94), rgba(18, 13, 11, 0.97));
            box-shadow:
              inset 0 0 0 1px rgba(206, 171, 95, 0.14),
              inset 0 0 0 2px rgba(84, 61, 31, 0.18),
              inset 0 18px 24px rgba(255, 244, 220, 0.02),
              inset 0 -20px 30px rgba(0, 0, 0, 0.26),
              inset 0 0 34px rgba(0, 0, 0, 0.18);
            z-index: 1;
          }

          .citadel-reader-shell .books-grid > [id^='gridcell-'] > .header-bar,
          .citadel-reader-shell .books-grid > [id^='gridcell-'] > .footer-bar {
            left: 46px;
            right: 46px;
            width: auto;
          }

          .citadel-reader-shell .books-grid > [id^='gridcell-'] > .header-bar {
            top: 28px;
          }

          .citadel-reader-shell .books-grid > [id^='gridcell-'] > .footer-bar {
            bottom: 24px;
          }

          .citadel-reader-shell .books-grid > [id^='gridcell-'] > .page-nav-left {
            left: 52px;
          }

          .citadel-reader-shell .books-grid > [id^='gridcell-'] > .page-nav-right {
            right: 52px;
          }
        }
      `}</style>
    </div>
  );
};

export default ReaderContent;
