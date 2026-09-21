import LibraryEmptyState from './LibraryEmptyState';
import LibraryImportButton from './LibraryImportButton';
import clsx from 'clsx';
import { MdManageSearch } from 'react-icons/md';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PiPlus } from 'react-icons/pi';
import { useOverlayScrollbars } from 'overlayscrollbars-react';
import 'overlayscrollbars/overlayscrollbars.css';
import { Book, BooksGroup, type LibrarySearchConfig, ReadingStatus } from '@/types/book';
import { LibraryGroupByType, LibrarySortByType, LibraryViewModeType } from '@/types/settings';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useAutoFocus } from '@/hooks/useAutoFocus';
import { useSettingsStore } from '@/store/settingsStore';
import { isAbsBookOrphaned, useABSServerStore } from '@/store/absServerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { selectActiveBookDownloadProgress, useTransferStore } from '@/store/transferStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useMedianPageDurationsSecs } from '@/hooks/useMedianPageDurationSecs';
import { useBookshelfDate } from '@/hooks/useBookshelfDate';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { navigateToLibrary, navigateToReader, showReaderWindow } from '@/utils/nav';
import {
  createBookFilter,
  createBookSorter,
  ensureLibraryGroupByType,
  expandBookshelfSelection,
  selectDownloadableBooks,
  withReadingStatus,
} from '../utils/libraryUtils';
import { readBookshelves } from '@/services/bookshelves/state';
import {
  assignBookshelfOwnership,
  evaluateBookshelves,
  matchBookshelves,
} from '@/services/bookshelves/evaluate';
import { getGlobalBookshelfSort, resolveBookshelfSort } from '@/services/bookshelves/sorting';
import { getActiveBookshelfGroupBy } from '@/services/bookshelves/grouping';
import { presentBookshelf } from '@/services/bookshelves/presentation';
import type { BookshelfDefinition } from '@/types/bookshelf';
import { resolveBookshelfLayout } from '@/services/bookshelves/definitions';
import BookshelfStream, { type ShelfSection } from './BookshelfStream';
import { eventDispatcher } from '@/utils/event';
import { getLocalBookFilename } from '@/utils/book';
import { MIMETYPES, EXTS } from '@/libs/document';
import { makeSafeFilename } from '@/utils/misc';
import { isTauriAppPlatform } from '@/services/environment';
import { isLocalSendEnabled } from '@/services/localsend/devicePrefs';
import { splitLibraryOpenIds } from '@/utils/audiobook';

import { useSpatialNavigation } from '../hooks/useSpatialNavigation';
import DeleteConfirmAlert from '@/components/DeleteConfirmAlert';
import Spinner from '@/components/Spinner';
import ModalPortal from '@/components/ModalPortal';
import BookshelfItem from './BookshelfItem';
import SelectModeActions from './SelectModeActions';
import ShareBookDialog from './ShareBookDialog';
import { useAuth } from '@/context/AuthContext';
import GroupingModal from './GroupingModal';
import TaggingModal from './TaggingModal';
import SetStatusAlert from './SetStatusAlert';
import { useOpenBook } from '../hooks/useOpenBook';
import LibrarySearchResults from './LibrarySearchResults';

export interface ContentSearchRequest {
  query: string;
  config: LibrarySearchConfig;
}

interface BookshelfProps {
  libraryBooks: Book[];
  isSelectMode: boolean;
  isSelectAll: boolean;
  isSelectNone: boolean;
  onScrollerRef: (el: HTMLDivElement | null) => void;
  handleImportBooks: (anchor: HTMLElement) => void;
  handleBookDownload: (
    book: Book,
    options?: { redownload?: boolean; queued?: boolean; silent?: boolean },
  ) => Promise<boolean>;
  handleBookUpload: (book: Book, syncBooks?: boolean) => Promise<boolean>;
  handleBookDelete: (book: Book, syncBooks?: boolean) => Promise<boolean>;
  handleBookPurge: (book: Book, syncBooks?: boolean) => Promise<boolean>;
  handleSetSelectMode: (selectMode: boolean) => void;
  handleShowDetailsBook: (book: Book) => void;
  handleLibraryNavigation: (targetGroup: string, shelfId?: string) => void;
  handlePushLibrary: () => Promise<void>;
  /** Direct (non-queued) downloads only; queue transfers are read from the store. */
  booksTransferProgress: { [key: string]: number };
  contentSearch: ContentSearchRequest | null;
  onSearchContents: () => void;
  onSearchProgress?: (value: number | null) => void;
}

const DEFAULT_FOOTER_HEIGHT = 34;

