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
import { useAudiobookSyncGeneration } from '../hooks/useAudiobookSyncGeneration';
import Spinner from '@/components/Spinner';
import SideBar from './sidebar/SideBar';
import Notebook from './notebook/Notebook';
import BooksGrid from './BooksGrid';
import ReaderTopBar from './ReaderTopBar';
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
  const { generateTranscriptFromAudiobook, generateSyncMapFromAttachedTranscript } =
    useAudiobookSyncGeneration({
      getView,
      appService,
      getConfig,
      setConfig: (key, partial) => useBookDataStore.getState().setConfig(key, partial),
    });

  const handleGenerateSync = async (bookHash: string) => {
    // Reader views are keyed as `${hash}-${uniqueId}`, but the modal only has
    // `book.hash`. Resolve the full key so getView() finds the Foliate instance.
    const viewKey = bookKeys.find((k) => k.split('-')[0] === bookHash) ?? bookHash;

    if (viewKey !== bookHash) {
      console.info('[ReaderContent] Resolved view key for sync generation', { bookHash, viewKey });
    } else {
      console.warn('[ReaderContent] No matching view key found for hash, generation may fail', {
        bookHash,
        availableKeys: bookKeys,
      });
    }

    const config = getConfig(bookHash);
    const audiobook = config?.audiobook;
    if (!audiobook) return { matched: 0, total: 0, error: 'No audiobook attached' };

    const result = audiobook.transcriptPath
      ? await generateSyncMapFromAttachedTranscript(viewKey)
      : await generateTranscriptFromAudiobook(viewKey);

    // Persist to disk so sync map survives restart
    if (!result.error && appService) {
      const updatedConfig = getConfig(bookHash);
      if (updatedConfig) {
        const bookData = getBookData(bookHash);
        if (bookData?.book) {
          appService.saveBookConfig(bookData.book, updatedConfig, settings).catch(() => {});
        }
      }
    }

    return result;
  };
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

    // Auto-generate sync when audiobook is loaded but no sync map exists
    const handleAutoGenerateSync = (event: CustomEvent) => {
      const { bookKey: targetKey } = event.detail as { bookKey: string };
      handleGenerateSync(targetKey).catch((err) => {
        console.warn('[ReaderContent] Auto-generate sync failed', err);
      });
    };
    eventDispatcher.on('audiobook-sync-auto-generate', handleAutoGenerateSync);

    return () => {
      eventDispatcher.offSync('show-book-details', handleShowBookDetails);
      eventDispatcher.off('audiobook-sync-auto-generate', handleAutoGenerateSync);
    };
    // handleGenerateSync is intentionally captured once — its deps are stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <div className='reader-content citadel-reader-shell full-height relative flex'>
      {/* Subtle texture overlay for the reader shell */}
      <div
        className='citadel-reader-texture pointer-events-none absolute inset-0 z-0'
        aria-hidden='true'
      />
      <SideBar />
      <BooksGrid bookKeys={bookKeys} onGoToLibrary={handleCloseBooksToLibrary} />
      <ReaderTopBar
        bookKey={sideBarBookKey || bookKeys[0] || ''}
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
          onGenerateSync={handleGenerateSync}
        />
      )}
      <style jsx global>{`
        .citadel-reader-texture {
          opacity: 0.12;
          mix-blend-mode: overlay;
          background-image: url('/citadel/textures/citadel_texture_overlay_03_dark_dust_scratches_black_alpha.png');
          background-repeat: repeat;
          background-size: 200px 200px;
        }

        @media (min-width: 640px) {
          .citadel-reader-shell {
            background:
              radial-gradient(circle at 50% 12%, rgba(122, 32, 24, 0.22), transparent 30%),
              radial-gradient(circle at 16% 56%, rgba(96, 18, 14, 0.14), transparent 22%),
              radial-gradient(circle at 84% 56%, rgba(96, 18, 14, 0.14), transparent 22%),
              linear-gradient(180deg, rgba(28, 16, 13, 0.98), rgba(11, 8, 7, 1));
          }

          .citadel-reader-shell .books-grid {
            position: relative;
            padding: 24px 26px 22px 18px;
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
            inset: 8px 14px;
            border-radius: 34px;
            background:
              radial-gradient(circle at 50% 10%, rgba(214, 167, 87, 0.04), transparent 16%),
              radial-gradient(circle at 50% 112%, rgba(94, 18, 14, 0.2), transparent 32%),
              linear-gradient(180deg, rgba(38, 22, 18, 0.96), rgba(16, 11, 10, 0.99));
            box-shadow:
              inset 0 0 0 1px rgba(241, 215, 159, 0.03),
              inset 0 22px 30px rgba(255, 237, 193, 0.012),
              inset 0 -26px 40px rgba(0, 0, 0, 0.2),
              0 28px 64px rgba(0, 0, 0, 0.42),
              0 0 38px rgba(120, 24, 18, 0.14);
            pointer-events: none;
            z-index: 0;
          }

          .citadel-reader-shell .books-grid > [id^='gridcell-']::after {
            content: '';
            position: absolute;
            inset: 18px 22px 74px;
            border-radius: 28px;
            background:
              radial-gradient(circle at 50% 0%, rgba(176, 124, 58, 0.06), transparent 20%),
              linear-gradient(180deg, rgba(44, 27, 21, 0.48), rgba(14, 10, 9, 0.1));
            box-shadow:
              inset 0 0 0 1px rgba(82, 49, 33, 0.84),
              inset 0 0 0 2px rgba(166, 118, 56, 0.16),
              inset 0 0 0 10px rgba(7, 5, 4, 0.52),
              inset 0 24px 38px rgba(255, 224, 176, 0.02),
              inset 0 -38px 54px rgba(0, 0, 0, 0.4);
            pointer-events: none;
            z-index: 0;
          }

          .citadel-reader-shell .books-grid > [id^='gridcell-'] > .foliate-viewer {
            top: 54px;
            right: 64px;
            bottom: 92px;
            left: 64px;
            height: auto;
            width: auto;
            border-radius: 18px;
            background:
              radial-gradient(ellipse 58% 74% at 50% 20%, rgba(118, 80, 50, 0.17), transparent 58%),
              radial-gradient(ellipse 84% 94% at 50% 56%, rgba(72, 46, 30, 0.16), transparent 70%),
              linear-gradient(
                90deg,
                rgba(16, 10, 8, 0.28) 0%,
                rgba(0, 0, 0, 0) 6%,
                rgba(0, 0, 0, 0) 94%,
                rgba(16, 10, 8, 0.28) 100%
              ),
              linear-gradient(180deg, rgb(24, 24, 21) 0%, rgb(18, 18, 16) 42%, rgb(12, 12, 11) 100%);
            box-shadow:
              inset 0 0 0 1px rgba(184, 132, 54, 0.58),
              inset 0 0 0 3px rgba(0, 0, 0, 0.48),
              inset 0 0 0 4px rgba(214, 172, 94, 0.14),
              inset 0 22px 48px rgba(255, 220, 150, 0.025),
              inset 0 -34px 60px rgba(0, 0, 0, 0.42),
              0 10px 26px rgba(0, 0, 0, 0.35);
            z-index: 2;
          }

          .citadel-reader-shell .books-grid > [id^='gridcell-'] > .header-bar,
          .citadel-reader-shell .books-grid > [id^='gridcell-'] > .footer-bar {
            left: 22px;
            right: 22px;
            width: auto;
          }

          .citadel-reader-shell .books-grid > [id^='gridcell-'] > .header-bar {
            top: 18px;
          }

          .citadel-reader-shell .books-grid > [id^='gridcell-'] > .footer-bar {
            bottom: 12px;
          }

          .citadel-reader-shell .books-grid > [id^='gridcell-'] > .page-nav-left {
            left: 52px;
          }

          .citadel-reader-shell .books-grid > [id^='gridcell-'] > .page-nav-right {
            right: 52px;
          }

          .citadel-reader-shell
            .books-grid
            > [id^='gridcell-']
            > .sectioninfo:not(.writing-vertical-rl) {
            display: none;
          }

          .citadel-reader-shell
            .books-grid
            > [id^='gridcell-']
            > .progressinfo:not(.writing-vertical-rl) {
            display: none;
          }

          .citadel-reader-shell .books-grid > [id^='gridcell-']::before {
            background:
              radial-gradient(circle at 50% 10%, rgba(190, 146, 72, 0.06), transparent 20%),
              radial-gradient(circle at 0% 50%, rgba(120, 28, 18, 0.14), transparent 24%),
              radial-gradient(circle at 100% 50%, rgba(120, 28, 18, 0.14), transparent 24%),
              linear-gradient(180deg, rgb(22, 13, 10), rgb(9, 6, 5));
            box-shadow:
              inset 0 0 0 1px rgba(190, 146, 72, 0.7),
              inset 0 0 0 4px rgba(0, 0, 0, 0.55),
              inset 0 0 0 5px rgba(214, 172, 94, 0.2),
              inset 0 0 48px rgba(120, 28, 18, 0.16),
              inset 0 20px 28px rgba(255, 237, 193, 0.014),
              inset 0 -28px 40px rgba(0, 0, 0, 0.24),
              0 22px 52px rgba(0, 0, 0, 0.48);
          }

          .citadel-reader-shell .books-grid > [id^='gridcell-']::after {
            content: '';
            position: absolute;
            inset: 18px 22px 74px;
            border-radius: 28px;
            background:
              radial-gradient(circle at 50% 0%, rgba(176, 124, 58, 0.06), transparent 20%),
              linear-gradient(180deg, rgba(44, 27, 21, 0.48), rgba(14, 10, 9, 0.1));
            box-shadow:
              inset 0 0 0 1px rgba(82, 49, 33, 0.84),
              inset 0 0 0 2px rgba(166, 118, 56, 0.16),
              inset 0 0 0 10px rgba(7, 5, 4, 0.52),
              inset 0 24px 38px rgba(255, 224, 176, 0.02),
              inset 0 -38px 54px rgba(0, 0, 0, 0.4);
            pointer-events: none;
            z-index: 0;
          }
        }
      `}</style>
    </div>
  );
};

export default ReaderContent;
