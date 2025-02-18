'use client';

import clsx from 'clsx';
import * as React from 'react';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { Book } from '@/types/book';
import { AppService } from '@/types/system';
import { navigateToLogin, navigateToReader } from '@/utils/nav';
import { getBaseFilename, listFormater } from '@/utils/book';
import { eventDispatcher } from '@/utils/event';
import { ProgressPayload } from '@/utils/transfer';
import { throttle } from '@/utils/throttle';
import { parseOpenWithFiles } from '@/helpers/cli';
import { isTauriAppPlatform, hasUpdater } from '@/services/environment';
import { checkForAppUpdates } from '@/helpers/updater';
import { FILE_ACCEPT_FORMATS, SUPPORTED_FILE_EXTS } from '@/services/constants';

import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useDemoBooks } from './hooks/useDemoBooks';
import { useBooksSync } from './hooks/useBooksSync';

import { AboutWindow } from '@/components/AboutWindow';
import { Toast } from '@/components/Toast';
import Spinner from '@/components/Spinner';
import LibraryHeader from './components/LibraryHeader';
import Bookshelf from './components/Bookshelf';
import BookDetailModal from '@/components/BookDetailModal';
import { useScreenWakeLock } from '@/hooks/useScreenWakeLock';

const LibraryPage = () => {
  const router = useRouter();
  const { envConfig, appService } = useEnv();
  const { token, user } = useAuth();
  const {
    library: libraryBooks,
    updateBook,
    setLibrary,
    checkOpenWithBooks,
    clearOpenWithBooks,
  } = useLibraryStore();
  const _ = useTranslation();
  const { updateAppTheme } = useTheme();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const [loading, setLoading] = useState(false);
  const isInitiating = useRef(false);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [showDetailsBook, setShowDetailsBook] = useState<Book | null>(null);
  const [booksTransferProgress, setBooksTransferProgress] = useState<{
    [key: string]: number | null;
  }>({});
  const demoBooks = useDemoBooks();
  const containerRef = useRef<HTMLDivElement>(null);

  const { pullLibrary, pushLibrary } = useBooksSync({
    onSyncStart: () => setLoading(true),
    onSyncEnd: () => setLoading(false),
  });

  usePullToRefresh(containerRef, pullLibrary);
  useScreenWakeLock(settings.screenWakeLock);

  useEffect(() => {
    updateAppTheme('base-200');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const doCheckAppUpdates = async () => {
      if (hasUpdater() && settings.autoCheckUpdates) {
        await checkForAppUpdates(_);
      }
    };
    doCheckAppUpdates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const processOpenWithFiles = React.useCallback(
    async (appService: AppService, openWithFiles: string[], libraryBooks: Book[]) => {
      const bookIds: string[] = [];
      for (const file of openWithFiles) {
        console.log('Open with book:', file);
        try {
          const book = await appService.importBook(file, libraryBooks);
          if (book) {
            bookIds.push(book.hash);
          }
        } catch (error) {
          console.log('Failed to import book:', file, error);
        }
      }
      setLibrary(libraryBooks);
      appService.saveLibraryBooks(libraryBooks);

      console.log('Opening books:', bookIds);
      if (bookIds.length > 0) {
        navigateToReader(router, bookIds);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    if (isInitiating.current) return;
    isInitiating.current = true;

    const initLogin = async () => {
      const appService = await envConfig.getAppService();
      const settings = await appService.loadSettings();
      if (token && user) {
        if (!settings.keepLogin) {
          settings.keepLogin = true;
          setSettings(settings);
          saveSettings(envConfig, settings);
        }
      } else if (settings.keepLogin) {
        router.push('/auth');
      }
    };

    const loadingTimeout = setTimeout(() => setLoading(true), 300);
    const initLibrary = async () => {
      const appService = await envConfig.getAppService();
      const settings = await appService.loadSettings();
      setSettings(settings);

      const libraryBooks = await appService.loadLibraryBooks();
      if (checkOpenWithBooks && isTauriAppPlatform()) {
        await handleOpenWithBooks(appService, libraryBooks);
      } else {
        clearOpenWithBooks();
        setLibrary(libraryBooks);
      }

      setLibraryLoaded(true);
      if (loadingTimeout) clearTimeout(loadingTimeout);
      setLoading(false);
    };

    const handleOpenWithBooks = async (appService: AppService, libraryBooks: Book[]) => {
      const openWithFiles = (await parseOpenWithFiles()) || [];

      if (openWithFiles.length > 0) {
        await processOpenWithFiles(appService, openWithFiles, libraryBooks);
      } else {
        clearOpenWithBooks();
        setLibrary(libraryBooks);
      }
    };

    initLogin();
    initLibrary();
    return () => {
      clearOpenWithBooks();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (demoBooks.length > 0 && libraryLoaded) {
      const newLibrary = [...libraryBooks];
      for (const book of demoBooks) {
        const idx = newLibrary.findIndex((b) => b.hash === book.hash);
        if (idx === -1) {
          newLibrary.push(book);
        } else {
          newLibrary[idx] = book;
        }
      }
      setLibrary(newLibrary);
      appService?.saveLibraryBooks(newLibrary);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoBooks, libraryLoaded]);

  const importBooks = async (files: [string | File]) => {
    setLoading(true);
    const failedFiles = [];
    for (const file of files) {
      try {
        const book = await appService?.importBook(file, libraryBooks);
        setLibrary(libraryBooks);
        if (user && book && !book.uploadedAt && settings.autoUpload) {
          console.log('Uploading book:', book.title);
          handleBookUpload(book);
        }
      } catch (error) {
        const filename = typeof file === 'string' ? file : file.name;
        const baseFilename = getBaseFilename(filename);
        failedFiles.push(baseFilename);
        eventDispatcher.dispatch('toast', {
          message: _('Failed to import book(s): {{filenames}}', {
            filenames: listFormater(false).format(failedFiles),
          }),
          type: 'error',
        });
        console.error('Failed to import book:', filename, error);
      }
    }
    appService?.saveLibraryBooks(libraryBooks);
    setLoading(false);
  };

  const selectFilesTauri = async () => {
    return appService?.selectFiles('Select Books', SUPPORTED_FILE_EXTS);
  };

  const selectFilesWeb = () => {
    return new Promise((resolve) => {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = FILE_ACCEPT_FORMATS;
      fileInput.multiple = true;
      fileInput.click();

      fileInput.onchange = () => {
        resolve(fileInput.files);
      };
    });
  };

  const updateBookTransferProgress = throttle((bookHash: string, progress: ProgressPayload) => {
    if (progress.total === 0) return;
    const progressPct = (progress.progress / progress.total) * 100;
    setBooksTransferProgress((prev) => ({
      ...prev,
      [bookHash]: progressPct,
    }));
  }, 500);

  const handleBookUpload = async (book: Book) => {
    try {
      await appService?.uploadBook(book, (progress) => {
        updateBookTransferProgress(book.hash, progress);
      });
      await updateBook(envConfig, book);
      pushLibrary();
      eventDispatcher.dispatch('toast', {
        type: 'info',
        timeout: 2000,
        message: _('Book uploaded: {{title}}', {
          title: book.title,
        }),
      });
    } catch (err) {
      if (err instanceof Error) {
        if (err.message.includes('Not authenticated')) {
          navigateToLogin(router);
          return;
        } else if (err.message.includes('Insufficient storage quota')) {
          eventDispatcher.dispatch('toast', {
            type: 'error',
            message: _('Insufficient storage quota'),
          });
          return;
        }
      }
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to upload book: {{title}}', {
          title: book.title,
        }),
      });
    }
  };

  const handleBookDownload = async (book: Book) => {
    try {
      await appService?.downloadBook(book, false, (progress) => {
        updateBookTransferProgress(book.hash, progress);
      });
      await updateBook(envConfig, book);
      eventDispatcher.dispatch('toast', {
        type: 'info',
        timeout: 2000,
        message: _('Book downloaded: {{title}}', {
          title: book.title,
        }),
      });
    } catch {
      eventDispatcher.dispatch('toast', {
        message: _('Failed to download book: {{title}}', {
          title: book.title,
        }),
        type: 'error',
      });
    }
  };

  const handleBookDelete = async (book: Book) => {
    try {
      await appService?.deleteBook(book, !!book.uploadedAt);
      await updateBook(envConfig, book);
      pushLibrary();
      eventDispatcher.dispatch('toast', {
        type: 'info',
        timeout: 2000,
        message: _('Book deleted: {{title}}', {
          title: book.title,
        }),
      });
    } catch {
      eventDispatcher.dispatch('toast', {
        message: _('Failed to delete book: {{title}}', {
          title: book.title,
        }),
        type: 'error',
      });
    }
  };

  const handleImportBooks = async () => {
    console.log('Importing books...');
    let files;

    if (isTauriAppPlatform()) {
      const { type } = await import('@tauri-apps/plugin-os');
      if (['android', 'ios'].includes(type())) {
        files = (await selectFilesWeb()) as [File];
      } else {
        files = (await selectFilesTauri()) as [string];
      }
    } else {
      files = (await selectFilesWeb()) as [File];
    }
    importBooks(files);
  };

  const handleToggleSelectMode = () => {
    setIsSelectMode(!isSelectMode);
  };

  const handleSetSelectMode = (selectMode: boolean) => {
    setIsSelectMode(selectMode);
  };

  const handleShowDetailsBook = (book: Book) => {
    setShowDetailsBook(book);
  };

  if (!appService) {
    return null;
  }

  if (checkOpenWithBooks) {
    return (
      loading && (
        <div className='fixed inset-0 z-50 flex items-center justify-center'>
          <Spinner loading />
        </div>
      )
    );
  }

  return (
    <div
      className={clsx(
        'library-page bg-base-200 text-base-content flex select-none flex-col overflow-hidden',
        appService?.isIOSApp ? 'h-[100vh]' : 'h-dvh',
        appService?.hasRoundedWindow && 'rounded-window',
      )}
    >
      <div className='fixed top-0 z-40 w-full'>
        <LibraryHeader
          isSelectMode={isSelectMode}
          onImportBooks={handleImportBooks}
          onToggleSelectMode={handleToggleSelectMode}
        />
      </div>
      {loading && (
        <div className='fixed inset-0 z-50 flex items-center justify-center'>
          <Spinner loading />
        </div>
      )}
      {libraryLoaded &&
        (libraryBooks.length > 0 ? (
          <div
            ref={containerRef}
            className={clsx(
              'mt-12 flex-grow overflow-auto px-4 sm:px-2',
              appService?.hasSafeAreaInset && 'mt-[calc(48px+env(safe-area-inset-top))]',
            )}
          >
            <Bookshelf
              libraryBooks={libraryBooks}
              isSelectMode={isSelectMode}
              handleImportBooks={handleImportBooks}
              handleBookUpload={handleBookUpload}
              handleBookDownload={handleBookDownload}
              handleBookDelete={handleBookDelete}
              handleSetSelectMode={handleSetSelectMode}
              handleShowDetailsBook={handleShowDetailsBook}
              booksTransferProgress={booksTransferProgress}
            />
          </div>
        ) : (
          <div className='hero h-screen items-center justify-center'>
            <div className='hero-content text-neutral-content text-center'>
              <div className='max-w-md'>
                <h1 className='mb-5 text-5xl font-bold'>{_('Your Library')}</h1>
                <p className='mb-5'>
                  {_(
                    'Welcome to your library. You can import your books here and read them anytime.',
                  )}
                </p>
                <button className='btn btn-primary rounded-xl' onClick={handleImportBooks}>
                  {_('Import Books')}
                </button>
              </div>
            </div>
          </div>
        ))}
      {showDetailsBook && (
        <BookDetailModal
          isOpen={!!showDetailsBook}
          book={showDetailsBook}
          onClose={() => setShowDetailsBook(null)}
        />
      )}
      <AboutWindow />
      <Toast />
    </div>
  );
};

export default LibraryPage;
