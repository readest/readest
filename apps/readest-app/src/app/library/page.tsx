'use client';

import clsx from 'clsx';
import * as React from 'react';
import { MdChevronRight } from 'react-icons/md';
import { useState, useRef, useEffect, Suspense, useCallback } from 'react';
import { ReadonlyURLSearchParams, useSearchParams } from 'next/navigation';

import { Book } from '@/types/book';
import { AppService, DeleteAction } from '@/types/system';
import {
  buildBookLookupIndex,
  collectKnownSourcePaths,
  normalizeFilePathForIndex,
  selectNewImportableFiles,
} from '@/services/bookService';
import { navigateToLibrary, navigateToLogin, navigateToReader } from '@/utils/nav';
import { getBookWithUpdatedMetadata, listFormater } from '@/utils/book';
import { getImportErrorMessage } from '@/services/errors';
import { ingestFile } from '@/services/ingestService';
import { eventDispatcher } from '@/utils/event';
import { ProgressPayload } from '@/utils/transfer';
import { throttle } from '@/utils/throttle';
import { transferManager } from '@/services/transferManager';
import {
  getCloudSyncProvider,
  isReadestCloudStorageActive,
} from '@/services/sync/cloudSyncProvider';
import {
  runActiveFileBookDownload,
  runActiveFileBookUpload,
} from '@/services/sync/file/runLibrarySync';
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
import { useLibraryFileSync } from './hooks/useLibraryFileSync';
import { useAutoImportFolders } from './hooks/useAutoImportFolders';
import { useInboxDrainer } from '@/hooks/useInboxDrainer';
import { useOPDSSubscriptions } from '@/hooks/useOPDSSubscriptions';
import { useBookDataStore } from '@/store/bookDataStore';
import { useTransferStore } from '@/store/transferStore';
import { useScreenWakeLock } from '@/hooks/useScreenWakeLock';
import { useBackgroundTexture } from '@/hooks/useBackgroundTexture';
import { getLibraryViewSettings } from '@/helpers/settings';
import { useAppUrlIngress } from '@/hooks/useAppUrlIngress';
import { useOpenWithBooks } from '@/hooks/useOpenWithBooks';
import { useOpenAnnotationLink } from '@/hooks/useOpenAnnotationLink';
import { useOpenBookLink } from '@/hooks/useOpenBookLink';
import { useReadingWidget } from '@/hooks/useReadingWidget';
import { useOpenShareLink } from '@/hooks/useOpenShareLink';
import { useClipUrlIngress } from '@/hooks/useClipUrlIngress';
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

import { LibraryGroupByType } from '@/types/settings';
import { BookMetadata } from '@/libs/document';
import { AboutWindow } from '@/components/AboutWindow';
import { KeyboardShortcutsHelp } from '@/components/KeyboardShortcutsHelp';
import { BookDetailModal } from '@/components/metadata';
import { UpdaterWindow } from '@/components/UpdaterWindow';
import { CatalogDialog } from './components/OPDSDialog';
import { MigrateDataWindow } from './components/MigrateDataWindow';
import { BackupWindow } from './components/BackupWindow';
import { CacheManagerWindow } from './components/CacheManagerWindow';
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
import LibraryEmptyState from './components/LibraryEmptyState';
import GroupHeader from './components/GroupHeader';
import FailedImportsDialog, { FailedImport } from './components/FailedImportsDialog';
import ImportFromFolderDialog, {
  ImportFromFolderResult,
} from './components/ImportFromFolderDialog';
import ImportFromUrlDialog from './components/ImportFromUrlDialog';
import NowPlayingBar from './components/NowPlayingBar';
import { ttsSessionManager } from '@/services/tts';
import { convertToEpubWithWorker } from '@/services/send/conversion/conversionWorker';
import { getClipOptions } from '@/services/send/clipOptions';
import { invoke } from '@tauri-apps/api/core';
import useShortcuts from '@/hooks/useShortcuts';
import { useReplicaPull } from '@/hooks/useReplicaPull';
import { useCustomFonts } from '@/hooks/useCustomFonts';
import DropIndicator from '@/components/DropIndicator';
import SettingsDialog from '@/components/settings/SettingsDialog';
import ModalPortal from '@/components/ModalPortal';
import TransferQueuePanel from './components/TransferQueuePanel';

/** Skip tiny non-book artifacts during folder auto-scan (matches the manual import dialog default). */
const AUTO_IMPORT_MIN_SIZE_BYTES = 20 * 1024;

/**
 * Key used to persist the last directory the user imported books from.
 * Stored in localStorage so re-opening the dialog (even across app
 * restarts) seeds the path field with their previous choice — this
 * mirrors the behaviour of native file pickers on most desktop OSes.
 */
const LAST_IMPORT_FOLDER_KEY = 'readest:lastImportFolder';
/**
 * Key used to persist the user's last "Folder Structure" choice
 * ('keep' vs 'flatten'). Restored as the default radio selection on
 * the next dialog open.
 */
const LAST_IMPORT_FOLDER_MODE_KEY = 'readest:lastImportFolderMode';
/**
 * Key used to persist the comma-separated list of FormatGroup ids the
 * user last ticked, e.g. "epub,pdf". Empty / missing falls back to the
 * dialog's built-in default ("epub,pdf").
 */
const LAST_IMPORT_FOLDER_FORMATS_KEY = 'readest:lastImportFolderFormats';
/**
 * Key used to persist the last "File size larger than" threshold (KB).
 * Stored as a stringified non-negative integer.
 */
const LAST_IMPORT_FOLDER_MIN_SIZE_KEY = 'readest:lastImportFolderMinSizeKB';
/**
 * Key used to persist the last "Read books in place" toggle value
 * (`'1'` or `'0'`). Restored as the dialog's initial toggle state.
 * The toggle only matters for fresh, not-yet-registered folders —
 * once a folder is registered as an external library folder, the
 * dialog forces the toggle ON regardless of this value.
 */
