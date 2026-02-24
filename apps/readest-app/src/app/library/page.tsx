'use client';

import clsx from 'clsx';
import * as React from 'react';
import { MdChevronRight } from 'react-icons/md';
import { useState, useRef, useEffect, Suspense, useCallback } from 'react';
import { ReadonlyURLSearchParams, useSearchParams } from 'next/navigation';
import { useTransitionRouter } from 'next-view-transitions';
import { OverlayScrollbarsComponent, OverlayScrollbarsComponentRef } from 'overlayscrollbars-react';
import 'overlayscrollbars/overlayscrollbars.css';

import { Book } from '@/types/book';
import { AppService, DeleteAction } from '@/types/system';
import { navigateToLibrary, navigateToReader } from '@/utils/nav';
import { formatAuthors, formatTitle, getPrimaryLanguage, listFormater } from '@/utils/book';
import { eventDispatcher } from '@/utils/event';
import { ProgressPayload } from '@/utils/transfer';
import { throttle } from '@/utils/throttle';
import { transferManager } from '@/services/transferManager';
import { getDirPath, getFilename, joinPaths } from '@/utils/path';
import { parseOpenWithFiles } from '@/helpers/openWith';
import { isTauriAppPlatform, isWebAppPlatform } from '@/services/environment';
import { checkForAppUpdates, checkAppReleaseNotes } from '@/helpers/updater';
import { impactFeedback } from '@tauri-apps/plugin-haptics';
import { getCurrentWebview } from '@tauri-apps/api/webview';

import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useTheme } from '@/hooks/useTheme';
import { useUICSS } from '@/hooks/useUICSS';
import { useDemoBooks } from './hooks/useDemoBooks';
import { useBooksSync } from './hooks/useBooksSync';
import { useBookDataStore } from '@/store/bookDataStore';
import { useTransferStore } from '@/store/transferStore';
import { useScreenWakeLock } from '@/hooks/useScreenWakeLock';
import { useOpenWithBooks } from '@/hooks/useOpenWithBooks';
import { SelectedFile, useFileSelector } from '@/hooks/useFileSelector';
import { lockScreenOrientation, selectDirectory } from '@/utils/bridge';
import { requestStoragePermission } from '@/utils/permission';
import { SUPPORTED_BOOK_EXTS } from '@/services/constants';
import {
  tauriHandleClose,
  tauriHandleSetAlwaysOnTop,
  tauriHandleToggleFullScreen,
  tauriQuitApp,
} from '@/utils/window';

import { LibraryGroupByType } from '@/types/settings';
import { BookMetadata } from '@/libs/document';
import { AboutWindow } from '@/components/AboutWindow';
import { BookDetailModal } from '@/components/metadata';
import { UpdaterWindow } from '@/components/UpdaterWindow';
import { CatalogDialog } from './components/OPDSDialog';
import { MigrateDataWindow } from './components/MigrateDataWindow';
import { useDragDropImport } from './hooks/useDragDropImport';
import { useTransferQueue } from '@/hooks/useTransferQueue';
import { Toast } from '@/components/Toast';
import {
  createBookGroups,
  ensureLibraryGroupByType,
  findGroupById,
  getBreadcrumbs,
} from './utils/libraryUtils';
import Spinner from '@/components/Spinner';
import LibraryHeader from './components/LibraryHeader';
import Bookshelf from './components/Bookshelf';
import GroupHeader from './components/GroupHeader';
import useShortcuts from '@/hooks/useShortcuts';
import DropIndicator from '@/components/DropIndicator';
import SettingsDialog from '@/components/settings/SettingsDialog';
import ModalPortal from '@/components/ModalPortal';
import TransferQueuePanel from './components/TransferQueuePanel';

const LibraryPageWithSearchParams = () => {
  const searchParams = useSearchParams();
  return <LibraryPageContent searchParams={searchParams} />;
};

