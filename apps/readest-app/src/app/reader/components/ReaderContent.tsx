'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { Book } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useAndroidGamepadConnection } from '@/hooks/useAndroidGamepadConnection';
import { useGamepad } from '@/hooks/useGamepad';
import { useTranslation } from '@/hooks/useTranslation';
import { SystemSettings } from '@/types/settings';
import { parseOpenWithFiles } from '@/helpers/openWith';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { UnlistenFn } from '@tauri-apps/api/event';
import { tauriHandleClose, tauriHandleOnCloseWindow } from '@/utils/window';
import { isTauriAppPlatform } from '@/services/environment';
import { splitLibraryOpenIds } from '@/utils/audiobook';
import { uniqueId } from '@/utils/misc';
import { throttle } from '@/utils/throttle';
import { eventDispatcher } from '@/utils/event';
import {
  closeReaderWindowOrGoToLibrary,
  ensureMainLibraryWindow,
  navigateToLibrary,
} from '@/utils/nav';
import { clearDiscordPresence } from '@/utils/discord';
import { BOOK_IDS_SEPARATOR } from '@/services/constants';
import { BookDetailModal } from '@/components/metadata';
import ShareBookDialog from '@/app/library/components/ShareBookDialog';
import { useAuth } from '@/context/AuthContext';
import { useNotebookDocumentStore } from '@/store/notebookDocumentStore';
import { canTransitionWithNotebookRecovery } from '../services/notebookDocumentCoordinator';
import {
  discardNotebookDocument,
  flushNotebookDocument,
} from '../hooks/useNotebookDocumentCoordinator';
import { writeTextToClipboard } from '@/utils/clipboard';

import useBooksManager from '../hooks/useBooksManager';
import useBookShortcuts from '../hooks/useBookShortcuts';
import Spinner from '@/components/Spinner';
import SideBar from './sidebar/SideBar';
import Notebook from './notebook/Notebook';
import LocalSendManager from '@/components/localsend/LocalSendManager';
import BooksGrid from './BooksGrid';
import SettingsDialog from '@/components/settings/SettingsDialog';
import AudiobookPairingDialog from './audiobook/AudiobookPairingDialog';
import HardcoverLinkDialog from './hardcover/HardcoverLinkDialog';
import ModalPortal from '@/components/ModalPortal';
import NotebookTransitionAlert from './notebook/NotebookTransitionAlert';

/**
 * How long the close path waits for the Notion flush before giving up on it.
 * `tauriHandleOnCloseWindow` preventDefaults the close and awaits our callback,
 * so an unbounded flush would leave the window unclosable on a dead network.
 */
