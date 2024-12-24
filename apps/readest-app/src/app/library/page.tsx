'use client';

import * as React from 'react';
import { useState, useRef, useEffect, Suspense } from 'react';
import { useRouter } from 'next/navigation';

import { Book } from '@/types/book';
import { AppService } from '@/types/system';
import { navigateToReader } from '@/utils/nav';
import { parseOpenWithFiles } from '@/helpers/cli';
import { isTauriAppPlatform } from '@/services/environment';
import { checkForAppUpdates } from '@/helpers/updater';
import { FILE_ACCEPT_FORMATS, SUPPORTED_FILE_EXTS } from '@/services/constants';

import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useDemoBooks } from './hooks/useDemoBooks';

import Spinner from '@/components/Spinner';
import LibraryHeader from './components/LibraryHeader';
import Bookshelf from './components/Bookshelf';
import { AboutWindow } from '@/components/AboutWindow';

const LibraryPage = () => {
  const router = useRouter();
  const { envConfig, appService } = useEnv();
  const { token, user } = useAuth();
  const {
    library: libraryBooks,
    setLibrary,
    checkOpenWithBooks,
    clearOpenWithBooks,
  } = useLibraryStore();
  useTheme();
  const { setSettings, saveSettings } = useSettingsStore();
  const [loading, setLoading] = useState(false);
  const isInitiating = useRef(false);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const demoBooks = useDemoBooks();

  useEffect(() => {
    const doAppUpdates = async () => {
      if (isTauriAppPlatform()) {
        await checkForAppUpdates();
      }
    };
    doAppUpdates();
  }, []);

  const processOpenWithFiles = React.useCallback(
    async (appService: AppService, openWithFiles: string[], libraryBooks: Book[]) => {
      const bookIds: string[] = [];
      for (const file of openWithFiles) {
        const book = await appService.importBook(file, libraryBooks);
        if (book) {
          bookIds.push(book.hash);
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
    for (const file of files) {
      await appService?.importBook(file, libraryBooks);
      setLibrary(libraryBooks);
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
    <div className='library-page rounded-window bg-base-200/50 text-base-content flex h-full min-h-screen select-none flex-col overflow-hidden'>
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
          <div className='mt-12 flex-grow overflow-auto px-2'>
            <Suspense>
              <Bookshelf
                libraryBooks={libraryBooks}
                isSelectMode={isSelectMode}
                onImportBooks={handleImportBooks}
              />
            </Suspense>
          </div>
        ) : (
          <div className='hero h-screen items-center justify-center'>
            <div className='hero-content text-neutral-content text-center'>
              <div className='max-w-md'>
                <h1 className='mb-5 text-5xl font-bold'>Your Library</h1>
                <p className='mb-5'>
                  Welcome to your library. You can import your books here and read them anytime.
                </p>
                <button className='btn btn-primary rounded-xl' onClick={handleImportBooks}>
                  Import Books
                </button>
              </div>
            </div>
          </div>
        ))}
      <AboutWindow />
    </div>
  );
};

export default LibraryPage;
