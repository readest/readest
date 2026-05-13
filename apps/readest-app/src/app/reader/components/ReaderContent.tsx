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
  const [readerDebugLayers, setReaderDebugLayers] = useState(false);
  const [readerFrameIsolation, setReaderFrameIsolation] = useState(false);

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
    const enabled =
      process.env['NEXT_PUBLIC_READER_DEBUG_LAYERS'] === '1' ||
      process.env['READER_DEBUG_LAYERS'] === '1' ||
      searchParams?.get('readerDebugLayers') === '1' ||
      (typeof window !== 'undefined' && localStorage.getItem('READER_DEBUG_LAYERS') === '1');

    setReaderDebugLayers(enabled);
  }, [searchParams]);

  useEffect(() => {
    const enabled =
      process.env['NEXT_PUBLIC_READER_FRAME_ISOLATION'] === '1' ||
      process.env['READER_FRAME_ISOLATION'] === '1' ||
      searchParams?.get('readerFrameIsolation') === '1' ||
      (typeof window !== 'undefined' && localStorage.getItem('READER_FRAME_ISOLATION') === '1');

    setReaderFrameIsolation(enabled);
  }, [searchParams]);

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
    <div
      className={`reader-content citadel-reader-shell full-height relative flex ${readerDebugLayers ? 'reader-debug-layers' : ''} ${
        readerFrameIsolation ? 'reader-debug-frame-isolation' : ''
      }`}
    >
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
            border-radius: 3px;
          }

          .citadel-reader-shell .books-grid > [id^='gridcell-']::before {
            content: '';
            position: absolute;
            inset: 8px 14px;
            display: none;
            border-radius: 3px;
            background: transparent;
            box-shadow: none;
            pointer-events: none;
            z-index: 0;
          }

          .citadel-reader-shell .books-grid > [id^='gridcell-']::after {
            content: '';
            position: absolute;
            inset: 30px 36px 70px;
            display: none;
            border-radius: 2px;
            background: transparent;
            box-shadow: none;
            pointer-events: none;
            z-index: 0;
          }

          .citadel-reader-shell .books-grid > [id^='gridcell-'] > .foliate-viewer {
            top: 64px;
            right: 78px;
            bottom: 106px;
            left: 78px;
            height: auto;
            width: auto;
            border-radius: 3px;
            background:
              radial-gradient(ellipse 58% 74% at 50% 20%, rgba(108, 74, 48, 0.16), transparent 58%),
              radial-gradient(ellipse 84% 94% at 50% 56%, rgba(66, 44, 30, 0.16), transparent 70%),
              linear-gradient(
                90deg,
                rgba(16, 10, 8, 0.3) 0%,
                rgba(0, 0, 0, 0) 6%,
                rgba(0, 0, 0, 0) 94%,
                rgba(16, 10, 8, 0.3) 100%
              ),
              linear-gradient(180deg, rgb(23, 23, 20) 0%, rgb(17, 17, 15) 42%, rgb(11, 11, 10) 100%);
            box-shadow:
              inset 0 0 0 1px rgba(184, 132, 54, 0.48),
              inset 0 0 0 2px rgba(0, 0, 0, 0.5),
              inset 0 18px 38px rgba(255, 220, 150, 0.018),
              inset 0 0 16px rgba(0, 0, 0, 0.12),
              inset 0 -30px 52px rgba(0, 0, 0, 0.42);
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
            display: none;
            background: transparent;
            box-shadow: none;
          }

          .citadel-reader-shell .books-grid > [id^='gridcell-']::after {
            content: '';
            position: absolute;
            inset: 30px 36px 70px;
            display: none;
            border-radius: 3px;
            background: transparent;
            box-shadow: none;
            pointer-events: none;
            z-index: 0;
          }

          .citadel-reader-shell.reader-debug-layers .books-grid > [id^='gridcell-']::before {
            display: none !important;
            background: transparent !important;
            box-shadow: none !important;
            opacity: 1 !important;
            pointer-events: none !important;
          }

          .citadel-reader-shell.reader-debug-layers .books-grid > [id^='gridcell-']::after {
            display: none !important;
            background: transparent !important;
            box-shadow: none !important;
            opacity: 1 !important;
            pointer-events: none !important;
          }

          .citadel-reader-shell.reader-debug-frame-isolation.reader-debug-layers
            .books-grid
            > [id^='gridcell-'] {
            background: transparent !important;
            border-radius: 3px !important;
            box-shadow: none !important;
          }

          .citadel-reader-shell.reader-debug-frame-isolation.reader-debug-layers
            .books-grid
            > [id^='gridcell-']::before,
          .citadel-reader-shell.reader-debug-frame-isolation.reader-debug-layers
            .books-grid
            > [id^='gridcell-']::after {
            background: transparent !important;
          }

          .citadel-reader-shell.reader-debug-frame-isolation.reader-debug-layers
            .books-grid
            > [id^='gridcell-']::before {
            border-radius: 3px !important;
            box-shadow:
              inset 0 0 0 2px rgba(255, 48, 48, 0.96),
              0 0 3px rgba(255, 0, 0, 0.12) !important;
          }

          .citadel-reader-shell.reader-debug-frame-isolation.reader-debug-layers
            .books-grid
            > [id^='gridcell-']::after {
            border-radius: 2px !important;
            box-shadow:
              inset 0 0 0 2px rgba(0, 112, 255, 0.96),
              0 0 3px rgba(0, 96, 255, 0.1) !important;
          }

          .citadel-reader-shell.reader-debug-layers
            .books-grid
            > [id^='gridcell-']
            > .foliate-viewer {
            outline: 4px dashed rgba(255, 255, 255, 0.82);
            outline-offset: -10px;
          }

          .citadel-reader-shell.reader-debug-frame-isolation
            .books-grid
            > [id^='gridcell-']
            > .foliate-viewer {
            color: transparent !important;
            background: transparent !important;
            border-color: transparent !important;
            box-shadow: none !important;
            filter: none !important;
            opacity: 0 !important;
            outline: 0 !important;
            outline-offset: 0 !important;
            pointer-events: none !important;
            text-shadow: none !important;
            visibility: hidden !important;
          }

          .citadel-reader-shell.reader-debug-frame-isolation
            .books-grid
            > [id^='gridcell-']
            > .foliate-viewer
            iframe,
          .citadel-reader-shell.reader-debug-frame-isolation
            .books-grid
            > [id^='gridcell-']
            > .foliate-viewer
            webview,
          .citadel-reader-shell.reader-debug-frame-isolation
            .books-grid
            > [id^='gridcell-']
            > .foliate-viewer
            object,
          .citadel-reader-shell.reader-debug-frame-isolation
            .books-grid
            > [id^='gridcell-']
            > .foliate-viewer
            embed {
            opacity: 0 !important;
            visibility: hidden !important;
            pointer-events: none !important;
          }

          .citadel-reader-shell.reader-debug-frame-isolation
            .books-grid
            > [id^='gridcell-']
            > .foliate-viewer
            * {
            color: transparent !important;
            background: transparent !important;
            border-color: transparent !important;
            box-shadow: none !important;
            opacity: 0 !important;
            text-shadow: none !important;
            visibility: hidden !important;
          }
        }
      `}</style>
    </div>
  );
};

export default ReaderContent;