const NOTION_FLUSH_TIMEOUT_MS = 3000;

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
  const [audiobookBookKey, setAudiobookBookKey] = useState<string | null>(null);
  const [hardcoverLinkBookKey, setHardcoverLinkBookKey] = useState<string | null>(null);
  const [shareDialogState, setShareDialogState] = useState<{
    book: Book;
    cfi: string | null;
  } | null>(null);
  const { user } = useAuth();
  const isInitiating = useRef(false);
  const [loading, setLoading] = useState(false);
  const [errorLoading, setErrorLoading] = useState(false);
  const [blockedNotebookBookKey, setBlockedNotebookBookKey] = useState<string | null>(null);
  const pendingNotebookTransitionRef = useRef<(() => Promise<void>) | null>(null);

  useBookShortcuts({ sideBarBookKey, bookKeys });
  const isAndroidApp = appService?.isAndroidApp === true;
  const androidGamepadConnected = useAndroidGamepadConnection(isAndroidApp);
  // Android's native bridge gates the Web Gamepad API so Chromium polls only
  // while a controller exists. Other platforms retain the existing behavior.
  useGamepad({
    enabled: appService !== null && (!isAndroidApp || androidGamepadConnected),
  });

  useEffect(() => {
    if (isInitiating.current) return;
    isInitiating.current = true;

    const pathname = window.location.pathname;
    const bookIds = ids || searchParams?.get('ids') || pathname.split('/reader/')[1] || '';
    const requestedIds = bookIds.split(BOOK_IDS_SEPARATOR).filter(Boolean);

    // A streaming audiobook has no document to load - a deep link naming one
    // (a stale bookmark, an "Open With" link, etc.) must not reach
    // initViewState/loadBookContent. A lone audiobook id redirects to the
    // player; one mixed into a multi-book deep link is just dropped, and the
    // rest of the reader opens normally. Same split the library's own open
    // paths use (src/utils/audiobook.ts), so a stray ABS id is handled
    // identically everywhere it could turn up.
    const { getBookByHash } = useLibraryStore.getState();
    const { audiobookHash, readerIds: initialIds } = splitLibraryOpenIds(
      requestedIds,
      getBookByHash,
    );
    if (audiobookHash) {
      router.replace(`/player?id=${audiobookHash}`);
      return;
    }
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
            callback: async () => {
              const service = await envConfig.getAppService();
              await closeReaderWindowOrGoToLibrary(service, router);
            },
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
    const handleManageAudiobook = (event: CustomEvent) => {
      const detail = event.detail as { bookKey?: string } | undefined;
      if (detail?.bookKey) setAudiobookBookKey(detail.bookKey);
    };
    const handleLinkHardcoverBook = (event: CustomEvent) => {
      const detail = event.detail as { bookKey?: string } | undefined;
      if (detail?.bookKey) setHardcoverLinkBookKey(detail.bookKey);
    };
    eventDispatcher.on('manage-audiobook', handleManageAudiobook);
    eventDispatcher.on('hardcover-link-book', handleLinkHardcoverBook);
    return () => {
      eventDispatcher.off('manage-audiobook', handleManageAudiobook);
      eventDispatcher.off('hardcover-link-book', handleLinkHardcoverBook);
    };
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
    const handleShareIntent = (event: CustomEvent) => {
      const detail = event.detail as { book: Book; cfi?: string | null } | undefined;
      if (!detail?.book) return;
      if (!user) {
        eventDispatcher.dispatch('toast', {
          type: 'info',
          message: _('Sign in to share books'),
          timeout: 2500,
        });
        return;
      }
      setShareDialogState({
        book: detail.book,
        cfi: detail.cfi ?? null,
      });
    };
    eventDispatcher.on('show-share-dialog', handleShareIntent);
    return () => {
      eventDispatcher.off('show-share-dialog', handleShareIntent);
    };
  }, [user, _]);

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
    if (appService?.hasWindow) {
      unlistenOnCloseWindow = tauriHandleOnCloseWindow(handleCloseBooks).catch((error) => {
        console.info('Failed to register close-window listener:', error);
        return () => {};
      });
    }
    window.addEventListener('beforeunload', handleCloseBooks);
    eventDispatcher.on('beforereload', handleCloseBooks);
    eventDispatcher.on('close-reader', handleCloseReaderToLibrary);
    eventDispatcher.on('quit-app', handleCloseBooks);
    return () => {
      window.removeEventListener('beforeunload', handleCloseBooks);
      eventDispatcher.off('beforereload', handleCloseBooks);
      eventDispatcher.off('close-reader', handleCloseReaderToLibrary);
      eventDispatcher.off('quit-app', handleCloseBooks);
      unlistenOnCloseWindow?.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKeys, appService?.hasWindow]);

  const saveBookConfig = async (bookKey: string) => {
    const config = getConfig(bookKey);
    const { book } = getBookData(bookKey) || {};
    const { isPrimary } = getViewState(bookKey) || {};
    if (isPrimary && book && config) {
      const settings = useSettingsStore.getState().settings;
      eventDispatcher.dispatch('sync-book-progress', { bookKey });
      eventDispatcher.dispatch('flush-kosync', { bookKey });
      // Persist locally before any remote flush. `beforeunload` and `quit-app`
      // can unload the document while a flush is still in flight, and losing
      // the reading position costs the user more than deferring a Notion push
      // (the push is idempotent and resumes on the next sync).
      await saveConfig(envConfig, bookKey, config, settings);
      await Promise.race([
        eventDispatcher.dispatch('flush-notion-sync', { bookKey }),
        new Promise<void>((resolve) => setTimeout(resolve, NOTION_FLUSH_TIMEOUT_MS)),
      ]);
    }
  };

  const saveConfigAndCloseBook = async (bookKey: string, keepTTSAlive = false) => {
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
    // Closes that keep the webview alive (back to library, Android back, pane
    // dismiss) let a live TTS session continue in the background;
    // webview-destroying closes (quit, window close, reload) hard-stop so the
    // media session and Android foreground service tear down with the page.
    eventDispatcher.dispatch(keepTTSAlive ? 'tts-close-book' : 'tts-stop', {
      bookKey,
    });
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

  const runNotebookTransition = async (
    keys: string[],
    transition: () => Promise<void>,
  ): Promise<boolean> => {
    for (const key of keys) {
      await flushNotebookDocument(key);
      const bookHash = key.split('-')[0]!;
      if (!canTransitionWithNotebookRecovery(bookHash)) {
        pendingNotebookTransitionRef.current = async () => {
          await runNotebookTransition(keys, transition);
        };
        setBlockedNotebookBookKey(key);
        return false;
      }
    }
    pendingNotebookTransitionRef.current = null;
    setBlockedNotebookBookKey(null);
    await transition();
    return true;
  };

  const closeBooks = async (keepTTSAlive: boolean) => {
    const currentSettings = useSettingsStore.getState().settings;
    await Promise.all(bookKeys.map((key) => saveConfigAndCloseBook(key, keepTTSAlive)));
    await saveSettings(envConfig, currentSettings);
  };

  const handleCloseReaderToLibrary = async (event: CustomEvent): Promise<void> => {
    const onClose = (event.detail as { onClose?: () => void } | undefined)?.onClose;
    await runNotebookTransition(bookKeys, async () => {
      await closeBooks(true);
      onClose?.();
    });
  };

  // Also wired directly to beforeunload/quit-app/window-close, which pass an
  // event object: only a literal `true` keeps TTS alive.
  const handleCloseBooks = throttle(async (keepTTSAlive?: unknown) => {
    await runNotebookTransition(bookKeys, () => closeBooks(keepTTSAlive === true));
  }, 200);

  const handleCloseBooksToLibrary = async () => {
    // SPA navigation in the main window (or on web) keeps the webview alive:
    // TTS may continue headless. Non-main Tauri windows close their webview
    // below, but their per-window TTS dies with the window either way.
    await runNotebookTransition(bookKeys, async () => {
      await closeBooks(true);
      if (isTauriAppPlatform()) {
        const currentWindow = getCurrentWindow();
        if (currentWindow.label === 'main') {
          navigateBackToLibrary();
        } else {
          if (appService) {
            await ensureMainLibraryWindow(appService);
          }
          await currentWindow.close();
        }
      } else {
        navigateBackToLibrary();
      }
    });
  };

  const handleCloseBook = async (bookKey: string) => {
    // Header X / pane close: an SPA-side close on web and the main window.
    // The Tauri reader-window branches below destroy their webview, which
    // takes the per-window TTS with it either way.
    await runNotebookTransition([bookKey], async () => {
      await saveConfigAndCloseBook(bookKey, true);
      if (sideBarBookKey === bookKey) {
        setSideBarBookKey(getNextBookKey(sideBarBookKey));
      }
      dismissBook(bookKey);
      if (bookKeys.filter((key) => key !== bookKey).length == 0) {
        const openWithFiles = (await parseOpenWithFiles(appService)) || [];
        if (appService?.hasWindow) {
          if (openWithFiles.length > 0) {
            void tauriHandleOnCloseWindow(handleCloseBooks).catch((error) => {
              console.info('Failed to register close-window listener:', error);
            });
            await tauriHandleClose();
            return;
          }
          const currentWindow = getCurrentWindow();
          if (currentWindow.label.startsWith('reader')) {
            await currentWindow.close();
            return;
          }
        }
        saveSettingsAndGoToLibrary();
      }
    });
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
    <div className='reader-content full-height flex'>
      <SideBar />
      <BooksGrid
        bookKeys={bookKeys}
        onCloseBook={handleCloseBook}
        onGoToLibrary={handleCloseBooksToLibrary}
      />
      {isSettingsDialogOpen && <SettingsDialog bookKey={settingsDialogBookKey} />}
      {audiobookBookKey && getBookData(audiobookBookKey)?.bookDoc && (
        <AudiobookPairingDialog
          bookKey={audiobookBookKey}
          bookDoc={getBookData(audiobookBookKey)!.bookDoc!}
          onClose={() => setAudiobookBookKey(null)}
        />
      )}
      {hardcoverLinkBookKey && (
        <HardcoverLinkDialog
          bookKey={hardcoverLinkBookKey}
          onClose={() => setHardcoverLinkBookKey(null)}
        />
      )}
      <Notebook />
      <LocalSendManager />
      {showDetailsBook && (
        <BookDetailModal
          isOpen={!!showDetailsBook}
          book={showDetailsBook}
          onClose={() => setShowDetailsBook(null)}
        />
      )}
      <ShareBookDialog
        isOpen={!!shareDialogState}
        book={shareDialogState?.book ?? null}
        cfi={shareDialogState?.cfi ?? null}
        onClose={() => setShareDialogState(null)}
      />
      {blockedNotebookBookKey && (
        <ModalPortal>
          <NotebookTransitionAlert
            onKeepOpen={() => {
              pendingNotebookTransitionRef.current = null;
              setBlockedNotebookBookKey(null);
            }}
            onCopy={() => {
              const bookHash = blockedNotebookBookKey.split('-')[0]!;
              const content = useNotebookDocumentStore.getState().sessions[bookHash]?.content ?? '';
              void writeTextToClipboard(content);
              eventDispatcher.dispatch('toast', {
                type: 'info',
                message: _('Notebook draft copied to clipboard'),
                timeout: 2000,
              });
            }}
            onDiscard={() => {
              const pending = pendingNotebookTransitionRef.current;
              discardNotebookDocument(blockedNotebookBookKey);
              setBlockedNotebookBookKey(null);
              if (pending) void pending();
            }}
            onRetry={() => {
              const pending = pendingNotebookTransitionRef.current;
              if (pending) void pending();
            }}
          />
        </ModalPortal>
      )}
    </div>
  );
};

export default ReaderContent;