const LibraryPageContent = ({ searchParams }: { searchParams: ReadonlyURLSearchParams | null }) => {
  const router = useTransitionRouter();
  const { envConfig, appService } = useEnv();
  const { token, user } = useAuth();
  const {
    library: libraryBooks,
    isSyncing,
    syncProgress,
    updateBook,
    updateBooks,
    setLibrary,
    getGroupId,
    getGroupName,
    refreshGroups,
    checkOpenWithBooks,
    checkLastOpenBooks,
    setCheckOpenWithBooks,
    setCheckLastOpenBooks,
  } = useLibraryStore();
  const _ = useTranslation();
  const { selectFiles } = useFileSelector(appService, _);
  const { safeAreaInsets: insets, isRoundedWindow } = useThemeStore();
  const { clearBookData } = useBookDataStore();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { isSettingsDialogOpen, setSettingsDialogOpen } = useSettingsStore();
  const { isTransferQueueOpen } = useTransferStore();
  const [showCatalogManager, setShowCatalogManager] = useState(
    searchParams?.get('opds') === 'true',
  );
  const [loading, setLoading] = useState(false);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [isSelectAll, setIsSelectAll] = useState(false);
  const [isSelectNone, setIsSelectNone] = useState(false);
  const [showDetailsBook, setShowDetailsBook] = useState<Book | null>(null);
  const [currentGroupPath, setCurrentGroupPath] = useState<string | undefined>(undefined);
  const [currentSeriesAuthorGroup, setCurrentSeriesAuthorGroup] = useState<{
    groupBy: typeof LibraryGroupByType.Series | typeof LibraryGroupByType.Author;
    groupName: string;
  } | null>(null);
  const [booksTransferProgress, setBooksTransferProgress] = useState<{
    [key: string]: number | null;
  }>({});
  const [pendingNavigationBookIds, setPendingNavigationBookIds] = useState<string[] | null>(null);
  const isInitiating = useRef(false);

  const iconSize = useResponsiveSize(18);
  const viewSettings = settings.globalViewSettings;
  const demoBooks = useDemoBooks();
  const osRef = useRef<OverlayScrollbarsComponentRef>(null);
  const containerRef: React.MutableRefObject<HTMLDivElement | null> = useRef(null);
  const pageRef = useRef<HTMLDivElement>(null);

  const getScrollKey = (group: string) => `library-scroll-${group || 'all'}`;

  const saveScrollPosition = (group: string) => {
    const viewport = osRef.current?.osInstance()?.elements().viewport;
    if (viewport) {
      const scrollTop = viewport.scrollTop;
      sessionStorage.setItem(getScrollKey(group), scrollTop.toString());
    }
  };

  const restoreScrollPosition = useCallback((group: string) => {
    const savedPosition = sessionStorage.getItem(getScrollKey(group));
    if (savedPosition) {
      const scrollTop = parseInt(savedPosition, 10);
      const viewport = osRef.current?.osInstance()?.elements().viewport;
      if (viewport) {
        viewport.scrollTop = scrollTop;
      }
    }
  }, []);

  // Unified navigation function that handles scroll position and direction
  const handleLibraryNavigation = useCallback(
    (targetGroup: string) => {
      const currentGroup = searchParams?.get('group') || '';

      // Save current scroll position BEFORE navigation
      saveScrollPosition(currentGroup);

      // Detect and set navigation direction
      const direction = currentGroup && !targetGroup ? 'back' : 'forward';
      document.documentElement.setAttribute('data-nav-direction', direction);

      // Build query params
      const params = new URLSearchParams(searchParams?.toString());
      if (targetGroup) {
        params.set('group', targetGroup);
      } else {
        params.delete('group');
      }

      navigateToLibrary(router, `${params.toString()}`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchParams, router],
  );

  useTheme({ systemUIVisible: true, appThemeColor: 'base-200' });
  useUICSS();

  useOpenWithBooks();
  useTransferQueue(libraryLoaded);

  const { pullLibrary, pushLibrary } = useBooksSync();
  const { isDragging } = useDragDropImport();

  usePullToRefresh(
    containerRef,
    pullLibrary.bind(null, false, true),
    pullLibrary.bind(null, true, true),
  );
  useScreenWakeLock(settings.screenWakeLock);

  useShortcuts({
    onToggleFullscreen: async () => {
      if (isTauriAppPlatform()) {
        await tauriHandleToggleFullScreen();
      }
    },
    onCloseWindow: async () => {
      if (isTauriAppPlatform()) {
        await tauriHandleClose();
      }
    },
    onQuitApp: async () => {
      if (isTauriAppPlatform()) {
        await tauriQuitApp();
      }
    },
    onOpenFontLayoutSettings: () => {
      setSettingsDialogOpen(true);
    },
    onOpenBooks: () => {
      handleImportBooksFromFiles();
    },
  });

  useEffect(() => {
    sessionStorage.setItem('lastLibraryParams', searchParams?.toString() || '');
  }, [searchParams]);

  useEffect(() => {
    const doCheckAppUpdates = async () => {
      if (appService?.hasUpdater && settings.autoCheckUpdates) {
        await checkForAppUpdates(_);
      } else if (appService?.hasUpdater === false) {
        checkAppReleaseNotes();
      }
    };
    if (settings.alwaysOnTop) {
      tauriHandleSetAlwaysOnTop(settings.alwaysOnTop);
    }
    doCheckAppUpdates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService?.hasUpdater, settings]);

  useEffect(() => {
    if (appService?.isMobileApp) {
      lockScreenOrientation({ orientation: 'auto' });
    }
  }, [appService]);

  const handleRefreshLibrary = useCallback(async () => {
    const appService = await envConfig.getAppService();
    const settings = await appService.loadSettings();
    const library = await appService.loadLibraryBooks();
    setSettings(settings);
    setLibrary(library);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envConfig, appService]);

  useEffect(() => {
    if (appService?.hasWindow) {
      const currentWebview = getCurrentWebview();
      const unlisten = currentWebview.listen('close-reader-window', async () => {
        handleRefreshLibrary();
      });
      return () => {
        unlisten.then((fn) => fn());
      };
    }
    return;
  }, [appService, handleRefreshLibrary]);

  const handleImportBookFiles = useCallback(async (event: CustomEvent) => {
    const selectedFiles: SelectedFile[] = event.detail.files;
    const groupId: string = event.detail.groupId || '';
    if (selectedFiles.length === 0) return;
    await importBooks(selectedFiles, groupId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    eventDispatcher.on('import-book-files', handleImportBookFiles);
    return () => {
      eventDispatcher.off('import-book-files', handleImportBookFiles);
    };
  }, [handleImportBookFiles]);

  useEffect(() => {
    refreshGroups();
    if (!libraryBooks.some((book) => !book.deletedAt)) {
      handleSetSelectMode(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryBooks]);

  const processOpenWithFiles = useCallback(
    async (appService: AppService, openWithFiles: string[], libraryBooks: Book[]) => {
      const settings = await appService.loadSettings();
      const bookIds: string[] = [];
      for (const file of openWithFiles) {
        console.log('Open with book:', file);
        try {
          const temp = appService.isMobile ? false : !settings.autoImportBooksOnOpen;
          const book = await appService.importBook(file, libraryBooks, true, true, false, temp);
          if (book) {
            bookIds.push(book.hash);
          }
          if (user && book && !temp && !book.uploadedAt && settings.autoUpload) {
            setTimeout(() => {
              console.log('Queueing upload for book:', book.title);
              transferManager.queueUpload(book);
              // wait for the initialization of the transfer manager and opening of the book
            }, 3000);
          }
        } catch (error) {
          console.log('Failed to import book:', file, error);
        }
      }
      setLibrary(libraryBooks);
      appService.saveLibraryBooks(libraryBooks);

      console.log('Opening books:', bookIds);
      if (bookIds.length > 0) {
        setPendingNavigationBookIds(bookIds);
        return true;
      }
      return false;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleOpenLastBooks = async (
    appService: AppService,
    lastBookIds: string[],
    libraryBooks: Book[],
  ) => {
    if (lastBookIds.length === 0) return false;
    const bookIds: string[] = [];
    for (const bookId of lastBookIds) {
      const book = libraryBooks.find((b) => b.hash === bookId);
      if (book && (await appService.isBookAvailable(book))) {
        bookIds.push(book.hash);
      }
    }
    console.log('Opening last books:', bookIds);
    if (bookIds.length > 0) {
      setPendingNavigationBookIds(bookIds);
      return true;
    }
    return false;
  };

  const handleShowOPDSDialog = () => {
    setShowCatalogManager(true);
  };

  const handleDismissOPDSDialog = () => {
    setShowCatalogManager(false);
    const params = new URLSearchParams(searchParams?.toString());
    params.delete('opds');
    navigateToLibrary(router, `${params.toString()}`);
  };

  useEffect(() => {
    if (pendingNavigationBookIds) {
      const bookIds = pendingNavigationBookIds;
      setPendingNavigationBookIds(null);
      if (bookIds.length > 0) {
        navigateToReader(router, bookIds);
      }
    }
  }, [pendingNavigationBookIds, appService, router]);

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

      // Reuse the library from the store when we return from the reader
      const library = libraryBooks.length > 0 ? libraryBooks : await appService.loadLibraryBooks();
      let opened = false;
      if (checkOpenWithBooks) {
        opened = await handleOpenWithBooks(appService, library);
      }
      setCheckOpenWithBooks(opened);
      if (!opened && checkLastOpenBooks && settings.openLastBooks) {
        opened = await handleOpenLastBooks(appService, settings.lastOpenBooks, library);
      }
      setCheckLastOpenBooks(opened);

      setLibrary(library);
      setLibraryLoaded(true);
      if (loadingTimeout) clearTimeout(loadingTimeout);
      setLoading(false);
    };

    const handleOpenWithBooks = async (appService: AppService, library: Book[]) => {
      const openWithFiles = (await parseOpenWithFiles(appService)) || [];

      if (openWithFiles.length > 0) {
        return await processOpenWithFiles(appService, openWithFiles, library);
      }
      return false;
    };

    initLogin();
    initLibrary();
    return () => {
      setCheckOpenWithBooks(false);
      setCheckLastOpenBooks(false);
      isInitiating.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    const group = searchParams?.get('group') || '';
    const groupName = getGroupName(group);
    setCurrentGroupPath(groupName);
  }, [libraryBooks, searchParams, getGroupName]);

  useEffect(() => {
    const group = searchParams?.get('group') || '';
    restoreScrollPosition(group);
  }, [searchParams, restoreScrollPosition]);

  // Track current series/author group for navigation header
  useEffect(() => {
    const groupId = searchParams?.get('group') || '';
    const groupByParam = searchParams?.get('groupBy');
    const groupBy = ensureLibraryGroupByType(groupByParam, settings.libraryGroupBy);

    if (
      groupId &&
      (groupBy === LibraryGroupByType.Series || groupBy === LibraryGroupByType.Author)
    ) {
      // Find the group to get its name
      const allGroups = createBookGroups(
        libraryBooks.filter((b) => !b.deletedAt),
        groupBy,
      );
      const targetGroup = findGroupById(allGroups, groupId);

      if (targetGroup) {
        setCurrentSeriesAuthorGroup({
          groupBy,
          groupName: targetGroup.displayName || targetGroup.name,
        });
      } else {
        setCurrentSeriesAuthorGroup(null);
      }
    } else {
      setCurrentSeriesAuthorGroup(null);
    }
  }, [libraryBooks, searchParams, settings.libraryGroupBy]);

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

  const importBooks = async (files: SelectedFile[], groupId?: string) => {
    setLoading(true);
    const { library } = useLibraryStore.getState();
    const failedImports: Array<{ filename: string; errorMessage: string }> = [];
    const successfulImports: string[] = [];
    const errorMap: [string, string][] = [
      ['No chapters detected', _('No chapters detected')],
      ['Failed to parse EPUB', _('Failed to parse the EPUB file')],
      ['Unsupported format', _('This book format is not supported')],
      ['Failed to open file', _('Failed to open the book file')],
      ['Invalid or empty book file', _('The book file is empty')],
      ['Unsupported or corrupted book file', _('The book file is corrupted')],
    ];

    const processFile = async (selectedFile: SelectedFile): Promise<Book | null> => {
      const file = selectedFile.file || selectedFile.path;
      if (!file) return null;
      try {
        const book = await appService?.importBook(file, library);
        if (!book) return null;
        const { path, basePath } = selectedFile;
        if (groupId) {
          book.groupId = groupId;
          book.groupName = getGroupName(groupId);
        } else if (path && basePath) {
          const rootPath = getDirPath(basePath);
          const groupName = getDirPath(path).replace(rootPath, '').replace(/^\//, '');
          book.groupName = groupName;
          book.groupId = getGroupId(groupName);
        }

        if (user && !book.uploadedAt && settings.autoUpload) {
          console.log('Queueing upload for book:', book.title);
          transferManager.queueUpload(book);
        }
        successfulImports.push(book.title);
        return book;
      } catch (error) {
        const filename = typeof file === 'string' ? file : file.name;
        const baseFilename = getFilename(filename);
        const errorMessage =
          error instanceof Error
            ? errorMap.find(([str]) => error.message.includes(str))?.[1] || error.message
            : '';
        failedImports.push({ filename: baseFilename, errorMessage });
        console.error('Failed to import book:', filename, error);
        return null;
      }
    };

    const concurrency = 4;
    for (let i = 0; i < files.length; i += concurrency) {
      const batch = files.slice(i, i + concurrency);
      const importedBooks = (await Promise.all(batch.map(processFile))).filter((book) => !!book);
      await updateBooks(envConfig, importedBooks);
    }

    pushLibrary();

    if (failedImports.length > 0) {
      const filenames = failedImports.map((f) => f.filename);
      const errorMessage = failedImports.find((f) => f.errorMessage)?.errorMessage || '';

      eventDispatcher.dispatch('toast', {
        message:
          _('Failed to import book(s): {{filenames}}', {
            filenames: listFormater(false).format(filenames),
          }) + (errorMessage ? `\n${errorMessage}` : ''),
        timeout: 5000,
        type: 'error',
      });
    } else if (successfulImports.length > 0) {
      eventDispatcher.dispatch('toast', {
        message: _('Successfully imported {{count}} book(s)', {
          count: successfulImports.length,
        }),
        timeout: 2000,
        type: 'success',
      });
    }

    setLoading(false);
  };

  const updateBookTransferProgress = throttle((bookHash: string, progress: ProgressPayload) => {
    if (progress.total === 0) return;
    const progressPct = (progress.progress / progress.total) * 100;
    setBooksTransferProgress((prev) => ({
      ...prev,
      [bookHash]: progressPct,
    }));
  }, 500);

  const handleBookUpload = useCallback(
    async (book: Book, _syncBooks = true) => {
      // Use transfer queue for uploads - priority 1 for manual uploads (higher priority)
      const transferId = transferManager.queueUpload(book, 1);
      if (transferId) {
        eventDispatcher.dispatch('toast', {
          type: 'info',
          timeout: 2000,
          message: _('Upload queued: {{title}}', {
            title: book.title,
          }),
        });
        return true;
      }
      return false;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleBookDownload = useCallback(
    async (book: Book, downloadOptions: { redownload?: boolean; queued?: boolean } = {}) => {
      const { redownload = false, queued = false } = downloadOptions;
      if (redownload || !queued) {
        try {
          await appService?.downloadBook(book, false, redownload, (progress) => {
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
          return true;
        } catch {
          eventDispatcher.dispatch('toast', {
            message: _('Failed to download book: {{title}}', {
              title: book.title,
            }),
            type: 'error',
          });
          return false;
        }
      }

      // Use transfer queue for normal downloads - priority 1 for manual downloads
      const transferId = transferManager.queueDownload(book, 1);
      if (transferId) {
        eventDispatcher.dispatch('toast', {
          type: 'info',
          timeout: 2000,
          message: _('Download queued: {{title}}', {
            title: book.title,
          }),
        });
        return true;
      }
      return false;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appService],
  );

  const handleBookDelete = (deleteAction: DeleteAction) => {
    return async (book: Book, syncBooks = true) => {
      const deletionMessages = {
        both: _('Book deleted: {{title}}', { title: book.title }),
        cloud: _('Deleted cloud backup of the book: {{title}}', { title: book.title }),
        local: _('Deleted local copy of the book: {{title}}', { title: book.title }),
      };
      const deletionFailMessages = {
        both: _('Failed to delete book: {{title}}', { title: book.title }),
        cloud: _('Failed to delete cloud backup of the book: {{title}}', { title: book.title }),
        local: _('Failed to delete local copy of the book: {{title}}', { title: book.title }),
      };

      try {
        // Handle local deletion immediately
        if (deleteAction === 'local' || deleteAction === 'both') {
          await appService?.deleteBook(book, 'local');
          if (deleteAction === 'both') {
            book.deletedAt = Date.now();
            book.downloadedAt = null;
            book.coverDownloadedAt = null;
          }
          await updateBook(envConfig, book);
          clearBookData(book.hash);
          if (syncBooks) pushLibrary();
        }

        // Queue cloud deletion
        if (deleteAction === 'cloud' || deleteAction === 'both') {
          const transferId = transferManager.queueDelete(book, 1, true);
          if (!transferId) {
            throw new Error('Failed to queue cloud deletion');
          }
        }

        eventDispatcher.dispatch('toast', {
          type: 'info',
          timeout: 1000,
          message: deletionMessages[deleteAction],
        });
        return true;
      } catch {
        eventDispatcher.dispatch('toast', {
          message: deletionFailMessages[deleteAction],
          type: 'error',
        });
        return false;
      }
    };
  };

  const handleUpdateMetadata = async (book: Book, metadata: BookMetadata) => {
    book.metadata = metadata;
    book.title = formatTitle(metadata.title);
    book.author = formatAuthors(metadata.author);
    book.primaryLanguage = getPrimaryLanguage(metadata.language);
    book.updatedAt = Date.now();
    if (metadata.coverImageBlobUrl || metadata.coverImageUrl || metadata.coverImageFile) {
      book.coverImageUrl = metadata.coverImageBlobUrl || metadata.coverImageUrl;
      try {
        await appService?.updateCoverImage(
          book,
          metadata.coverImageBlobUrl || metadata.coverImageUrl,
          metadata.coverImageFile,
        );
      } catch (error) {
        console.warn('Failed to update cover image:', error);
      }
    }
    if (isWebAppPlatform()) {
      // Clear HTTP cover image URL if cover is updated with a local file
      if (metadata.coverImageBlobUrl) {
        metadata.coverImageUrl = undefined;
      }
    } else {
      metadata.coverImageUrl = undefined;
    }
    metadata.coverImageBlobUrl = undefined;
    metadata.coverImageFile = undefined;
    await updateBook(envConfig, book);
  };

  const handleImportBooksFromFiles = async () => {
    setIsSelectMode(false);
    console.log('Importing books from files...');
    selectFiles({ type: 'books', multiple: true }).then((result) => {
      if (result.files.length === 0 || result.error) return;
      const groupId = searchParams?.get('group') || '';
      importBooks(result.files, groupId);
    });
  };

  const handleImportBooksFromDirectory = async () => {
    if (!appService || !isTauriAppPlatform()) return;

    setIsSelectMode(false);
    console.log('Importing books from directory...');
    let importDirectory: string | undefined = '';
    if (appService.isAndroidApp) {
      if (!(await requestStoragePermission())) return;
      const response = await selectDirectory();
      importDirectory = response.path;
    } else {
      const selectedDir = await appService.selectDirectory?.('read');
      importDirectory = selectedDir;
    }
    if (!importDirectory) {
      console.log('No directory selected');
      return;
    }
    const files = await appService.readDirectory(importDirectory, 'None');
    const supportedFiles = files.filter((file) => {
      const ext = file.path.split('.').pop()?.toLowerCase() || '';
      return SUPPORTED_BOOK_EXTS.includes(ext);
    });
    const toImportFiles = await Promise.all(
      supportedFiles.map(async (file) => {
        return {
          path: await joinPaths(importDirectory, file.path),
          basePath: importDirectory,
        };
      }),
    );
    importBooks(toImportFiles, undefined);
  };

  const handleSetSelectMode = (selectMode: boolean) => {
    if (selectMode && appService?.hasHaptics) {
      impactFeedback('medium');
    }
    setIsSelectMode(selectMode);
    setIsSelectAll(false);
    setIsSelectNone(false);
  };

  const handleSelectAll = () => {
    setIsSelectAll(true);
    setIsSelectNone(false);
  };

  const handleDeselectAll = () => {
    setIsSelectNone(true);
    setIsSelectAll(false);
  };

  const handleShowDetailsBook = (book: Book) => {
    setShowDetailsBook(book);
  };

  const handleNavigateToPath = (path: string | undefined) => {
    const group = path ? getGroupId(path) || '' : '';
    setIsSelectAll(false);
    setIsSelectNone(false);
    handleLibraryNavigation(group);
  };

  if (!appService || !insets || checkOpenWithBooks || checkLastOpenBooks) {
    return <div className={clsx('full-height', !appService?.isLinuxApp && 'bg-base-200')} />;
  }

  const showBookshelf = libraryLoaded || libraryBooks.length > 0;

  return (
    <div
      ref={pageRef}
      aria-label='Your Library'
      className={clsx(
        'library-page text-base-content full-height flex select-none flex-col overflow-hidden',
        viewSettings?.isEink ? 'bg-base-100' : 'bg-base-200',
        appService?.hasRoundedWindow && isRoundedWindow && 'window-border rounded-window',
      )}
    >
      <div
        className='relative top-0 z-40 w-full'
        role='banner'
        tabIndex={-1}
        aria-label={_('Library Header')}
      >
        <LibraryHeader
          isSelectMode={isSelectMode}
          isSelectAll={isSelectAll}
          onPullLibrary={pullLibrary}
          onImportBooksFromFiles={handleImportBooksFromFiles}
          onImportBooksFromDirectory={
            appService?.canReadExternalDir ? handleImportBooksFromDirectory : undefined
          }
          onOpenCatalogManager={handleShowOPDSDialog}
          onToggleSelectMode={() => handleSetSelectMode(!isSelectMode)}
          onSelectAll={handleSelectAll}
          onDeselectAll={handleDeselectAll}
        />
        <progress
          aria-label={_('Library Sync Progress')}
          aria-hidden={isSyncing ? 'false' : 'true'}
          className={clsx(
            'progress progress-success absolute bottom-0 left-0 right-0 h-1 translate-y-[2px] transition-opacity duration-200 sm:translate-y-[4px]',
            isSyncing ? 'opacity-100' : 'opacity-0',
          )}
          value={syncProgress * 100}
          max='100'
        />
      </div>
      {(loading || isSyncing) && (
        <div className='fixed inset-0 z-50 flex items-center justify-center'>
          <Spinner loading />
        </div>
      )}
      {currentGroupPath && (
        <div
          className={`transition-all duration-300 ease-in-out ${
            currentGroupPath ? 'opacity-100' : 'max-h-0 opacity-0'
          }`}
        >
          <div className='flex flex-wrap items-center gap-y-1 px-4 text-base'>
            <button
              onClick={() => handleNavigateToPath(undefined)}
              className='hover:bg-base-300 text-base-content/85 rounded px-2 py-1'
            >
              {_('All')}
            </button>
            {getBreadcrumbs(currentGroupPath).map((crumb, index, array) => {
              const isLast = index === array.length - 1;
              return (
                <React.Fragment key={index}>
                  <MdChevronRight size={iconSize} className='text-neutral-content' />
                  {isLast ? (
                    <span className='truncate rounded px-2 py-1'>{crumb.name}</span>
                  ) : (
                    <button
                      onClick={() => handleNavigateToPath(crumb.path)}
                      className='hover:bg-base-300 text-base-content/85 truncate rounded px-2 py-1'
                    >
                      {crumb.name}
                    </button>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}
      {currentSeriesAuthorGroup && (
        <GroupHeader
          groupBy={currentSeriesAuthorGroup.groupBy}
          groupName={currentSeriesAuthorGroup.groupName}
        />
      )}
      {showBookshelf &&
        (libraryBooks.some((book) => !book.deletedAt) ? (
          <OverlayScrollbarsComponent
            defer
            aria-label=''
            ref={osRef}
            className='flex-grow'
            options={{ scrollbars: { autoHide: 'scroll' } }}
            events={{
              initialized: (instance) => {
                const { content } = instance.elements();
                if (content) {
                  containerRef.current = content as HTMLDivElement;
                }
              },
            }}
          >
            <div
              className={clsx('scroll-container drop-zone flex-grow', isDragging && 'drag-over')}
              style={{
                paddingTop: '0px',
                paddingRight: `${insets.right}px`,
                paddingBottom: `${insets.bottom}px`,
                paddingLeft: `${insets.left}px`,
              }}
            >
              <DropIndicator />
              <Bookshelf
                libraryBooks={libraryBooks}
                isSelectMode={isSelectMode}
                isSelectAll={isSelectAll}
                isSelectNone={isSelectNone}
                handleImportBooks={handleImportBooksFromFiles}
                handleBookUpload={handleBookUpload}
                handleBookDownload={handleBookDownload}
                handleBookDelete={handleBookDelete('both')}
                handleSetSelectMode={handleSetSelectMode}
                handleShowDetailsBook={handleShowDetailsBook}
                handleLibraryNavigation={handleLibraryNavigation}
                booksTransferProgress={booksTransferProgress}
                handlePushLibrary={pushLibrary}
              />
            </div>
          </OverlayScrollbarsComponent>
        ) : (
          <div className='hero drop-zone h-screen items-center justify-center'>
            <DropIndicator />
            <div className='hero-content text-neutral-content text-center'>
              <div className='max-w-md'>
                <h1 className='mb-5 text-5xl font-bold'>{_('Your Library')}</h1>
                <p className='mb-5'>
                  {_(
                    'Welcome to your library. You can import your books here and read them anytime.',
                  )}
                </p>
                <button className='btn btn-primary rounded-xl' onClick={handleImportBooksFromFiles}>
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
          handleBookUpload={handleBookUpload}
          handleBookDownload={handleBookDownload}
          handleBookDelete={handleBookDelete('both')}
          handleBookDeleteCloudBackup={handleBookDelete('cloud')}
          handleBookDeleteLocalCopy={handleBookDelete('local')}
          handleBookMetadataUpdate={handleUpdateMetadata}
        />
      )}
      {isTransferQueueOpen && (
        <ModalPortal>
          <TransferQueuePanel />
        </ModalPortal>
      )}
      <AboutWindow />
      <UpdaterWindow />
      <MigrateDataWindow />
      {isSettingsDialogOpen && <SettingsDialog bookKey={''} />}
      {showCatalogManager && <CatalogDialog onClose={handleDismissOPDSDialog} />}
      <Toast />
    </div>
  );
};

const LibraryPage = () => {
  return (
    <Suspense fallback={<div className='full-height' />}>
      <LibraryPageWithSearchParams />
    </Suspense>
  );
};

export default LibraryPage;