const Bookshelf: React.FC<BookshelfProps> = ({
  libraryBooks,
  isSelectMode,
  isSelectAll,
  isSelectNone,
  onScrollerRef,
  handleImportBooks,
  handleBookUpload,
  handleBookDownload,
  handleBookDelete,
  handleBookPurge,
  handleSetSelectMode,
  handleShowDetailsBook,
  handleLibraryNavigation,
  handlePushLibrary,
  booksTransferProgress,
  contentSearch,
  onSearchContents,
  onSearchProgress,
}) => {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { safeAreaInsets } = useThemeStore();

  const groupId = searchParams?.get('group') || '';
  const shelfId = searchParams?.get('shelf') || '';
  const activeShelfId = shelfId || 'default';
  const queryTerm = searchParams?.get('q')?.trim() || null;
  // Tag/subject links and legacy `?group=` deep links carry no shelf, so the
  // group spans the whole library instead of Default's filters and exclusions
  // (which own every audiobook and podcast).
  const unscopedGroup = !!groupId && !shelfId;
  const storedDefinitions = useMemo(
    () => readBookshelves(settings),
    [
      settings.bookshelves,
      settings.libraryViewMode,
      settings.libraryHideCovers,
      settings.libraryCoverFit,
      settings.librarySkeuomorphicCovers,
      settings.librarySortBy,
      settings.librarySortAscending,
      settings.libraryThenSortBy,
      settings.libraryThenSortAscending,
      settings.libraryRecentShelfEnabled,
      settings.libraryGroupBy,
      settings.librarySortByAuto,
    ],
  );
  const globalSort = useMemo(
    () => getGlobalBookshelfSort(settings, searchParams),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      settings.libraryGroupBy,
      settings.librarySortBy,
      settings.librarySortByAuto,
      settings.librarySortAscending,
      settings.libraryThenSortBy,
      settings.libraryThenSortAscending,
      searchParams,
    ],
  );
  const definitions = useMemo(
    () =>
      storedDefinitions.map((s) => ({
        ...s,
        sort: resolveBookshelfSort(s, globalSort),
      })),
    [storedDefinitions, globalSort],
  );
  const defaultShelf = definitions.find((s) => s.id === 'default')!;
  const viewMode = searchParams?.get('view') || settings.libraryViewMode;
  const globalGroupBy = ensureLibraryGroupByType(
    searchParams?.get('groupBy'),
    settings.libraryGroupBy,
  );
  const groupBy = getActiveBookshelfGroupBy(settings, searchParams);
  const activeShelf = definitions.find((s) => s.id === activeShelfId);
  const showTimeRemaining = queryTerm
    ? globalSort.by === 'timeRemaining' || globalSort.thenBy === 'timeRemaining'
    : definitions.some(
        (s) => s.enabled && (s.sort.by === 'timeRemaining' || s.sort.thenBy === 'timeRemaining'),
      );

  const [loading, setLoading] = useState(false);
  const [showSelectModeActions, setShowSelectModeActions] = useState(false);
  const [selectModeActionsHeight, setSelectModeActionsHeight] = useState(0);
  const [bookIdsToDelete, setBookIdsToDelete] = useState<string[]>([]);
  const [showDeleteAlert, setShowDeleteAlert] = useState(false);
  const [showStatusAlert, setShowStatusAlert] = useState(false);
  const [showGroupingModal, setShowGroupingModal] = useState(false);
  const [tagBookHashes, setTagBookHashes] = useState<string[] | null>(null);
  const [importBookUrl] = useState(searchParams?.get('url') || '');

  const abortDeletionRef = useRef(false);
  const selectAllAppliedRef = useRef(false);
  const isImportingBook = useRef(false);
  const iconSize15 = useResponsiveSize(15);
  const autofocusRef = useAutoFocus<HTMLDivElement>();
  useSpatialNavigation(autofocusRef);

  const { setCurrentBookshelf, setLibrary, updateBooks } = useLibraryStore();
  const { setSelectedBooks, getSelectedBooks, toggleSelectedBook } = useLibraryStore();
  // The raw Set from the store: its identity only changes when the selection
  // does, so memos keyed on it stay stable across unrelated re-renders
  // (getSelectedBooks() allocates a fresh array per call).
  const { selectedBooks: selectedBookSet } = useLibraryStore();
  const { getGroupName } = useLibraryStore();

  const uiLanguage = localStorage?.getItem('i18nextLng') || '';

  const updateUrlParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(window.location.search);

      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === '') {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      });

      if (params.get('sort') === LibrarySortByType.Updated) params.delete('sort');
      if (params.get('order') === 'desc') params.delete('order');
      if (params.get('thenOrder') === 'asc') params.delete('thenOrder');
      if (params.get('groupBy') === LibraryGroupByType.Group) params.delete('groupBy');
      if (params.get('cover') === 'crop') params.delete('cover');
      if (params.get('view') === 'grid') params.delete('view');

      const newParamString = params.toString();
      const currentParamString = window.location.search.slice(1);

      if (newParamString !== currentParamString) {
        navigateToLibrary(router, newParamString);
      }
    },
    [router, searchParams],
  );

  // ABS books whose server row hasn't reached this device (or was removed)
  // can't stream, have no cover source, and can't be opened — hide them from
  // every shelf derivation (grid, groups, recent shelf, search). They stay in
  // the store and keep syncing; they reappear the moment the server row
  // lands. `absServers` and `settings.absServers` are deps because the orphan
  // check reads the server store with a settings fallback, both of which
  // hydrate asynchronously after the cached library first renders. Keying on
  // the one settings field it reads keeps unrelated settings writes from
  // re-filtering and re-sorting every shelf.
  const absServers = useABSServerStore((state) => state.servers);
  const visibleBooks = useMemo(
    () => libraryBooks.filter((book) => !book.deletedAt && !isAbsBookOrphaned(book)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [libraryBooks, absServers, settings.absServers],
  );

  const filteredBooks = useMemo(() => {
    const bookFilter = createBookFilter(queryTerm);
    return queryTerm ? visibleBooks.filter((book) => bookFilter(book)) : visibleBooks;
  }, [visibleBooks, queryTerm]);

  const manualGroupName = groupBy === LibraryGroupByType.Group ? getGroupName(groupId) : undefined;
  const pageDurations = useMedianPageDurationsSecs(libraryBooks, showTimeRemaining);
  const today = useBookshelfDate(definitions);
  const rawMatches = useMemo(
    () => matchBookshelves(visibleBooks, definitions, today),
    [visibleBooks, definitions, today],
  );
  const ownership = useMemo(
    () => assignBookshelfOwnership(definitions, rawMatches),
    [definitions, rawMatches],
  );
  const results = useMemo(
    () =>
      evaluateBookshelves(
        visibleBooks,
        definitions,
        uiLanguage,
        pageDurations,
        rawMatches,
        ownership,
      ),
    [visibleBooks, definitions, uiLanguage, pageDurations, rawMatches, ownership],
  );
  const sections = useMemo<ShelfSection[]>(() => {
    // Search is a flat view of every eligible library book, independent of all shelves.
    if (queryTerm)
      return [
        {
          definition: {
            ...defaultShelf,
            name: _('Search results'),
            sort: globalSort,
            layout: viewMode === 'list' ? 'list' : 'grid',
          },
          items: [...filteredBooks].sort(
            createBookSorter(
              globalSort.by,
              uiLanguage,
              globalSort.thenBy,
              globalSort.ascending,
              globalSort.thenAscending,
              pageDurations,
            ),
          ),
        },
      ];
    return (
      unscopedGroup
        ? [
            {
              definition: defaultShelf,
              books: visibleBooks,
              matching: visibleBooks.length,
              excluded: 0,
            },
          ]
        : results.filter((r) => !groupId || r.definition.id === activeShelfId)
    )
      .map((result) => {
        const definition: BookshelfDefinition = {
          ...result.definition,
          layout: resolveBookshelfLayout(result.definition, viewMode),
        };
        // Legacy group links have no shelf and use their URL/global grouping.
        if (groupId) {
          definition.useGlobalGrouping = false;
          definition.groupBy = groupBy;
        }
        return {
          definition,
          hideHeading: definition.id === 'default',
          items: presentBookshelf(
            { ...result, definition },
            { libraryGroupBy: globalGroupBy },
            uiLanguage,
            pageDurations,
            groupId,
            manualGroupName,
          ),
        };
      })
      .filter((section) => section.items.length > 0);
  }, [
    results,
    queryTerm,
    filteredBooks,
    defaultShelf,
    viewMode,
    groupId,
    activeShelfId,
    unscopedGroup,
    visibleBooks,
    groupBy,
    globalGroupBy,
    globalSort,
    uiLanguage,
    pageDurations,
    manualGroupName,
    _,
  ]);
  const sortedBookshelfItems = useMemo(
    () => sections.flatMap((section) => section.items),
    [sections],
  );
  const currentShelfBooks = useMemo(
    () => [
      ...new Map(
        sortedBookshelfItems
          .flatMap((item) => ('books' in item ? item.books : [item]))
          .map((book) => [book.hash, book]),
      ).values(),
    ],
    [sortedBookshelfItems],
  );
  useEffect(() => {
    // A search with no hits filters the group down to nothing; that must not
    // throw the user back to the library root.
    if (!groupId || queryTerm) return;
    if ((!unscopedGroup && !activeShelf?.enabled) || currentShelfBooks.length === 0)
      updateUrlParams({ group: null, shelf: null });
  }, [
    groupId,
    queryTerm,
    unscopedGroup,
    activeShelf?.enabled,
    currentShelfBooks.length,
    updateUrlParams,
  ]);

  useEffect(() => {
    if (isImportingBook.current) return;
    isImportingBook.current = true;

    if (importBookUrl && appService) {
      const importBook = async () => {
        console.log('Importing book from URL:', importBookUrl);
        const book = await appService.importBook(importBookUrl, libraryBooks);
        if (book) {
          setLibrary(libraryBooks);
          appService.saveLibraryBooks(libraryBooks);
          navigateToReader(router, [book.hash]);
        }
      };
      importBook();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importBookUrl, appService]);

  useEffect(() => {
    setCurrentBookshelf(currentShelfBooks);
  }, [currentShelfBooks, setCurrentBookshelf]);

  const toggleSelection = useCallback(
    (id: string, group?: BooksGroup) => {
      if (group) {
        // Read the live selection: memoized cards keep the `toggleSelection`
        // closure from when select mode was entered, so a captured
        // `selectedBookSet` would replace the selection with a stale snapshot.
        const selected = useLibraryStore.getState().selectedBooks;
        const allSelected = group.books.every((book) => selected.has(book.hash));
        const next = new Set(selected);
        for (const book of group.books) {
          if (allSelected) next.delete(book.hash);
          else next.add(book.hash);
        }
        setSelectedBooks([...next]);
      } else toggleSelectedBook(id);
    },
    [toggleSelectedBook, setSelectedBooks],
  );

  const openSelectedBooks = () => {
    handleSetSelectMode(false);
    const { audiobookHash, readerIds, droppedAudiobooks } = splitLibraryOpenIds(
      getSelectedBooks(),
      (hash) => libraryBooks.find((book) => book.hash === hash),
    );
    if (audiobookHash) {
      router.push(`/player?id=${audiobookHash}`);
      return;
    }
    if (droppedAudiobooks) {
      eventDispatcher.dispatch('toast', {
        message: _('Audiobooks open in the player'),
        type: 'info',
      });
    }
    if (readerIds.length === 0) return;
    if (appService?.hasWindow && settings.openBookInNewWindow) {
      showReaderWindow(appService, readerIds);
    } else {
      setTimeout(() => setLoading(true), 200);
      navigateToReader(router, readerIds);
    }
  };

  const openBookDetails = () => {
    handleSetSelectMode(false);
    const selectedBooks = getSelectedBooks();
    const book = libraryBooks.find((book) => book.hash === selectedBooks[0]);
    if (book) {
      handleShowDetailsBook(book);
    }
  };

  // `bookIdsToDelete` always holds book hashes by the time we get here —
  // group ids are expanded into their constituent hashes at intake (see
  // `deleteSelectedBooks` and `handleDeleteBooksIntent`), so a top-level
  // folder is now resolved against the rendered group's `books` rollup,
  // which already includes nested sub-folder books.
  const getBooksToDelete = () => {
    const wanted = new Set(bookIdsToDelete);
    return filteredBooks.filter((book) => wanted.has(book.hash) && !book.deletedAt);
  };

  const confirmDelete = async (purgeData: boolean) => {
    const books = getBooksToDelete();
    // Toggling "purge all reading data" on the confirmation routes the whole
    // batch through the purge path, which also wipes each book's reading-data
    // sidecars (config/nav) instead of leaving the metadata folder behind.
    const deleteBook = purgeData ? handleBookPurge : handleBookDelete;
    const concurrency = 20;

    for (let i = 0; i < books.length; i += concurrency) {
      if (abortDeletionRef.current) {
        abortDeletionRef.current = false;
        break;
      }
      const batch = books.slice(i, i + concurrency);
      await Promise.all(batch.map((book) => deleteBook(book, false)));
    }
    handlePushLibrary();
    setSelectedBooks([]);
    setShowDeleteAlert(false);
    setShowSelectModeActions(true);
  };

  const deleteSelectedBooks = () => {
    // Expand any group ids in the selection into the book hashes they
    // visually represent — `generateBookshelfItems` rolls nested-folder
    // books into the parent group, and we want every one of them queued
    // for deletion, not just the books whose own `groupId` happens to
    // match the top-level group's id.
    setBookIdsToDelete(expandBookshelfSelection(getSelectedBooks(), sortedBookshelfItems));
    setShowSelectModeActions(false);
    setShowDeleteAlert(true);
  };

  const groupSelectedBooks = () => {
    setShowSelectModeActions(false);
    setShowGroupingModal(true);
  };

  const tagSelectedBooks = () => {
    setTagBookHashes(expandBookshelfSelection(getSelectedBooks(), sortedBookshelfItems));
    setShowSelectModeActions(false);
  };

  const showStatusSelection = () => {
    setShowSelectModeActions(false);
    setShowStatusAlert(true);
  };

  const sendSelectedBook = async () => {
    // "Send" hands the actual book file (epub/pdf/...) to the OS share
    // sheet (UIActivityViewController on iOS, Intent.ACTION_SEND on
    // Android, NSSharingServicePicker on macOS) so the user can fire it
    // off to Mail / Messages / WeChat / AirDrop / etc. Backed by
    // tauri-plugin-sharekit via appService.saveFile({ share: true }).
    //
    // This is intentionally distinct from the per-item "Share Book"
    // context menu, which uploads the book to the readest backend and
    // generates a public link. "Send" is offline file egress; "Share
    // Book" is remote collaboration. They share zero infra.
    //
    // Linux has no system share sheet, and Windows is intentionally
    // disabled (issue #4343 — WebView2's native share UI blocks the main
    // thread waiting on cancel/complete callbacks that may never fire).
    // We hide the button entirely on those platforms (see sendEnabled
    // in the JSX) so users don't see an action that can't be honoured.

    const ids = getSelectedBooks();
    if (ids.length !== 1) return;
    const book = filteredBooks.find((b) => b.hash === ids[0]);
    if (!book || !appService) return;

    // Anchor the macOS share popover to the selected book's cover, not
    // to the Send button — the user just tapped/clicked the book, so
    // their visual focus is on the cover. We look the cover up via the
    // `data-book-hash` attribute that BookshelfItem stamps on its root
    // div. The rect must be captured *before* setShowSelectModeActions
    // tears the popup down (the bookshelf itself stays mounted, but we
    // still want to grab it up front to keep the share-call site
    // simple). preferredEdge='bottom' maps to NSMinYEdge, which in
    // WKWebView's flipped coord space is the rect's top edge, so the
    // popover renders above the cover (and only auto-flips below when
    // there's no room above). On iOS / Android the share sheet is modal
    // and ignores sharePosition, so this work is harmless there.
    const coverEl = document.querySelector<HTMLElement>(`[data-book-hash="${book.hash}"]`);
    const anchorRect = coverEl?.getBoundingClientRect();
    const sharePosition = anchorRect
      ? {
          x: anchorRect.left + anchorRect.width / 2,
          y: anchorRect.top + anchorRect.height / 2,
          preferredEdge: 'bottom' as const,
        }
      : undefined;

    setShowSelectModeActions(false);
    handleSetSelectMode(false);

    try {
      // Resolve the file the same way bookContent.resolveBookContentSource
      // does, but via the public AppService surface (the underlying `fs`
      // is protected): managed copy under Books/<hash>/ first, then the
      // device-local in-place import path. Cloud-only books or remote
      // URL books can't be shared without first downloading them.
      const managedPath = getLocalBookFilename(book);
      let path: string;
      let base: 'Books' | 'None';
      if (await appService.exists(managedPath, 'Books')) {
        path = managedPath;
        base = 'Books';
      } else if (book.filePath && (await appService.exists(book.filePath, 'None'))) {
        path = book.filePath;
        base = 'None';
      } else {
        eventDispatcher.dispatch('toast', {
          type: 'warning',
          message: _('Book file is not available locally'),
          timeout: 2500,
        });
        return;
      }
      const ext = EXTS[book.format] ?? 'bin';
      const mimeType = MIMETYPES[book.format]?.[0] ?? 'application/octet-stream';
      const baseName = makeSafeFilename(book.sourceTitle || book.title || book.hash);
      const shareFilename = `${baseName}.${ext}`;

      // Native (Tauri) only — the Share button is hidden on web because
      // browsers can't surface a real "share to <app>" sheet for an
      // arbitrary local file. Hand the already-on-disk file straight to
      // the OS share sheet via `options.filePath`. Without it,
      // saveFile() falls back to writing a temp copy under
      // BaseDirectory.Temp, which on Android resolves to
      // /data/local/tmp/ — the app sandbox has no write permission
      // there and the call fails with EACCES ("failed to open file at
      // path: /data/local/tmp/...epub Permission denied (os error
      // 13)"). Passing the absolute path also avoids re-buffering the
      // whole epub/pdf into memory just to have saveFile write it back
      // to disk.
      const absoluteFilePath = await appService.resolveFilePath(path, base);
      // `null` content: there's nothing to write — the file already lives at
      // `filePath`, which the native share path reads directly.
      await appService.saveFile(shareFilename, null, {
        share: true,
        mimeType,
        filePath: absoluteFilePath,
        sharePosition,
      });
    } catch (err) {
      console.error('Failed to send book file:', err);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to send book'),
        timeout: 2500,
      });
    }
  };

  const sendSelectedNearby = () => {
    // Group ids in the selection simply don't match any book hash and drop
    // out; LocalSendManager resolves the files and reports unavailable books.
    const ids = getSelectedBooks();
    const books = ids
      .map((id) => filteredBooks.find((book) => book.hash === id))
      .filter((book): book is Book => !!book);
    if (books.length === 0) return;
    setShowSelectModeActions(false);
    handleSetSelectMode(false);
    eventDispatcher.dispatch('localsend-send-books', { books });
  };

  const updateBooksStatus = async (status: ReadingStatus | undefined) => {
    const selectedIds = getSelectedBooks();
    const booksToUpdate: Book[] = [];

    for (const id of selectedIds) {
      const book = filteredBooks.find((b) => b.hash === id);
      if (book) {
        booksToUpdate.push(withReadingStatus(book, status));
      }
    }

    if (booksToUpdate.length > 0) {
      await updateBooks(envConfig, booksToUpdate);
    }

    setSelectedBooks([]);
    setShowStatusAlert(false);
    setShowSelectModeActions(true);
  };

  const handleUpdateReadingStatus = useCallback(
    async (book: Book, status: ReadingStatus | undefined) => {
      const updatedBook = withReadingStatus(book, status);
      await updateBooks(envConfig, [updatedBook]);
    },
    [envConfig, updateBooks],
  );

  const handleDeleteBooksIntent = (event: CustomEvent) => {
    const { ids } = event.detail;
    setBookIdsToDelete(ids);
    setShowSelectModeActions(false);
    setShowDeleteAlert(true);
  };

  useEffect(() => {
    if (isSelectMode) {
      setShowSelectModeActions(true);
      if (isSelectAll) {
        // `isSelectAll` stays latched until select mode or navigation clears
        // it, so applying it again whenever the shelves recompute would undo
        // the user's manual unticks. Honour each request once.
        if (!selectAllAppliedRef.current) {
          selectAllAppliedRef.current = true;
          setSelectedBooks(currentShelfBooks.map((book) => book.hash));
        }
        return;
      }
      selectAllAppliedRef.current = false;
      if (isSelectNone) {
        setSelectedBooks([]);
      }
    } else {
      selectAllAppliedRef.current = false;
      setSelectedBooks([]);
      setShowSelectModeActions(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSelectMode, isSelectAll, isSelectNone, currentShelfBooks]);

  useEffect(() => {
    eventDispatcher.on('delete-books', handleDeleteBooksIntent);
    return () => {
      eventDispatcher.off('delete-books', handleDeleteBooksIntent);
    };
  }, []);

  const { user } = useAuth();
  const [shareDialogBook, setShareDialogBook] = useState<Book | null>(null);

  useEffect(() => {
    const handleShareIntent = (event: CustomEvent) => {
      const book = (event.detail as { book?: Book } | undefined)?.book;
      if (!book) return;
      if (!user) {
        // Logged-out users can't share their own files; route through the
        // login flow instead. The /auth route preserves a return path.
        eventDispatcher.dispatch('toast', {
          type: 'info',
          message: _('Sign in to share books'),
          timeout: 2500,
        });
        return;
      }
      setShareDialogBook(book);
    };
    eventDispatcher.on('show-share-dialog', handleShareIntent);
    return () => {
      eventDispatcher.off('show-share-dialog', handleShareIntent);
    };
  }, [user, _]);

  // OverlayScrollbars + Virtuoso integration: Virtuoso manages its own
  // scroller; OverlayScrollbars wraps it for overlay scrollbar rendering.
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [initialize, osInstance] = useOverlayScrollbars({
    defer: true,
    options: { scrollbars: { autoHide: 'scroll' } },
    events: {
      initialized(instance) {
        const { viewport } = instance.elements();
        viewport.style.overflowX = 'var(--os-viewport-overflow-x)';
        viewport.style.overflowY = 'var(--os-viewport-overflow-y)';
      },
    },
  });

  useEffect(() => {
    // Use the stream's immediate wrapper so OS keeps the viewport inside the
    // measured container instead of moving it beside an empty full-width div.
    const root = scroller?.parentElement;
    if (scroller && root) {
      initialize({ target: root, elements: { viewport: scroller } });
    }
    return () => osInstance()?.destroy();
  }, [scroller, initialize, osInstance]);

  // Expose the Virtuoso scroller to the parent for pull-to-refresh & scroll save.
  const handleScrollerRef = useCallback(
    (el: HTMLElement | Window | null) => {
      const div = el instanceof HTMLElement ? el : null;
      setScroller(div);
      onScrollerRef(div as HTMLDivElement | null);
    },
    [onScrollerRef],
  );

  const selectedBooks = getSelectedBooks();

  // Bulk download (#5244): a selected group stands in for every book it shows,
  // which is how a 300-book folder gets onto a new device in one action. Only
  // worth computing while the select-mode bar is up.
  const downloadableBooks = isSelectMode
    ? selectDownloadableBooks(selectedBooks, sortedBookshelfItems, filteredBooks)
    : [];

  const downloadSelectedBooks = async () => {
    const books = downloadableBooks;
    if (books.length === 0) return;
    handleSetSelectMode(false);
    // One summary up front rather than a toast per book: the Readest Cloud
    // path returns as soon as each book is queued, but a file backend
    // actually fetches them, and either way the user needs immediate feedback
    // that the batch started.
    eventDispatcher.dispatch('toast', {
      type: 'info',
      timeout: 2000,
      message: _('Downloading {{count}} book(s)', { count: books.length }),
    });
    // Batched like the bulk delete path so a file backend isn't hit with
    // hundreds of simultaneous fetches.
    const concurrency = 20;
    let failed = 0;
    for (let i = 0; i < books.length; i += concurrency) {
      const batch = books.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map((book) => handleBookDownload(book, { queued: true, silent: true })),
      );
      failed += results.filter((ok) => !ok).length;
    }
    if (failed > 0) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to download {{count}} book(s)', { count: failed }),
      });
    }
  };

  const { openBook } = useOpenBook({ setLoading, handleBookDownload });
  const openSearchResult = useCallback(
    (book: Book, cfi: string) => openBook(book, cfi, { highlightSearchResult: true }),
    [openBook],
  );

  // Cover transfer overlay progress for every book on screen, from both
  // sources: queued downloads live in the transfer store, direct ones in
  // `booksTransferProgress`. Merged on read so neither has to reconcile
  // against the other's lifecycle, and so the recent strip and the grid
  // cannot disagree about the same book. Selecting `transfers` keeps the
  // subscription off the store's unrelated UI fields.
  const transfers = useTransferStore((state) => state.transfers);
  const transferProgress = useMemo(
    () => ({ ...selectActiveBookDownloadProgress(transfers), ...booksTransferProgress }),
    [transfers, booksTransferProgress],
  );

  // Reserve enough trailing space for the fixed select-mode action bar so the
  // last book scrolls clear of it (#5175). `selectModeActionsHeight` already
  // includes the bar's safe-area padding and is 0 whenever the bar is hidden,
  // so the baseline breathing room applies at all other times.
  const footerHeight =
    selectModeActionsHeight > 0
      ? selectModeActionsHeight + DEFAULT_FOOTER_HEIGHT
      : DEFAULT_FOOTER_HEIGHT;

  const renderBookshelfItem = useCallback(
    (item: Book | BooksGroup, mode: LibraryViewModeType, shelf: BookshelfDefinition) => (
      <BookshelfItem
        item={item}
        mode={mode}
        coverFit={shelf.coverFit || 'crop'}
        skeuomorphicCovers={shelf.skeuomorphicCovers}
        isSelectMode={isSelectMode}
        itemSelected={
          'hash' in item
            ? selectedBookSet.has(item.hash)
            : item.books.every((book) => selectedBookSet.has(book.hash)) ||
              selectedBookSet.has(item.id)
        }
        setLoading={setLoading}
        toggleSelection={(id) => toggleSelection(id, 'books' in item ? item : undefined)}
        handleGroupBooks={groupSelectedBooks}
        handleBookUpload={handleBookUpload}
        handleBookDownload={handleBookDownload}
        handleBookDelete={handleBookDelete}
        handleSetSelectMode={handleSetSelectMode}
        handleShowDetailsBook={handleShowDetailsBook}
        handleLibraryNavigation={(group) => handleLibraryNavigation(group, shelf.id)}
        handleUpdateReadingStatus={handleUpdateReadingStatus}
        transferProgress={'hash' in item ? (transferProgress[item.hash] ?? null) : null}
        showTimeRemaining={
          shelf.sort.by === 'timeRemaining' || shelf.sort.thenBy === 'timeRemaining'
        }
      />
    ),
    [
      isSelectMode,
      selectedBookSet,
      toggleSelection,
      groupSelectedBooks,
      handleBookUpload,
      handleBookDownload,
      handleBookDelete,
      handleSetSelectMode,
      handleShowDetailsBook,
      handleLibraryNavigation,
      handleUpdateReadingStatus,
      transferProgress,
    ],
  );
  const lastShelf = sections.at(-1)?.definition;
  const importTile =
    visibleBooks.length > 0 && lastShelf?.layout === 'grid' ? (
      <div
        className='bookshelf-import-item mx-0 my-2 sm:mx-4 sm:my-4'
        style={
          lastShelf.coverFit === 'fit'
            ? { display: 'flex', paddingBottom: `${iconSize15 + 24}px` }
            : undefined
        }
      >
        <button
          type='button'
          aria-label={_('Import Books')}
          aria-haspopup='menu'
          className={clsx(
            'bookitem-main eink-bordered bg-base-100/50 hover:bg-base-300/50 flex aspect-28/41 w-full items-center justify-center rounded-sm',
            'focus-visible:ring-base-content/15 focus-visible:outline-hidden focus-visible:ring-2',
          )}
          onClick={(event) => handleImportBooks(event.currentTarget)}
        >
          <PiPlus aria-hidden className='text-base-content/60 size-10' />
        </button>
      </div>
    ) : undefined;
  const importAction = !visibleBooks.length ? (
    <div className='flex justify-center p-6'>
      <LibraryEmptyState onImport={handleImportBooks} />
    </div>
  ) : !importTile ? (
    <div className='flex justify-center px-4 py-4'>
      <LibraryImportButton onImport={handleImportBooks} />
    </div>
  ) : undefined;

  return (
    <div
      ref={autofocusRef}
      tabIndex={-1}
      role='main'
      aria-label={_('Bookshelf')}
      className='bookshelf flex min-h-0 grow flex-col focus:outline-hidden'
    >
      {!contentSearch?.query.trim() && queryTerm && (
        <div className='flex shrink-0 justify-center px-4 pb-2'>
          <button
            type='button'
            onClick={onSearchContents}
            className={clsx(
              'eink-bordered border-base-200 bg-base-100 hover:border-base-300 hover:bg-base-300/40',
              'text-base-content/80 hover:text-base-content not-eink:transition-colors',
              'flex h-9 items-center gap-2 rounded-lg border px-4 text-sm font-medium duration-150',
              'focus-visible:ring-base-content/15 focus-visible:outline-hidden focus-visible:ring-2',
            )}
          >
            <MdManageSearch aria-hidden='true' className='h-5 w-5' />
            {_('Search in book contents')}
          </button>
        </div>
      )}
      {contentSearch?.query.trim() && appService ? (
        <LibrarySearchResults
          appService={appService}
          books={visibleBooks}
          query={contentSearch.query.trim()}
          config={contentSearch.config}
          onSelectResult={openSearchResult}
          onProgress={onSearchProgress}
        />
      ) : (
        // The OverlayScrollbars root and the search results are siblings on
        // purpose: OS decorates this subtree with its own DOM, and letting
        // React swap children inside it caused NotFoundError crashes on
        // WebKit when a search was cleared.
        <div className='min-h-0 flex-1'>
          <BookshelfStream
            pageNavigation={!!settings.globalViewSettings?.isEink}
            navigationBottomInset={
              selectModeActionsHeight ||
              (appService?.hasSafeAreaInset ? (safeAreaInsets?.bottom || 0) * 0.33 : 0)
            }
            pageDurations={pageDurations}
            sections={sections}
            autoColumns={settings.libraryAutoColumns}
            fixedColumns={settings.libraryColumns}
            footerHeight={footerHeight}
            importAction={importAction}
            importTile={importTile}
            renderItem={renderBookshelfItem}
            onScrollerRef={handleScrollerRef}
          />
        </div>
      )}
      {loading && (
        <div className='fixed inset-0 z-50 flex items-center justify-center'>
          <Spinner loading />
        </div>
      )}
      {!showGroupingModal && !tagBookHashes && isSelectMode && showSelectModeActions && (
        <SelectModeActions
          selectedBooks={selectedBooks}
          safeAreaBottom={safeAreaInsets?.bottom || 0}
          onHeightChange={setSelectModeActionsHeight}
          // Native send targets: iOS, Android, macOS — route through
          // tauri-plugin-sharekit (UIActivityViewController /
          // Intent.ACTION_SEND / NSSharingServicePicker). Linux has no
          // system share sheet, Windows WebView2 share UI is disabled
          // upstream (issue #4343 — deadlocks the main thread), and web
          // browsers don't expose a real "send file to <app>" sheet, so
          // the button is hidden on those platforms.
          sendEnabled={
            !!appService &&
            (appService.isIOSApp || appService.isAndroidApp || appService.isMacOSApp)
          }
          sendNearbyEnabled={isTauriAppPlatform() && isLocalSendEnabled()}
          onSendNearby={sendSelectedNearby}
          canDownload={downloadableBooks.length > 0}
          onOpen={openSelectedBooks}
          onGroup={groupSelectedBooks}
          onTag={tagSelectedBooks}
          onDetails={openBookDetails}
          onStatus={showStatusSelection}
          onDownload={downloadSelectedBooks}
          onSend={sendSelectedBook}
          onDelete={deleteSelectedBooks}
          onCancel={() => handleSetSelectMode(false)}
        />
      )}
      {showGroupingModal && selectedBooks.length > 0 && (
        <ModalPortal>
          <GroupingModal
            libraryBooks={libraryBooks}
            selectedBooks={selectedBooks}
            parentGroupName={getGroupName(groupId) || ''}
            onCancel={() => {
              setShowGroupingModal(false);
              setShowSelectModeActions(true);
            }}
            onConfirm={() => {
              setShowGroupingModal(false);
              handleSetSelectMode(false);
            }}
          />
        </ModalPortal>
      )}
      {tagBookHashes && (
        <ModalPortal>
          <TaggingModal
            libraryBooks={libraryBooks}
            bookHashes={tagBookHashes}
            onCancel={() => {
              setTagBookHashes(null);
              setShowSelectModeActions(true);
            }}
            onConfirm={() => {
              setTagBookHashes(null);
              handleSetSelectMode(false);
            }}
          />
        </ModalPortal>
      )}
      {showDeleteAlert && (
        <div
          className={clsx('delete-alert fixed bottom-0 left-0 right-0 z-50 flex justify-center')}
          style={{
            paddingBottom: `${(safeAreaInsets?.bottom || 0) + 16}px`,
          }}
        >
          <DeleteConfirmAlert
            title={_('Confirm Deletion')}
            message={_('Are you sure to delete {{count}} selected book(s)?', {
              count: getBooksToDelete().length,
            })}
            showPurgeToggle
            onCancel={() => {
              abortDeletionRef.current = true;
              setShowDeleteAlert(false);
              setShowSelectModeActions(true);
            }}
            onConfirm={confirmDelete}
          />
        </div>
      )}
      {showStatusAlert && (
        <SetStatusAlert
          selectedCount={getSelectedBooks().length}
          safeAreaBottom={safeAreaInsets?.bottom || 0}
          onCancel={() => {
            setShowStatusAlert(false);
            setShowSelectModeActions(true);
          }}
          onUpdateStatus={updateBooksStatus}
        />
      )}
      <ShareBookDialog
        isOpen={!!shareDialogBook}
        book={shareDialogBook}
        onClose={() => setShareDialogBook(null)}
      />
    </div>
  );
};

export default Bookshelf;