const LAST_IMPORT_FOLDER_READ_IN_PLACE_KEY = 'readest:lastImportFolderReadInPlace';

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
    libraryLoaded: libraryLoadedFromDisk,
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

  // Library page pulls user replicas (dictionaries, custom fonts,
  // background textures, OPDS catalogs, bundled settings). Deferred
  // 10s; module-scoped dedup means a later navigation to the reader
  // won't re-pull the same kind.
  useReplicaPull({
    kinds: ['dictionary', 'font', 'texture', 'opds_catalog', 'settings'],
  });
  // Hydrate the custom-font store from persisted settings so the Font
  // panel sees imported fonts even when opened straight from the
  // library — the replica pull above is auth-gated and the reader's
  // FoliateViewer hydration never runs without a book open.
  useCustomFonts();
  const [showCatalogManager, setShowCatalogManager] = useState(
    searchParams?.get('opds') === 'true',
  );
  const [showImportFromUrl, setShowImportFromUrl] = useState(false);
  const [loading, setLoading] = useState(false);
  // Seed from the library store: if we already have books in memory (the
  // common reader → library return path), treat the page as loaded
  // immediately. This prevents `showBookshelf` from briefly being false on
  // remount, which used to flash a placeholder before `initLibrary` finished.
  const [libraryLoaded, setLibraryLoaded] = useState(() => libraryBooks.length > 0);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [isSelectAll, setIsSelectAll] = useState(false);
  const [isSelectNone, setIsSelectNone] = useState(false);
  const [showDetailsBook, setShowDetailsBook] = useState<Book | null>(null);
  const [failedImportsModal, setFailedImportsModal] = useState<FailedImport[] | null>(null);
  // "Import from folder" dialog state. Held as a small object rather
  // than a boolean because we need a default starting directory to seed
  // the path field, and we want the dialog to remain mounted long
  // enough for the platform's folder picker to overlay it.
  const [importFromFolderState, setImportFromFolderState] = useState<{
    initialDirectory: string;
    initialFolderMode: 'keep' | 'flatten';
    initialSelectedGroupIds?: string[];
    initialMinSizeKB?: number;
    initialReadInPlace?: boolean;
    initialAutoImport?: boolean;
  } | null>(null);
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
  // Tracks paths that failed to import in this session so auto-import does not
  // re-attempt (and re-toast) them on every subsequent folder scan.
  const autoImportFailedPathsRef = useRef<Set<string>>(new Set());

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

  // Apply the library's own background texture (separate from the reader's,
  // issue #4743). Re-applies on mount so returning from a textured book
  // restores the library background, and whenever the library texture — or the
  // reader/global texture it inherits when unset — changes from the Color panel.
  const { applyBackgroundTexture } = useBackgroundTexture();
  useEffect(() => {
    applyBackgroundTexture(envConfig, getLibraryViewSettings(settings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    envConfig,
    applyBackgroundTexture,
    settings.libraryBackgroundTextureId,
    settings.libraryBackgroundOpacity,
    settings.libraryBackgroundSize,
    settings.globalViewSettings?.backgroundTextureId,
    settings.globalViewSettings?.backgroundOpacity,
    settings.globalViewSettings?.backgroundSize,
  ]);

  useAppUrlIngress();
  useOpenWithBooks();
  useOpenAnnotationLink();
  useOpenBookLink();
  useReadingWidget();
  useOpenShareLink();
  useClipUrlIngress();
  useTransferQueue(libraryLoaded);

  const { pullLibrary, pushLibrary } = useBooksSync();
  // Library-scoped auto-sync for the active third-party cloud provider (WebDAV /
  // Google Drive): keeps library.json current on import / delete / book-close,
  // parity with useBooksSync. No-op when no provider is enabled.
  useLibraryFileSync();
  const { checkOPDSSubscriptions } = useOPDSSubscriptions();
  useInboxDrainer();
  const { isDragging } = useDragDropImport();

  usePullToRefresh(
    scrollRef,
    async () => {
      if (!user) {
        navigateToLogin(router);
        return;
      }
      await pullLibrary(false, true);
      checkOPDSSubscriptions(true);
    },
    async () => {
      if (!user) {
        navigateToLogin(router);
        return;
      }
      await pullLibrary(true, true);
      checkOPDSSubscriptions(true);
    },
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
        await checkForAppUpdates(_, true, settings.updateChannel);
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

  const handleImportBookDirectory = useCallback(async (event: CustomEvent) => {
    const dirPath: string | undefined = event.detail?.path;
    if (!dirPath) return;
    await handleImportBooksFromDirectory(dirPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    eventDispatcher.on('import-book-files', handleImportBookFiles);
    eventDispatcher.on('import-book-directory', handleImportBookDirectory);
    return () => {
      eventDispatcher.off('import-book-files', handleImportBookFiles);
      eventDispatcher.off('import-book-directory', handleImportBookDirectory);
    };
  }, [handleImportBookFiles, handleImportBookDirectory]);

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
          // A file shared into Readest on mobile (the OS share-sheet) is a
          // "Send to Readest" capture — force it to the cloud so it syncs to
          // every device. Desktop "open with" keeps the autoUpload setting.
          const book = await ingestFile(
            {
              file,
              books: libraryBooks,
              transient: temp,
              forceUpload: !!appService.isMobile && !!user,
            },
            { appService, settings, isLoggedIn: !!user },
          );
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

    // Reuse the in-store library only when it was actually loaded from disk.
    // Gating on `length > 0` was unsafe: a transient "Open with" entry made the
    // store non-empty before any disk load, so this skipped loadLibraryBooks and
    // a later save persisted the partial library (wiping library.json).
    const hasCachedLibrary = libraryLoadedFromDisk;
    const loadingTimeout = hasCachedLibrary ? null : setTimeout(() => setLoading(true), 500);
    const initLibrary = async () => {
      const appService = await envConfig.getAppService();
      const settings = await appService.loadSettings();
      setSettings(settings);

      // Re-grant fs_scope / asset_protocol_scope for every external
      // library folder the user registered in a previous session, so
      // in-place books under those roots are immediately readable
      // through both `dir_scanner::read_dir` and the fs plugin.
      // Best-effort — `allowPathsInScopes` swallows its own errors.
      // On iOS the corresponding native-bridge plugin separately
      // re-acquires security-scoped resources via persisted
      // bookmarks (see InPlaceFolderBookmarkStore in
      // NativeBridgePlugin.swift); here we just sync Tauri's in-memory
      // scope set with the persisted intent.
      const externalRoots = settings.externalLibraryFolders ?? [];
      if (externalRoots.length > 0 && appService.allowPathsInScopes) {
        await appService.allowPathsInScopes(externalRoots, true);
      }

      // Reuse the library from the store when we return from the reader
      const library = hasCachedLibrary ? libraryBooks : await appService.loadLibraryBooks();
      let opened = false;
      if (checkOpenWithBooks) {
        opened = await handleOpenWithBooks(appService, library);
      }
      setCheckOpenWithBooks(opened);
      if (!opened && checkLastOpenBooks && settings.openLastBooks) {
        opened = await handleOpenLastBooks(appService, settings.lastOpenBooks, library);
      }
      setCheckLastOpenBooks(opened);

      // Skip the redundant setLibrary on the cached path: the store already
      // contains the same array reference, and a no-op set would still
      // trigger refreshGroups (O(n) MD5) and a full Bookshelf re-render.
      // The cold path or the openWith / openLast path may have produced a
      // different `library` reference (intent-imported books) — only then
      // do we commit it.
      if (!hasCachedLibrary || library !== libraryBooks) {
        setLibrary(library);
      }
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

  const importBooks = async (
    files: SelectedFile[],
    groupId?: string,
    options: { silent?: boolean } = {},
  ): Promise<{ failedPaths: string[] }> => {
    setLoading(true);
    const { library } = useLibraryStore.getState();
    // Build the lookup index ONCE per import batch so each book lookup is
    // O(1) instead of O(n) over the existing library. importBook also keeps
    // the index updated as new books are appended, so subsequent files in
    // the same batch see the additions.
    //
    // `osPlatform` is required for the `byFilePath` arm: on case-insensitive
    // filesystems (macOS / iOS / Windows) two paths that differ only in
    // casing must hash to the same key, so the in-place fast path in
    // importBook can recognize a re-import of the same file.
    const lookupIndex = buildBookLookupIndex(library, appService?.osPlatform);
    const failedImports: Array<{ filename: string; errorMessage: string }> = [];
    const failedPaths: string[] = [];
    const successfulImports: string[] = [];

    // Readest's own Books/ prefix is resolved once at app init and persisted
    // in `settings.localBooksDir`. We hand it to `ingestFile` so the in-place
    // decision can exclude files that already live inside our managed hash
    // store WITHOUT misclassifying user-owned folders that happen to be
    // named "Books" (e.g. Baidu Netdisk's default `Books/` directory
    // directly under the user's library root).
    const appBooksPrefix: string | null =
      useSettingsStore.getState().settings.localBooksDir || null;

    const processFile = async (selectedFile: SelectedFile): Promise<Book | null> => {
      const file = selectedFile.file || selectedFile.path;
      if (!file) return null;
      if (!appService) return null;
      try {
        const { path, basePath } = selectedFile;
        // `groupId` is treated as a tri-state:
        //   - undefined  → caller didn't specify; derive grouping from
        //                  basePath (Import-from-Folder "keep" mode).
        //   - '' (empty) → caller explicitly wants the library root.
        //   - any string → caller explicitly wants that group.
        // Distinguishing '' from undefined matters for re-imports of an
        // already-known book: without it, a falsy check would silently
        // keep the existingBook's stale groupId/groupName from a prior
        // import instead of moving the book to the root.
        let resolvedGroupId = groupId;
        let resolvedGroupName = groupId !== undefined ? getGroupName(groupId) : undefined;
        if (resolvedGroupId === undefined && path && basePath) {
          const rootPath = getDirPath(basePath);
          resolvedGroupName = getDirPath(path).replace(rootPath, '').replace(/^\//, '');
          resolvedGroupId = getGroupId(resolvedGroupName);
        }
        // Read settings from the store at call-time rather than the
        // component closure. `runFolderImport` may have just registered
        // the picked directory as an external library folder via
        // `setSettings(...)`, but React state updates don't mutate the
        // already-captured `settings` reference until the next render —
        // by the time we get here, the closure still holds the *old*
        // settings, so `shouldImportInPlace` would see an empty
        // `externalLibraryFolders` and incorrectly fall back to copy
        // mode. Pulling the latest snapshot from zustand fixes this.
        const liveSettings = useSettingsStore.getState().settings;
        const book = await ingestFile(
          {
            file,
            books: library,
            lookupIndex,
            groupId: resolvedGroupId,
            groupName: resolvedGroupName,
          },
          { appService, settings: liveSettings, isLoggedIn: !!user, appBooksPrefix },
        );
        if (!book) return null;
        successfulImports.push(book.title);
        return book;
      } catch (error) {
        const filename = typeof file === 'string' ? file : file.name;
        if (typeof file === 'string') failedPaths.push(file);
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

    if (!options.silent && failedImports.length > 1) {
      setFailedImportsModal(failedImports);
    } else if (!options.silent && failedImports.length === 1) {
      const { filename, errorMessage } = failedImports[0]!;
      eventDispatcher.dispatch('toast', {
        message:
          _('Failed to import book(s): {{filenames}}', {
            filenames: listFormater(false).format([filename]),
          }) + (errorMessage ? `\n${errorMessage}` : ''),
        timeout: 5000,
        type: 'error',
      });
    }
    // Surface the success toast when books were imported. In silent (auto-import)
    // mode failures are suppressed, so show success independently of them; in
    // interactive mode keep the original behaviour (only when nothing failed).
    if (successfulImports.length > 0 && (options.silent || failedImports.length === 0)) {
      eventDispatcher.dispatch('toast', {
        message: _('Successfully imported {{count}} book(s)', {
          count: successfulImports.length,
        }),
        timeout: 2000,
        type: 'success',
      });
    }

    setLoading(false);
    return { failedPaths };
  };

  /**
   * Re-scan the given watched folders (the user's `autoImportFolders`) and
   * import any newly-added books. Reuses the same in-place import + dedup as
   * manual folder import, but stays quiet: unreadable folders are skipped (no
   * toast), and `importBooks` runs only when genuinely-new files exist (its
   * success toast then fires).
   */
  const autoImportFromWatchedFolders = async (folders: string[]) => {
    if (!appService || loading) return;
    const { library } = useLibraryStore.getState();
    const osPlatform = appService.osPlatform;
    // Known local source paths — live AND soft-deleted (files the user deleted
    // but whose in-place source is still on disk), plus paths that already failed
    // to import this session — so we neither resurrect a deleted book nor
    // re-parse/re-toast a bad file on every focus.
    const existingPaths = collectKnownSourcePaths(library, osPlatform);
    for (const key of autoImportFailedPathsRef.current) existingPaths.add(key);
    const newFiles: SelectedFile[] = [];
    for (const folder of folders) {
      try {
        await appService.allowPathsInScopes?.([folder], true);
        const items = await appService.readDirectory(folder, 'None');
        const entries = await Promise.all(
          items.map(async (item) => ({
            fullPath: await joinPaths(folder, item.path),
            size: item.size,
          })),
        );
        const fresh = selectNewImportableFiles(entries, {
          extensions: SUPPORTED_BOOK_EXTS,
          minSizeBytes: AUTO_IMPORT_MIN_SIZE_BYTES,
          existingPaths,
          osPlatform,
        });
        for (const entry of fresh) {
          newFiles.push({ path: entry.fullPath });
          // Prevent the same file matching again via a later overlapping folder.
          const key = normalizeFilePathForIndex(entry.fullPath, osPlatform);
          if (key) existingPaths.add(key);
        }
      } catch (e) {
        // One unreadable/temporarily-missing folder must not abort the others
        // or nag the user (unlike the manual path, which nudges a re-pick).
        console.error('Auto-import: failed to scan folder', folder, e);
      }
    }
    if (newFiles.length > 0) {
      const { failedPaths } = await importBooks(newFiles, undefined, { silent: true });
      for (const p of failedPaths) {
        const key = normalizeFilePathForIndex(p, osPlatform);
        if (key) autoImportFailedPathsRef.current.add(key);
      }
    }
  };

  // Local-folder counterpart of useLibraryFileSync: re-scan the folders the
  // user opted into auto-import (a subset of externalLibraryFolders, chosen
  // per-folder in the Import-from-Folder dialog) and import newly-added books
  // on library open and app focus. Desktop + Android only (iOS security-scoped
  // bookmarks are out of scope).
  useAutoImportFolders({
    enabled:
      (settings.autoImportFolders?.length ?? 0) > 0 &&
      libraryLoaded &&
      isTauriAppPlatform() &&
      !appService?.isIOSApp,
    folders: settings.autoImportFolders ?? [],
    scanAndImport: autoImportFromWatchedFolders,
  });

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
      // Route the explicit action to the selected cloud provider: while
      // WebDAV / Google Drive is active the Readest Cloud transfer queue is
      // gated and would only answer with the "paused" notice.
      if (getCloudSyncProvider(useSettingsStore.getState().settings) !== 'readest') {
        const ok = await runActiveFileBookUpload(envConfig, book);
        eventDispatcher.dispatch('toast', {
          type: ok ? 'info' : 'error',
          timeout: 2000,
          message: ok
            ? _('Book uploaded: {{title}}', { title: book.title })
            : _('Failed to upload book: {{title}}', { title: book.title }),
        });
        return ok;
      }
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
      // An explicit Upload action must never silently no-op: explain the
      // provider gate when it is the reason the queue refused the book.
      const currentSettings = useSettingsStore.getState().settings;
      if (!isReadestCloudStorageActive(currentSettings)) {
        const provider = getCloudSyncProvider(currentSettings);
        eventDispatcher.dispatch('toast', {
          type: 'info',
          timeout: 5000,
          message: _('Uploads to Readest Cloud are paused while {{provider}} sync is selected', {
            provider: provider === 'gdrive' ? 'Google Drive' : 'WebDAV',
          }),
        });
      }
      return false;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleBookDownload = useCallback(
    async (book: Book, downloadOptions: { redownload?: boolean; queued?: boolean } = {}) => {
      const { redownload = false, queued = false } = downloadOptions;
      // Same provider routing as handleBookUpload — this path is also how a
      // not-yet-local book gets fetched when the user opens it.
      if (getCloudSyncProvider(useSettingsStore.getState().settings) !== 'readest') {
        const ok = await runActiveFileBookDownload(envConfig, book);
        if (ok) await updateBook(envConfig, book);
        eventDispatcher.dispatch('toast', {
          type: ok ? 'info' : 'error',
          timeout: 2000,
          message: ok
            ? _('Book downloaded: {{title}}', { title: book.title })
            : _('Failed to download book: {{title}}', { title: book.title }),
        });
        return ok;
      }
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
        purge: _('Purged book data: {{title}}', { title: book.title }),
      };
      const deletionFailMessages = {
        both: _('Failed to delete book: {{title}}', { title: book.title }),
        cloud: _('Failed to delete cloud backup of the book: {{title}}', { title: book.title }),
        local: _('Failed to delete local copy of the book: {{title}}', { title: book.title }),
        purge: _('Failed to purge book data: {{title}}', { title: book.title }),
      };

      try {
        // Handle local deletion immediately. Purge mirrors 'both' (tombstone +
        // queued cloud delete) but hands 'purge' to deleteBook, which also wipes
        // the entire Books/<hash>/ folder (config/nav/cover) — issue #4615.
        if (deleteAction === 'local' || deleteAction === 'both' || deleteAction === 'purge') {
          await appService?.deleteBook(book, deleteAction === 'purge' ? 'purge' : 'local');
          if (deleteAction === 'both' || deleteAction === 'purge') {
            book.deletedAt = Date.now();
            book.downloadedAt = null;
            book.coverDownloadedAt = null;
          }
          await updateBook(envConfig, book);
          if (ttsSessionManager.getSessionByHash(book.hash)) {
            await ttsSessionManager.stopActive('deleted');
          }
          clearBookData(book.hash);
          if (syncBooks) pushLibrary();
        }

        // Queue cloud deletion
        if (deleteAction === 'cloud' || deleteAction === 'both' || deleteAction === 'purge') {
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
    // Build a NEW book object instead of mutating `book` in place. <BookCover>
    // is memoized and compares fields off the book, so mutating the existing
    // object (which React holds as the previous snapshot) makes the comparator
    // see no change and the library cover only refreshes after a full reload.
    const updatedBook = getBookWithUpdatedMetadata(book, metadata);
    if (metadata.coverImageBlobUrl || metadata.coverImageUrl || metadata.coverImageFile) {
      try {
        await appService?.updateCoverImage(
          updatedBook,
          metadata.coverImageBlobUrl || metadata.coverImageUrl,
          metadata.coverImageFile,
        );
        // Cover-change sync (issue #4544): recompute the cover's content hash.
        // If it actually changed, bump coverHash + coverUpdatedAt so peers
        // re-download it (the book row already syncs via updatedAt).
        // computeCoverHash returns null for a '_blank' deletion — we skip the
        // bump there (cover deletion is intentionally not synced; peers keep
        // their cover until a new one is set).
        const newCoverHash = (await appService?.computeCoverHash(updatedBook)) ?? null;
        if (newCoverHash && newCoverHash !== book.coverHash) {
          // For a book already in the cloud, re-upload the cover FIRST and only
          // advertise the new version if it succeeded — otherwise peers would
          // try to fetch a cover that isn't there. A not-yet-uploaded book
          // carries the new cover on its first full upload, so the bump is safe.
          let coverUploaded = true;
          if (user && updatedBook.uploadedAt) {
            try {
              await appService?.uploadBookCover(updatedBook);
            } catch (uploadError) {
              console.warn('Failed to upload updated cover:', uploadError);
              coverUploaded = false;
            }
          }
          if (coverUploaded) {
            updatedBook.coverHash = newCoverHash;
            updatedBook.coverUpdatedAt = Date.now();
          }
        }
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
    await updateBook(envConfig, updatedBook);
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

  const handleImportBookFromUrl = async (url: string) => {
    // Tauri-only. Routes through the Rust `clip_url` command which spawns
    // a hidden Tauri webview, loads the URL with the real browser engine
    // (correct TLS fingerprint, runs the page's JS, executes any
    // Cloudflare challenge), then captures `document.documentElement
    // .outerHTML` and returns it. End to end this is exactly the local-
    // file path — no inbox, no upload-then-download, no server round-trip
    // — `importBooks` is the same call drag-drop uses.
    if (!isTauriAppPlatform()) return;
    console.log('[clip] start', { url });
    setIsSelectMode(false);
    const t0 = performance.now();
    const html = await invoke<string>('clip_url', { url, options: getClipOptions(_) });
    console.log('[clip] fetched', {
      bytes: html.length,
      ms: Math.round(performance.now() - t0),
    });
    const t1 = performance.now();
    const book = await convertToEpubWithWorker({ kind: 'page', html, url });
    console.log('[clip] epub built', {
      title: book.title,
      author: book.author || undefined,
      bytes: book.file.size,
      ms: Math.round(performance.now() - t1),
    });
    const groupId = searchParams?.get('group') || '';
    console.log('[clip] importing locally', { name: book.file.name, groupId: groupId || null });
    await importBooks([{ file: book.file }], groupId);
    console.log('[clip] done');
  };

  const handleImportBooksFromDirectory = async (dirPath?: string) => {
    if (!appService || !isTauriAppPlatform()) return;

    setIsSelectMode(false);

    // When a path is supplied (e.g. URL ingress / drag-drop replay) we
    // honour the legacy "import everything" behaviour without opening
    // the dialog. Manual menu invocations always go through the dialog
    // so users can pick formats and a size threshold before scanning.
    if (dirPath) {
      await runFolderImport({
        directory: dirPath,
        extensions: SUPPORTED_BOOK_EXTS.slice(),
        // The non-dialog path is invoked by URL ingress / drag-drop
        // replay, where the user never picked any filter — keep the
        // synthetic values minimal and non-restrictive.
        selectedGroupIds: [],
        minSizeKB: 0,
        flatten: false,
        // URL ingress / drag-drop don't go through the dialog and so
        // can't set this. Default to the legacy "copy" behaviour;
        // already-registered external roots will still be detected
        // by `runFolderImport` itself via the prefix check, so books
        // under a registered folder are imported in-place either way.
        readInPlace: false,
        // Non-dialog path never opts into auto-import.
        autoImport: false,
      });
      return;
    }

    // Restore both the last-used folder and the last folder-structure
    // mode from localStorage. Anything else (or first-time use) falls
    // back to the dialog's built-in defaults.
    const ls = typeof window !== 'undefined' ? window.localStorage : null;
    const storedDirectory = ls?.getItem(LAST_IMPORT_FOLDER_KEY) || '';
    const storedMode = ls?.getItem(LAST_IMPORT_FOLDER_MODE_KEY);
    const storedFormats = ls?.getItem(LAST_IMPORT_FOLDER_FORMATS_KEY);
    const storedMinSize = ls?.getItem(LAST_IMPORT_FOLDER_MIN_SIZE_KEY);
    const storedReadInPlace = ls?.getItem(LAST_IMPORT_FOLDER_READ_IN_PLACE_KEY);
    const parsedFormats = storedFormats
      ? storedFormats
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    const parsedMinSize =
      storedMinSize !== null && storedMinSize !== undefined
        ? Number.parseInt(storedMinSize, 10)
        : undefined;
    setImportFromFolderState({
      initialDirectory: storedDirectory,
      initialFolderMode: storedMode === 'flatten' ? 'flatten' : 'keep',
      initialSelectedGroupIds: parsedFormats,
      initialMinSizeKB:
        parsedMinSize !== undefined && Number.isFinite(parsedMinSize) && parsedMinSize >= 0
          ? parsedMinSize
          : undefined,
      initialReadInPlace: storedReadInPlace === '1',
      initialAutoImport: isAutoImportFolder(storedDirectory),
    });
  };

  /**
   * Pop the platform's native folder picker. Wrapped here (rather than
   * inlined into the dialog) so the same Android-permission / Tauri
   * dialog dance is shared between the dialog's "change folder" button
   * and any future programmatic import paths.
   */
  const pickImportDirectory = async (): Promise<string | undefined> => {
    if (!appService) return undefined;
    // Both mobile platforms now go through the native-bridge picker:
    // Android dispatches ACTION_OPEN_DOCUMENT_TREE, iOS presents
    // UIDocumentPickerViewController(forOpeningContentTypes: [.folder]).
    // Tauri's bundled dialog plugin still rejects mobile folder picks
    // with "FolderPickerNotImplemented", so the native-bridge route is
    // the only working path on either OS.
    let picked: string | undefined;
    if (appService.isAndroidApp || appService.isIOSApp) {
      // Android needs MANAGE_EXTERNAL_STORAGE for absolute-path reads;
      // iOS doesn't have an equivalent gate (the OS picker is itself
      // the permission grant), so the prompt is Android-only.
      if (appService.isAndroidApp && !(await requestStoragePermission())) return undefined;
      const response = await selectDirectory();
      picked = response.path || undefined;
    } else {
      picked = (await appService.selectDirectory?.('read')) || undefined;
    }
    if (picked && !validatePickedDirectory(picked)) {
      // Already toasted from inside the validator. Treat as "no
      // selection" so the caller leaves the dialog's old folder
      // value alone and the user can immediately try again.
      return undefined;
    }
    return picked;
  };

  /**
   * Sanity-check a path returned by the native folder picker before
   * we commit to scanning it. iOS in particular hands back POSIX paths
   * for "virtual" Files-app entries (the "On My iPhone" root, "Recents",
   * etc.) where {@link readDirectory} will then fail with a Tauri
   * fs_scope rejection. There's no way to disable those entries in the
   * picker itself, so we accept the pick, detect the known-bad shapes,
   * and show a clear toast asking the user to drill into a real
   * subfolder. Returns true if the path looks usable.
   */
  const validatePickedDirectory = (path: string): boolean => {
    if (!appService?.isIOSApp) return true;
    // iOS Files exposes "On My iPhone" as a virtual aggregator over
    // every app's `LSSupportsOpeningDocumentsInPlace` container. When
    // the user picks that root, the picker hands us a path whose
    // basename is exactly `File Provider Storage` (the placeholder
    // directory inside our own App Group container that the system
    // uses to materialise external file-provider contents on demand).
    // POSIX reads against it return either nothing or EPERM, and the
    // Tauri fs_scope refuses it outright because it's outside our
    // allowed globs. Drilling into a concrete subfolder produces a
    // normal, readable POSIX path, which is the path we want.
    //
    // These string anchors aren't localized — iOS keeps the on-disk
    // path in English regardless of the device language, so the
    // basename / segment match is stable.
    const trimmed = path.replace(/\/+$/, '');
    const basename = trimmed.split('/').pop() ?? '';
    const isOnMyIPhoneRoot = basename === 'File Provider Storage';
    if (isOnMyIPhoneRoot) {
      eventDispatcher.dispatch('toast', {
        type: 'warning',
        timeout: 6000,
        message: _(
          'iOS doesn\'t allow importing the "On My iPhone" root. Open it and pick a specific subfolder (e.g. Readest, Downloads), then try again.',
        ),
      });
      return false;
    }
    return true;
  };

  /**
   * Normalize a path the same way `shouldImportInPlace` does so the
   * predicate / store helpers below stay consistent with the ingest
   * layer's own path-prefix matching. Trailing separators and Windows
   * backslashes are normalized; nothing else is touched.
   */
  const normalizeRoot = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '');

  /**
   * `true` when `directory` is already in
   * `settings.externalLibraryFolders` after path normalization. Hands
   * over to the ImportFromFolderDialog so it can render the "Read in
   * place" toggle as ON-and-locked when the user re-imports from a
   * folder they've already registered. The match is exact-string
   * (after normalization) — sub-paths of a registered folder are NOT
   * considered registered roots themselves, only the registered root
   * is.
   */
  const isRegisteredExternalRoot = (directory: string): boolean => {
    const target = normalizeRoot(directory);
    if (!target) return false;
    const roots = settings.externalLibraryFolders ?? [];
    return roots.some((r) => normalizeRoot(r) === target);
  };

  /**
   * `true` when `directory` is in `settings.autoImportFolders` after path
   * normalization. Seeds the dialog's "Auto-import new books from this
   * folder" checkbox so re-opening on a watched folder shows it ticked.
   */
  const isAutoImportFolder = (directory: string): boolean => {
    const target = normalizeRoot(directory);
    if (!target) return false;
    const roots = settings.autoImportFolders ?? [];
    return roots.some((r) => normalizeRoot(r) === target);
  };

  /**
   * Add `directory` to `settings.externalLibraryFolders` (and persist
   * settings) so the ingest layer's `shouldImportInPlace` will pick
   * up subsequent imports from the same folder automatically. No-op
   * when the folder is already registered. Errors are swallowed
   * because the import flow can still succeed in copy mode even if
   * registration fails — we just won't get the in-place behaviour
   * next launch.
   */
  const registerExternalLibraryFolder = async (directory: string): Promise<void> => {
    const target = normalizeRoot(directory);
    if (!target) return;
    const liveSettings = useSettingsStore.getState().settings;
    const existing = liveSettings.externalLibraryFolders ?? [];
    if (existing.some((r) => normalizeRoot(r) === target)) {
      return;
    }
    const next = [...existing, directory];
    const nextSettings = { ...liveSettings, externalLibraryFolders: next };
    setSettings(nextSettings);
    try {
      await saveSettings(envConfig, nextSettings);
    } catch (e) {
      console.error('Failed to persist externalLibraryFolders update:', e);
    }
  };

  /**
   * Add or remove `directory` from `settings.autoImportFolders` (and persist)
   * per the user's per-folder "Auto-import new books from this folder" choice.
   * A no-op when the folder is already in the desired state. Errors are
   * swallowed — the import itself still succeeds; we just won't watch (or stop
   * watching) the folder until the next successful settings write.
   */
  const setAutoImportFolder = async (directory: string, enabled: boolean): Promise<void> => {
    const target = normalizeRoot(directory);
    if (!target) return;
    const liveSettings = useSettingsStore.getState().settings;
    const existing = liveSettings.autoImportFolders ?? [];
    const present = existing.some((r) => normalizeRoot(r) === target);
    if (enabled === present) return;
    const next = enabled
      ? [...existing, directory]
      : existing.filter((r) => normalizeRoot(r) !== target);
    const nextSettings = { ...liveSettings, autoImportFolders: next };
    setSettings(nextSettings);
    try {
      await saveSettings(envConfig, nextSettings);
    } catch (e) {
      console.error('Failed to persist autoImportFolders update:', e);
    }
  };

  /**
   * Recursively scan {@link result.directory}, keep files matching one
   * of {@link result.extensions} that are at least
   * {@link result.minSizeKB} KB, and feed them through {@link importBooks}.
   *
   * Two cooperating signals carry "where should the imported books
   * end up" downstream:
   *   1. Each {@link SelectedFile}'s `basePath` — when present,
   *      {@link importBooks}' `processFile` derives a nested groupName
   *      relative to it (`<sub>` / `<sub>/<deeper>`).
   *   2. The `groupId` argument passed to {@link importBooks} —
   *      tri-state per the comment in `processFile`. An explicit
   *      string (including '') wins over basePath-derived grouping.
   *
   * The two flatten/keep modes use these signals as follows:
   *   - keep    → omit basePath? no, *include* basePath; pass
   *               groupId=undefined so basePath wins.
   *   - flatten → omit basePath AND pass an explicit groupId equal to
   *               the user's currently-viewed group ('' = root). The
   *               omitted basePath alone wouldn't be enough on a
   *               re-import, since deduped books carry stale groupIds
   *               from prior sessions; the explicit groupId is what
   *               actually reseats them. Dropping basePath in flatten
   *               mode is therefore belt-and-suspenders.
   */
  const runFolderImport = async (result: ImportFromFolderResult) => {
    if (!appService || !result.directory) return;
    // Last-chance sanity check. The dialog's own pickImportDirectory
    // already validates fresh picks, but `result.directory` can also
    // come from the persisted "last import folder" in localStorage —
    // which may have been a bad path (e.g. user picked "On My iPhone"
    // root last session, app remembered it, user just hits OK now).
    // Catch that here so they get the same clear guidance instead of
    // a fs_scope error from readDirectory below.
    if (!validatePickedDirectory(result.directory)) return;

    // The user can opt the chosen folder into "in place" via the
    // dialog toggle; the same effect happens automatically when the
    // folder is already a registered external library folder (the
    // ingest layer's `shouldImportInPlace` does a path-prefix match
    // against `settings.externalLibraryFolders`). Register here so the
    // bookkeeping survives across launches and so subsequent imports
    // from the same folder don't have to re-trigger the toggle.
    if (result.readInPlace) {
      await registerExternalLibraryFolder(result.directory);
    }
    // Opt this folder into (or out of) auto-import per the dialog's per-folder
    // checkbox. `result.autoImport` already implies `readInPlace` (the dialog
    // gates it), so registration above has run; unchecking removes the folder
    // from the watched set while leaving it registered as read-in-place.
    await setAutoImportFolder(result.directory, result.autoImport);

    // Re-grant scopes for the directory before scanning. This matters
    // when `result.directory` came from somewhere the dialog plugin
    // didn't authorise — typically the persisted "last import folder"
    // restored from localStorage when the user just hit OK without
    // re-picking. Without this, `RemoteFile` reads through the asset
    // protocol later in `importBook` would fail with
    // "asset protocol not configured to allow the path".
    await appService.allowPathsInScopes?.([result.directory], true);
    const exts = result.extensions.map((e) => e.toLowerCase());
    const minSizeBytes = Math.max(0, Math.floor(result.minSizeKB)) * 1024;
    let files;
    try {
      files = await appService.readDirectory(result.directory, 'None');
    } catch (e) {
      // readDirectory can reject for a few related reasons:
      //   - iOS handed us a virtual / file-provider path that the OS
      //     sandbox refuses to enumerate (the validator above catches
      //     the common shapes, but not every file-provider variant);
      //   - the path is outside Tauri's `fs_scope` and scope
      //     extension didn't stick (e.g. an iCloud Drive entry whose
      //     security-scoped resource the system declined to grant);
      //   - the directory was deleted / permissions revoked between
      //     pick and scan.
      // Swallow the rejection (otherwise it bubbles up as an
      // unhandledRejection through Next.js) and surface a friendly
      // message that nudges the user to re-pick.
      const detail = e instanceof Error ? e.message : String(e);
      console.error('Folder import: readDirectory failed', detail);
      const isIOS = !!appService.isIOSApp;
      eventDispatcher.dispatch('toast', {
        type: 'error',
        timeout: 6000,
        message: isIOS
          ? _(
              'Couldn\'t read this folder. Some iOS locations (like the "On My iPhone" root or iCloud Drive top-level) can\'t be scanned — please pick a specific subfolder and try again.',
            )
          : _(
              "Couldn't read this folder. Please pick the folder again, or choose a different location.",
            ),
      });
      return;
    }
    const filtered = files.filter((file) => {
      const ext = file.path.split('.').pop()?.toLowerCase() || '';
      if (!exts.includes(ext)) return false;
      if (minSizeBytes > 0 && file.size < minSizeBytes) return false;
      return true;
    });
    const toImportFiles = await Promise.all(
      filtered.map(async (file) => {
        const fullPath = await joinPaths(result.directory, file.path);
        return result.flatten ? { path: fullPath } : { path: fullPath, basePath: result.directory };
      }),
    );
    if (toImportFiles.length === 0) {
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('No matching books found in the selected folder.'),
      });
      return;
    }
    // When flattening, route the books into whichever group the user
    // is currently viewing (empty string == library root). When
    // preserving structure we leave groupId undefined so importBooks
    // derives nested groupNames from each file's basePath.
    const targetGroupId = result.flatten ? searchParams?.get('group') || '' : undefined;
    importBooks(toImportFiles, targetGroupId);
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
    return <div className='full-height bg-base-200' />;
  }

  const showBookshelf = libraryLoaded || libraryBooks.length > 0;

  return (
    <div
      ref={pageRef}
      aria-label={_('Your Library')}
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
          onImportBookFromUrl={isTauriAppPlatform() ? () => setShowImportFromUrl(true) : undefined}
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
          <div aria-label={_('Your Bookshelf')} className='flex min-h-0 flex-grow flex-col'>
            <div
              ref={containerRef}
              className={clsx(
                'scroll-container drop-zone flex min-h-0 flex-grow flex-col',
                isDragging && 'drag-over',
              )}
              style={{
                paddingRight: `${insets.right}px`,
                paddingLeft: `${insets.left}px`,
                paddingBottom: 'var(--now-playing-inset, 0px)',
              }}
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
                handleBookPurge={handleBookDelete('purge')}
                handleSetSelectMode={handleSetSelectMode}
                handleShowDetailsBook={handleShowDetailsBook}
                handleLibraryNavigation={handleLibraryNavigation}
                booksTransferProgress={booksTransferProgress}
                handlePushLibrary={pushLibrary}
              />
            </div>
          </div>
        ) : (
          <div className='hero drop-zone h-screen items-center justify-center'>
            <DropIndicator />
            <LibraryEmptyState onImport={handleImportBooksFromFiles} />
          </div>
        ))}
      <NowPlayingBar isSelectMode={isSelectMode} />
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
          handleBookPurge={handleBookDelete('purge')}
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
      <CacheManagerWindow />
      {isSettingsDialogOpen && <SettingsDialog bookKey={''} />}
      {showCatalogManager && <CatalogDialog onClose={handleDismissOPDSDialog} />}
      {failedImportsModal && (
        <FailedImportsDialog
          failedImports={failedImportsModal}
          onClose={() => setFailedImportsModal(null)}
        />
      )}
      {importFromFolderState && (
        <ImportFromFolderDialog
          initialDirectory={importFromFolderState.initialDirectory}
          initialFolderMode={importFromFolderState.initialFolderMode}
          initialSelectedGroupIds={importFromFolderState.initialSelectedGroupIds}
          initialMinSizeKB={importFromFolderState.initialMinSizeKB}
          initialReadInPlace={importFromFolderState.initialReadInPlace}
          initialAutoImport={importFromFolderState.initialAutoImport}
          isRegisteredExternalRoot={isRegisteredExternalRoot}
          onPickDirectory={pickImportDirectory}
          onCancel={() => setImportFromFolderState(null)}
          onConfirm={(result) => {
            setImportFromFolderState(null);
            // Remember the folder + filters for next time. Done here
            // (rather than inside pickImportDirectory) so we only
            // persist values the user actually committed to, not
            // ones they cancelled out of.
            if (typeof window !== 'undefined') {
              if (result.directory) {
                window.localStorage.setItem(LAST_IMPORT_FOLDER_KEY, result.directory);
              }
              window.localStorage.setItem(
                LAST_IMPORT_FOLDER_MODE_KEY,
                result.flatten ? 'flatten' : 'keep',
              );
              if (result.selectedGroupIds.length > 0) {
                window.localStorage.setItem(
                  LAST_IMPORT_FOLDER_FORMATS_KEY,
                  result.selectedGroupIds.join(','),
                );
              }
              window.localStorage.setItem(
                LAST_IMPORT_FOLDER_MIN_SIZE_KEY,
                String(result.minSizeKB),
              );
              window.localStorage.setItem(
                LAST_IMPORT_FOLDER_READ_IN_PLACE_KEY,
                result.readInPlace ? '1' : '0',
              );
            }
            void runFolderImport(result);
          }}
        />
      )}
      <ImportFromUrlDialog
        isOpen={showImportFromUrl}
        onClose={() => setShowImportFromUrl(false)}
        onSubmit={handleImportBookFromUrl}
      />
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
