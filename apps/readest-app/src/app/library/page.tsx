'use client';

import clsx from 'clsx';
import * as React from 'react';
import { useState, useRef, useEffect, Suspense } from 'react';
import { useRouter } from 'next/navigation';

import { Book } from '@/types/book';
import { AppService } from '@/types/system';
import { navigateToReader } from '@/utils/nav';
import { getBaseFilename, listFormater } from '@/utils/book';
import { eventDispatcher } from '@/utils/event';
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
import { useDemoBooks } from './hooks/useDemoBooks';

import { AboutWindow } from '@/components/AboutWindow';
import { Toast } from '@/components/Toast';
import Spinner from '@/components/Spinner';
import LibraryHeader from './components/LibraryHeader';
import Bookshelf from './components/Bookshelf';
import { invoke } from '@tauri-apps/api/core';

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
  const _ = useTranslation();
  const { setSettings, saveSettings } = useSettingsStore();
  const [loading, setLoading] = useState(false);
  const isInitiating = useRef(false);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const demoBooks = useDemoBooks();

  useEffect(() => {
    const doAppUpdates = async () => {
      if (hasUpdater()) {
        await checkForAppUpdates();
      }
    };
    doAppUpdates();
  }, []);

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
        await appService?.importBook(file, libraryBooks);
        setLibrary(libraryBooks);
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

  const importDirectory = async (dirPath: string) => {
    if (!appService) return;

    setLoading(true);
    try {
      // list files
      const bookPaths = await invoke<string[]>('find_book_files', { path: dirPath });

      if (bookPaths.length === 0) {
        eventDispatcher.dispatch('toast', {
          message: _('No books found in directory'),
          type: 'warning',
        });
        return;
      }

      const unlisten = await appService.listen!('import-progress', (event) => {
        const { total_files, processed_files, current_file } = event.payload;
        requestAnimationFrame(() => {
          eventDispatcher.dispatch('toast', {
            message: _('Validating {{processed}} / {{total}} - {{file}}', {
              processed: processed_files,
              total: total_files,
              file: current_file,
            }),
            type: 'info',
            duration: 1000,
          });
        });
      });

      const validations = await invoke<Array<{ path: string; success: boolean; error?: string }>>(
        'validate_book_files',
        {
          paths: bookPaths,
          chunkSize: 3,
        },
      );

      const failedFiles: string[] = [];
      const batchSize = 1;
      let processedFiles = 0;

      for (let i = 0; i < validations.length; i += batchSize) {
        const batch = validations.slice(i, i + batchSize);

        await Promise.all(
          batch.map(async (validation) => {
            if (validation.success) {
              try {
                await appService.importBook(validation.path, libraryBooks);
                processedFiles++;

                // Update UI using requestAnimationFrame
                requestAnimationFrame(() => {
                  setLibrary([...libraryBooks]);
                  eventDispatcher.dispatch('toast', {
                    message: _('Processing books: {{processed}}/{{total}}', {
                      processed: processedFiles,
                      total: validations.length,
                    }),
                    type: 'info',
                    duration: 1000,
                  });
                });
              } catch (error) {
                const baseFilename = getBaseFilename(validation.path);
                failedFiles.push(baseFilename);
                console.error('Failed to import book:', validation.path, error);
              }
            } else {
              failedFiles.push(getBaseFilename(validation.path));
            }
          }),
        );
      }

      setLibrary([...libraryBooks]);
      appService.saveLibraryBooks(libraryBooks);

      if (failedFiles.length > 0) {
        eventDispatcher.dispatch('toast', {
          message: _('Failed to import book(s): {{filenames}}', {
            filenames: listFormater(false).format(failedFiles),
          }),
          type: 'error',
        });
      } else {
        eventDispatcher.dispatch('toast', {
          message: _('Successfully imported {{count}} books', {
            count: processedFiles,
          }),
          type: 'success',
        });
      }

      unlisten();
    } catch (error) {
      console.error('Failed to import directory:', error);
      eventDispatcher.dispatch('toast', {
        message: _('Failed to import directory'),
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleImportDirectory = async () => {
    if (!appService) return;

    console.log('Importing directory...');
    if (isTauriAppPlatform()) {
      try {
        const dirPath = await appService.selectDirectory!(_('Select Books Directory'));
        if (dirPath) {
          await importDirectory(dirPath);
        }
      } catch (error) {
        console.error('Failed to select directory:', error);
        eventDispatcher.dispatch('toast', {
          message: _('Failed to select directory'),
          type: 'error',
        });
      }
    }
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
        'library-page bg-base-200/50 text-base-content flex h-dvh select-none flex-col overflow-hidden',
        isTauriAppPlatform() && 'rounded-window',
      )}
    >
      <div className='fixed top-0 z-40 w-full'>
        <LibraryHeader
          isSelectMode={isSelectMode}
          onImportBooks={handleImportBooks}
          onImportDirectory={handleImportDirectory}
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
      <AboutWindow />
      <Toast />
    </div>
  );
};

export default LibraryPage;
