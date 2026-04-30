'use client';

import clsx from 'clsx';
import * as React from 'react';
import { MdChevronRight } from 'react-icons/md';
import { useState, useRef, useEffect, Suspense, useCallback, useMemo } from 'react';
import { ReadonlyURLSearchParams, useSearchParams } from 'next/navigation';

import { Book } from '@/types/book';
import { AppService, DeleteAction } from '@/types/system';
import { buildBookLookupIndex } from '@/services/bookService';
import { navigateToLibrary, navigateToReader } from '@/utils/nav';
import { formatAuthors, formatTitle, getPrimaryLanguage, listFormater } from '@/utils/book';
import { getImportErrorMessage } from '@/services/errors';
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
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
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

import { LibraryGroupByType, LibrarySortByType, LibraryViewModeType } from '@/types/settings';
import { BookMetadata } from '@/libs/document';
import { AboutWindow } from '@/components/AboutWindow';
import { KeyboardShortcutsHelp } from '@/components/KeyboardShortcutsHelp';
import { BookDetailModal } from '@/components/metadata';
import { UpdaterWindow } from '@/components/UpdaterWindow';
import { CatalogDialog } from './components/OPDSDialog';
import { MigrateDataWindow } from './components/MigrateDataWindow';
import { BackupWindow } from './components/BackupWindow';
import { useDragDropImport } from './hooks/useDragDropImport';
import { useTransferQueue } from '@/hooks/useTransferQueue';
import { useAppRouter } from '@/hooks/useAppRouter';
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

const LIBRARY_GROUP_LABELS: Record<LibraryGroupByType, string> = {
  [LibraryGroupByType.None]: 'Collection',
  [LibraryGroupByType.Group]: 'Shelves',
  [LibraryGroupByType.Series]: 'Series',
  [LibraryGroupByType.Author]: 'Authors',
};

const LIBRARY_SORT_LABELS: Record<LibrarySortByType, string> = {
  [LibrarySortByType.Title]: 'Title',
  [LibrarySortByType.Author]: 'Author',
  [LibrarySortByType.Updated]: 'Recently Read',
  [LibrarySortByType.Created]: 'Recently Added',
  [LibrarySortByType.Series]: 'Series',
  [LibrarySortByType.Size]: 'Length',
  [LibrarySortByType.Format]: 'Format',
  [LibrarySortByType.Published]: 'Publication Date',
};

const LibraryPageWithSearchParams = () => {
  const searchParams = useSearchParams();
  return <LibraryPageContent searchParams={searchParams} />;
};

const LibraryPageContent = ({ searchParams }: { searchParams: ReadonlyURLSearchParams | null }) => {
  const router = useAppRouter();
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
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const handleScrollerRef = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
  }, []);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  const getScrollKey = (group: string) => `library-scroll-${group || 'all'}`;

  const saveScrollPosition = (group: string) => {
    if (scrollRef.current) {
      sessionStorage.setItem(getScrollKey(group), scrollRef.current.scrollTop.toString());
    }
  };

  const restoreScrollPosition = useCallback((group: string) => {
    const savedPosition = sessionStorage.getItem(getScrollKey(group));
    if (savedPosition && scrollRef.current) {
      scrollRef.current.scrollTop = parseInt(savedPosition, 10);
    }
  }, []);

  useTheme({ systemUIVisible: true, appThemeColor: 'base-200' });
  useUICSS();

  useOpenWithBooks();
  useTransferQueue(libraryLoaded);

  const { pullLibrary, pushLibrary } = useBooksSync();
  const { isDragging } = useDragDropImport();

  usePullToRefresh(
    scrollRef,
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

  // Strip the empty `group=` param that `handleLibraryNavigation` sets as a
  // workaround for a Next.js 16.2 static-export regression (see the NOTE
  // above `handleLibraryNavigation` for full context). This effect runs
  // after the router.replace() has committed, so React has already
  // re-rendered with the new (empty) group state; we're only rewriting the
  // URL cosmetically via window.history.replaceState — Next.js' patched
  // replaceState will pick up the new canonical URL without triggering
  // another navigation.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (searchParams?.get('group') !== '') return;
    const url = new URL(window.location.href);
    url.searchParams.delete('group');
    const cleanHref = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(null, '', cleanHref);
  }, [searchParams]);

  // Unified navigation function that handles scroll position and direction.
  // Workaround for a Next.js 16.2 static-export regression: navigating to a
  // same-pathname URL with an empty search string causes `router.replace()`
  // to silently no-op (e.g. `/library?group=foo` -> `/library`), which broke
  // the breadcrumb "All" button. By always calling `params.set('group',
  // targetGroup)` — including when `targetGroup` is an empty string — the
  // resulting URL becomes `/library?group=` instead of `/library`, which
  // Next.js does commit. The trailing empty `group=` is stripped via a
  // cleanup effect below (purely cosmetic URL rewrite). See
  // https://github.com/readest/readest/issues/3782.
  const handleLibraryNavigation = useCallback(
    (targetGroup: string) => {
      const currentGroup = searchParams?.get('group') || '';

      // Save current scroll position BEFORE navigation
      saveScrollPosition(currentGroup);

      // Detect and set navigation direction
      const direction = currentGroup && !targetGroup ? 'back' : 'forward';
      document.documentElement.setAttribute('data-nav-direction', direction);

      // Build query params — always `set` so the search string is non-empty
      // even when targetGroup is '' (the Next.js 16.2 workaround).
      const params = new URLSearchParams(searchParams?.toString());
      params.set('group', targetGroup);

      navigateToLibrary(router, `${params.toString()}`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchParams, router],
  );

  const handleBackUpOneGroupLevel = () => {
    if (!currentGroupPath) return;
    const segments = currentGroupPath.split('/');
    const parentPath = segments.length > 1 ? segments.slice(0, -1).join('/') : undefined;
    const parentGroupId = parentPath ? getGroupId(parentPath) || '' : '';
    setIsSelectAll(false);
    setIsSelectNone(false);
    handleLibraryNavigation(parentGroupId);
  };

  const handleBackUpOneGroupLevelRef = useRef(handleBackUpOneGroupLevel);
  handleBackUpOneGroupLevelRef.current = handleBackUpOneGroupLevel;
  const triggerBackUpOneGroupLevel = useCallback(() => handleBackUpOneGroupLevelRef.current(), []);

  useKeyDownActions({
    onCancel: triggerBackUpOneGroupLevel,
    enabled: !!appService?.isAndroidApp && !!currentGroupPath,
  });

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

  useEffect(() => {
    if (appService?.hasWindow) {
      const currentWebview = getCurrentWebview();
      const unlisten = currentWebview.listen('close-reader-window', async () => {
        // Reader windows are independent Tauri webviews with their own
        // libraryStore instance — progress / readingStatus / move-to-front
        // updates from the reader window do NOT propagate to this main
        // window's store. Reload from disk so the library reflects the
        // changes the reader just persisted.
        const appService = await envConfig.getAppService();
        const settings = await appService.loadSettings();
        const library = await appService.loadLibraryBooks();
        setSettings(settings);
        setLibrary(library);
      });
      return () => {
        unlisten.then((fn) => fn());
      };
    }
    return;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService, envConfig]);

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
          const book = await appService.importBook(file, libraryBooks, { transient: temp });
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

    const loadingTimeout = setTimeout(() => setLoading(true), 500);
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
    // searchParams is used to tigger parsing OPEN_WITH_FILES
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
    // Build the lookup index ONCE per import batch so each book lookup is
    // O(1) instead of O(n) over the existing library. importBook also keeps
    // the index updated as new books are appended, so subsequent files in
    // the same batch see the additions.
    const lookupIndex = buildBookLookupIndex(library);
    const failedImports: Array<{ filename: string; errorMessage: string }> = [];
    const successfulImports: string[] = [];

    const processFile = async (selectedFile: SelectedFile): Promise<Book | null> => {
      const file = selectedFile.file || selectedFile.path;
      if (!file) return null;
      try {
        const book = await appService?.importBook(file, library, { lookupIndex });
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
        const errorMessage = error instanceof Error ? _(getImportErrorMessage(error.message)) : '';
        failedImports.push({ filename: baseFilename, errorMessage });
        console.error('Failed to import book:', filename, error);
        return null;
      }
    };

    const concurrency = 4;
    for (let i = 0; i < files.length; i += concurrency) {
      const batch = files.slice(i, i + concurrency);
      const importedBooks = (await Promise.all(batch.map(processFile))).filter((book) => !!book);
      // Update store state per batch (so the UI can render imported books
      // incrementally) but defer disk persistence until the entire batch is
      // done — saving library.json once per batch of 4 books was the dominant
      // cost for large imports.
      await updateBooks(envConfig, importedBooks, { skipSave: true });
    }

    // Persist the full library once after every file in the batch is done.
    if (successfulImports.length > 0) {
      const finalLibrary = useLibraryStore.getState().library;
      const finalAppService = await envConfig.getAppService();
      await finalAppService.saveLibraryBooks(finalLibrary);
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

  const rawGroupBy = searchParams?.get('groupBy');
  const currentGroupId = searchParams?.get('group') || '';
  const currentViewMode = ((searchParams?.get('view') || 'grid') as LibraryViewModeType) || 'grid';
  const currentSortBy = (searchParams?.get('sort') || settings.librarySortBy) as LibrarySortByType;
  const currentSortOrder =
    searchParams?.get('order') || (settings.librarySortAscending ? 'asc' : 'desc');
  const currentGroupBy = currentGroupId
    ? ensureLibraryGroupByType(rawGroupBy, settings.libraryGroupBy)
    : ensureLibraryGroupByType(rawGroupBy, LibraryGroupByType.None);
  const currentQuery = searchParams?.get('q') || '';
  const visibleBooks = useMemo(
    () => libraryBooks.filter((book) => !book.deletedAt),
    [libraryBooks],
  );
  const collectionStats = useMemo(() => {
    const seriesCount = createBookGroups(visibleBooks, LibraryGroupByType.Series).filter(
      (item) => 'books' in item,
    ).length;
    const authorCount = createBookGroups(visibleBooks, LibraryGroupByType.Author).filter(
      (item) => 'books' in item,
    ).length;
    const pagesRead = visibleBooks.reduce((total, book) => total + (book.progress?.[0] || 0), 0);

    return {
      books: visibleBooks.length,
      series: seriesCount,
      authors: authorCount,
      pagesRead,
    };
  }, [visibleBooks]);

  const sidebarItems = useMemo(
    () => [
      {
        key: 'collection',
        label: _('Collection'),
        description: _('All books'),
        active: currentGroupBy === LibraryGroupByType.None && !currentGroupId,
        onClick: () => {
          const params = new URLSearchParams(searchParams?.toString());
          params.delete('group');
          params.delete('q');
          params.set('groupBy', LibraryGroupByType.None);
          params.set('view', 'grid');
          navigateToLibrary(router, params.toString());
        },
      },
      {
        key: 'shelves',
        label: _('Shelves'),
        description: _('Nested groups'),
        active: currentGroupBy === LibraryGroupByType.Group,
        onClick: () => {
          const params = new URLSearchParams(searchParams?.toString());
          params.delete('group');
          params.set('groupBy', LibraryGroupByType.Group);
          navigateToLibrary(router, params.toString());
        },
      },
      {
        key: 'series',
        label: _('Series'),
        description: _('Ordered sagas'),
        active: currentGroupBy === LibraryGroupByType.Series,
        onClick: () => {
          const params = new URLSearchParams(searchParams?.toString());
          params.delete('group');
          params.set('groupBy', LibraryGroupByType.Series);
          navigateToLibrary(router, params.toString());
        },
      },
      {
        key: 'authors',
        label: _('Authors'),
        description: _('By writer'),
        active: currentGroupBy === LibraryGroupByType.Author,
        onClick: () => {
          const params = new URLSearchParams(searchParams?.toString());
          params.delete('group');
          params.set('groupBy', LibraryGroupByType.Author);
          navigateToLibrary(router, params.toString());
        },
      },
      {
        key: 'recent',
        label: _('Recent'),
        description: _('Latest arrivals'),
        active: currentSortBy === LibrarySortByType.Created && currentSortOrder === 'desc',
        onClick: () => {
          const params = new URLSearchParams(searchParams?.toString());
          params.set('sort', LibrarySortByType.Created);
          params.set('order', 'desc');
          navigateToLibrary(router, params.toString());
        },
      },
    ],
    [_, currentGroupBy, currentGroupId, currentSortBy, currentSortOrder, router, searchParams],
  );

  const activeCollectionLabel = currentGroupId
    ? currentSeriesAuthorGroup?.groupName || currentGroupPath?.split('/').at(-1) || _('Collection')
    : _(LIBRARY_GROUP_LABELS[currentGroupBy] || 'Collection');
  const activeSortLabel = _(LIBRARY_SORT_LABELS[currentSortBy] || 'Recently Added');
  const panelSubtitle = currentQuery
    ? _('Search results for "{{query}}"', { query: currentQuery })
    : _('A curated hall for every volume in your collection.');

  const updatePanelParams = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams?.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (!value) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });
    navigateToLibrary(router, params.toString());
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (currentGroupId || rawGroupBy || searchParams?.get('view')) return;
    const params = new URLSearchParams(searchParams?.toString());
    params.set('groupBy', LibraryGroupByType.None);
    params.set('view', 'grid');
    const nextUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    window.history.replaceState(null, '', nextUrl);
  }, [currentGroupId, rawGroupBy, searchParams]);

  if (!appService || !insets || checkOpenWithBooks || checkLastOpenBooks) {
    return <div className={clsx('full-height', !appService?.isLinuxApp && 'bg-base-200')} />;
  }

  const showBookshelf = libraryLoaded || libraryBooks.length > 0;

  return (
    <div
      ref={pageRef}
      aria-label={_('Your Library')}
      className={clsx(
        'library-page text-base-content full-height relative flex select-none flex-col overflow-hidden bg-[#050404]',
        viewSettings?.isEink ? 'bg-base-100' : '',
        appService?.hasRoundedWindow && isRoundedWindow && 'window-border rounded-window',
      )}
      style={{
        backgroundImage: `
          radial-gradient(circle at 58% 24%, rgba(134, 15, 11, 0.34) 0%, rgba(76, 8, 7, 0.16) 24%, rgba(16, 7, 8, 0.02) 48%, transparent 62%),
          radial-gradient(circle at 30% 78%, rgba(70, 9, 8, 0.12) 0%, transparent 46%),
          linear-gradient(180deg, rgba(8, 7, 7, 0.98) 0%, rgba(5, 5, 5, 1) 100%)
        `,
      }}
    >
      <style jsx global>{`
        .library-page {
          --library-card-height: 178px;
          --library-grid-gap: 18px;
          --library-grid-viewport-height: 570px;
        }

        .library-page .bookshelf .bookshelf-grid-viewport {
          scrollbar-color: rgba(184, 137, 47, 0.42) transparent;
        }

        .library-page .bookshelf .bookshelf-items {
          width: 100%;
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          grid-auto-rows: var(--library-card-height);
          gap: var(--library-grid-gap);
        }

        .library-page .bookshelf .bookshelf-items > div {
          width: 100%;
          height: var(--library-card-height);
          min-width: 0;
          max-width: none;
        }

        @media (min-width: 768px) {
          .library-page .bookshelf .bookshelf-items {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (min-width: 1280px) {
          .library-page .bookshelf .bookshelf-items {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .library-page .bookshelf .bookshelf-grid-viewport {
            height: min(100%, var(--library-grid-viewport-height));
            max-height: min(100%, var(--library-grid-viewport-height));
          }
        }

        @media (min-width: 1680px) {
          .library-page .bookshelf .bookshelf-items {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
        }
      `}</style>
      <div
        aria-hidden='true'
        className='pointer-events-none absolute inset-0'
        style={{
          background:
            'radial-gradient(circle at 60% 34%, rgba(151, 18, 15, 0.18) 0%, rgba(86, 10, 9, 0.1) 28%, transparent 66%)',
        }}
      />
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
      <div
        className='relative z-10 flex min-h-0 flex-1 gap-4 px-4 pb-4 pt-4 sm:px-6 sm:pb-6'
        style={{
          paddingLeft: `max(${insets.left}px + 16px, 16px)`,
          paddingRight: `max(${insets.right}px + 16px, 16px)`,
          paddingBottom: `max(${insets.bottom}px + 16px, 16px)`,
        }}
      >
        <aside className='hidden w-[224px] shrink-0 xl:flex'>
          <div className='flex h-full w-full flex-col rounded-[30px] border border-[rgba(185,133,44,0.14)] bg-[linear-gradient(180deg,rgba(12,11,11,0.92)_0%,rgba(9,9,9,0.86)_100%)] px-6 py-7 shadow-[0_24px_52px_rgba(0,0,0,0.34)]'>
            <div className='border-b border-[rgba(185,133,44,0.16)] pb-6'>
              <img
                src='/citadel/citadel-logo.png'
                alt='Citadel'
                className='h-auto w-[148px] object-contain'
                draggable={false}
              />
              <p className='mt-4 text-[11px] uppercase tracking-[0.28em] text-[#8e7451]'>
                {_('Library Wing')}
              </p>
            </div>

            <nav className='mt-6 flex flex-col gap-2' aria-label={_('Library navigation')}>
              {sidebarItems.map((item) => (
                <button
                  key={item.key}
                  type='button'
                  onClick={item.onClick}
                  className={clsx(
                    'group relative overflow-hidden rounded-[18px] border px-4 py-3 text-left transition-all duration-200',
                    item.active
                      ? 'border-[rgba(185,133,44,0.28)] bg-[linear-gradient(90deg,rgba(68,10,9,0.44)_0%,rgba(19,13,10,0.82)_70%,rgba(12,11,10,0.82)_100%)] shadow-[0_0_0_1px_rgba(185,133,44,0.08),0_12px_24px_rgba(84,8,8,0.18)]'
                      : 'border-transparent bg-transparent hover:border-[rgba(185,133,44,0.12)] hover:bg-[rgba(255,255,255,0.02)]',
                  )}
                >
                  <span
                    className={clsx(
                      'absolute inset-y-3 left-0 w-[2px] rounded-full transition-opacity',
                      item.active
                        ? 'bg-[#7d1310] opacity-100 shadow-[0_0_10px_rgba(153,24,19,0.6)]'
                        : 'opacity-0',
                    )}
                  />
                  <span
                    className={clsx(
                      'block text-[13px] font-medium uppercase tracking-[0.18em]',
                      item.active ? 'text-[#cfae73]' : 'text-[#836d4c] group-hover:text-[#b89862]',
                    )}
                  >
                    {item.label}
                  </span>
                  <span className='mt-1 block text-[11px] text-[#746451]'>{item.description}</span>
                </button>
              ))}
            </nav>

            <div className='mt-auto pt-8'>
              <div className='mb-5 h-px bg-[linear-gradient(90deg,transparent,rgba(185,133,44,0.3),transparent)]' />
              <p className='text-[11px] uppercase tracking-[0.26em] text-[#8d7450]'>
                {_('Collection Stats')}
              </p>
              <dl className='mt-5 space-y-4'>
                <div className='flex items-end justify-between gap-4'>
                  <dt className='text-xs uppercase tracking-[0.12em] text-[#72614d]'>
                    {_('Books')}
                  </dt>
                  <dd className='text-lg text-[#d7bd8d]'>{collectionStats.books}</dd>
                </div>
                <div className='flex items-end justify-between gap-4'>
                  <dt className='text-xs uppercase tracking-[0.12em] text-[#72614d]'>
                    {_('Series')}
                  </dt>
                  <dd className='text-lg text-[#d7bd8d]'>{collectionStats.series}</dd>
                </div>
                <div className='flex items-end justify-between gap-4'>
                  <dt className='text-xs uppercase tracking-[0.12em] text-[#72614d]'>
                    {_('Authors')}
                  </dt>
                  <dd className='text-lg text-[#d7bd8d]'>{collectionStats.authors}</dd>
                </div>
                <div className='flex items-end justify-between gap-4'>
                  <dt className='text-xs uppercase tracking-[0.12em] text-[#72614d]'>
                    {_('Pages Read')}
                  </dt>
                  <dd className='text-lg text-[#d7bd8d]'>
                    {collectionStats.pagesRead.toLocaleString()}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </aside>

        <section className='relative flex min-h-0 flex-1'>
          <div
            aria-hidden='true'
            className='pointer-events-none absolute inset-x-[9%] inset-y-[6%] rounded-[42px] blur-[58px]'
            style={{
              background:
                'radial-gradient(circle at 50% 28%, rgba(151, 18, 15, 0.2) 0%, rgba(86, 10, 9, 0.12) 28%, transparent 66%)',
            }}
          />
          <div className='relative flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-[34px] border border-[rgba(185,133,44,0.24)] bg-[linear-gradient(180deg,rgba(16,14,14,0.94)_0%,rgba(9,9,9,0.92)_100%)] shadow-[0_24px_70px_rgba(0,0,0,0.42),0_0_0_1px_rgba(255,223,168,0.04)]'>
            <div className='border-b border-[rgba(185,133,44,0.14)] px-6 pb-4 pt-5 sm:px-8 sm:pb-5 sm:pt-6'>
              <div className='flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between'>
                <div className='min-w-0'>
                  <p
                    className='text-[clamp(2rem,3vw,2.8rem)] uppercase leading-none tracking-[0.16em] text-[#d4b57b]'
                    style={{ fontFamily: 'Georgia, Palatino, "Palatino Linotype", serif' }}
                  >
                    {_('Citadel Library')}
                  </p>
                  <div className='mt-3 flex items-center gap-3'>
                    <span className='h-px w-16 bg-[rgba(185,133,44,0.4)]' />
                    <span className='h-1.5 w-1.5 rounded-full bg-[#9b6a1e]' />
                    <span className='h-px w-16 bg-[rgba(185,133,44,0.4)]' />
                  </div>
                  <p className='mt-3 max-w-2xl text-sm text-[#a3937d]'>{panelSubtitle}</p>
                </div>

                <div className='flex flex-col items-start gap-4 xl:items-end'>
                  <div className='flex flex-wrap items-center gap-3 text-sm'>
                    <span className='uppercase tracking-[0.16em] text-[#7d6b54]'>
                      {_('Sort by')}:
                    </span>
                    <span className='rounded-full border border-[rgba(185,133,44,0.18)] bg-[rgba(255,255,255,0.02)] px-3 py-1 text-[#d2b57d]'>
                      {activeSortLabel}
                    </span>
                    <span className='text-xs uppercase tracking-[0.16em] text-[#74634f]'>
                      {currentSortOrder === 'asc' ? _('Ascending') : _('Descending')}
                    </span>
                  </div>

                  <div className='flex flex-wrap items-center gap-3'>
                    <span className='rounded-full border border-[rgba(185,133,44,0.14)] bg-[rgba(255,255,255,0.02)] px-3 py-1 text-xs uppercase tracking-[0.16em] text-[#b2915e]'>
                      {activeCollectionLabel}
                    </span>
                    <div className='inline-flex rounded-full border border-[rgba(185,133,44,0.18)] bg-[rgba(0,0,0,0.24)] p-1'>
                      {(
                        [
                          { label: _('Grid'), value: 'grid' },
                          { label: _('List'), value: 'list' },
                        ] as const
                      ).map((option) => (
                        <button
                          key={option.value}
                          type='button'
                          onClick={() => updatePanelParams({ view: option.value })}
                          className={clsx(
                            'rounded-full px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] transition-colors',
                            currentViewMode === option.value
                              ? 'bg-[rgba(185,133,44,0.16)] text-[#ddc592]'
                              : 'text-[#846e4a] hover:text-[#c9ab77]',
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {currentGroupPath && (
                <div className='mt-4 rounded-[18px] border border-[rgba(185,133,44,0.12)] bg-[rgba(255,255,255,0.02)] px-4 py-3'>
                  <div className='flex flex-wrap items-center gap-y-1 text-sm text-[#927b58]'>
                    <button
                      onClick={() => handleNavigateToPath(undefined)}
                      className='rounded-full px-2.5 py-1 transition-colors hover:bg-[rgba(185,133,44,0.08)] hover:text-[#dcc18a]'
                    >
                      {_('All')}
                    </button>
                    {getBreadcrumbs(currentGroupPath).map((crumb, index, array) => {
                      const isLast = index === array.length - 1;
                      return (
                        <React.Fragment key={index}>
                          <MdChevronRight size={iconSize} className='text-[#6f604d]' />
                          {isLast ? (
                            <span className='truncate rounded-full px-2.5 py-1 text-[#dcc18a]'>
                              {crumb.name}
                            </span>
                          ) : (
                            <button
                              onClick={() => handleNavigateToPath(crumb.path)}
                              className='truncate rounded-full px-2.5 py-1 transition-colors hover:bg-[rgba(185,133,44,0.08)] hover:text-[#dcc18a]'
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
            </div>

            {currentSeriesAuthorGroup && (
              <GroupHeader
                groupBy={currentSeriesAuthorGroup.groupBy}
                groupName={currentSeriesAuthorGroup.groupName}
              />
            )}

            {showBookshelf &&
              (visibleBooks.length > 0 ? (
                <div aria-label={_('Your Bookshelf')} className='flex min-h-0 flex-1 flex-col'>
                  <div className='px-6 pb-2 pt-3 sm:px-8'>
                    <p className='text-xs uppercase tracking-[0.16em] text-[#8d7450]'>
                      {_('Your Collection')}
                    </p>
                    <p className='mt-1 text-sm text-[#968671]'>
                      {_(
                        'Everything you imported is arranged here in a calmer, more readable view.',
                      )}
                    </p>
                  </div>
                  <div
                    ref={containerRef}
                    className={clsx(
                      'scroll-container drop-zone flex min-h-0 flex-1 flex-col px-1 pb-4',
                      isDragging && 'drag-over',
                    )}
                  >
                    <DropIndicator />
                    <Bookshelf
                      libraryBooks={libraryBooks}
                      isSelectMode={isSelectMode}
                      isSelectAll={isSelectAll}
                      isSelectNone={isSelectNone}
                      onScrollerRef={handleScrollerRef}
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
                </div>
              ) : (
                <div className='hero drop-zone flex min-h-0 flex-1 items-center justify-center px-6 py-10 sm:px-8'>
                  <DropIndicator />
                  <div className='hero-content text-center'>
                    <div className='max-w-xl rounded-[30px] border border-[rgba(185,133,44,0.26)] bg-[linear-gradient(180deg,rgba(15,14,14,0.92)_0%,rgba(9,9,9,0.84)_100%)] px-8 py-10 shadow-[0_24px_70px_rgba(0,0,0,0.4)]'>
                      <p className='text-xs font-semibold uppercase tracking-[0.2em] text-[#c39b56]'>
                        {_('Citadel Library')}
                      </p>
                      <h1
                        className='mt-4 text-3xl text-[#f1e8d9] sm:text-4xl'
                        style={{ fontFamily: 'Georgia, Palatino, "Palatino Linotype", serif' }}
                      >
                        {_('A calm place for your books')}
                      </h1>
                      <p className='mx-auto mt-3 max-w-md text-sm text-[#93826c] sm:text-base'>
                        {_(
                          'Start your collection and keep your next read close. Import a few titles to make this space yours.',
                        )}
                      </p>
                      <button
                        className='mt-6 rounded-full border border-[rgba(185,133,44,0.4)] px-5 py-2 text-sm uppercase tracking-[0.14em] text-[#d6ba86] transition-colors hover:bg-[rgba(185,133,44,0.12)]'
                        onClick={handleImportBooksFromFiles}
                      >
                        {_('Import Books')}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </section>
      </div>
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
      <KeyboardShortcutsHelp />
      <UpdaterWindow />
      <MigrateDataWindow />
      <BackupWindow onPullLibrary={pullLibrary} />
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
