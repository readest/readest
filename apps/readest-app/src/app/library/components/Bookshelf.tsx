import clsx from 'clsx';
import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PiPlus } from 'react-icons/pi';
import { useOverlayScrollbars } from 'overlayscrollbars-react';
import 'overlayscrollbars/overlayscrollbars.css';
import {
  Virtuoso,
  VirtuosoGrid,
  type Components,
  type GridComponents,
  type GridListProps,
  type ListProps,
} from 'react-virtuoso';
import { Book, BooksGroup, ReadingStatus } from '@/types/book';
import {
  LibraryCoverFitType,
  LibraryGroupByType,
  LibrarySortByType,
  LibraryViewModeType,
} from '@/types/settings';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useAutoFocus } from '@/hooks/useAutoFocus';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { navigateToLibrary, navigateToReader, showReaderWindow } from '@/utils/nav';
import {
  createBookFilter,
  createBookGroups,
  createBookSorter,
  createGroupSorter,
  createWithinGroupSorter,
  ensureLibraryGroupByType,
  ensureLibrarySortByType,
  ensureLibrarySecondarySortByType,
  expandBookshelfSelection,
  getBookSortValue,
  getGroupSortValue,
  compareSortValues,
  resolveEffectivePrimarySort,
  resolveEffectiveSecondarySort,
} from '../utils/libraryUtils';
import { eventDispatcher } from '@/utils/event';
import { getLocalBookFilename } from '@/utils/book';
import { MIMETYPES, EXTS } from '@/libs/document';
import { makeSafeFilename } from '@/utils/misc';

import { useSpatialNavigation } from '../hooks/useSpatialNavigation';
import Alert from '@/components/Alert';
import Spinner from '@/components/Spinner';
import ModalPortal from '@/components/ModalPortal';
import BookshelfItem, { generateBookshelfItems } from './BookshelfItem';
import SelectModeActions from './SelectModeActions';
import ShareBookDialog from './ShareBookDialog';
import { useAuth } from '@/context/AuthContext';
import GroupingModal from './GroupingModal';
import SetStatusAlert from './SetStatusAlert';

interface BookshelfProps {
  libraryBooks: Book[];
  isSelectMode: boolean;
  isSelectAll: boolean;
  isSelectNone: boolean;
  onScrollerRef: (el: HTMLDivElement | null) => void;
  handleImportBooks: () => void;
  handleBookDownload: (
    book: Book,
    options?: { redownload?: boolean; queued?: boolean },
  ) => Promise<boolean>;
  handleBookUpload: (book: Book, syncBooks?: boolean) => Promise<boolean>;
  handleBookDelete: (book: Book, syncBooks?: boolean) => Promise<boolean>;
  handleSetSelectMode: (selectMode: boolean) => void;
  handleShowDetailsBook: (book: Book) => void;
  handleLibraryNavigation: (targetGroup: string) => void;
  handlePushLibrary: () => Promise<void>;
  booksTransferProgress: { [key: string]: number | null };
}

/**
 * Context passed to the custom Virtuoso `List` components so they can render
 * grid styles that depend on runtime settings without being re-created on
 * every Bookshelf render (which would break Virtuoso's component identity).
 */
type BookshelfListContext = {
  autoColumns: boolean;
  fixedColumns: number;
};

const BOOKSHELF_GRID_CLASSES =
  'bookshelf-items transform-wrapper grid gap-x-4 px-4 sm:gap-x-0 sm:px-2 ' +
  'grid-cols-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-12';

const BOOKSHELF_LIST_CLASSES = 'bookshelf-items transform-wrapper flex flex-col';

const BookshelfGridList: GridComponents<BookshelfListContext>['List'] = React.forwardRef<
  HTMLDivElement,
  GridListProps & { context?: BookshelfListContext }
>(({ children, className, style, context, 'data-testid': testId }, ref) => (
  <div
    ref={ref}
    data-testid={testId}
    className={clsx(BOOKSHELF_GRID_CLASSES, className)}
    style={{
      ...style,
      gridTemplateColumns:
        context && !context.autoColumns
          ? `repeat(${context.fixedColumns}, minmax(0, 1fr))`
          : undefined,
    }}
  >
    {children}
  </div>
));
BookshelfGridList.displayName = 'BookshelfGridList';

const BookshelfLinearList: Components['List'] = React.forwardRef<HTMLDivElement, ListProps>(
  ({ children, style, 'data-testid': testId }, ref) => (
    <div ref={ref} data-testid={testId} className={BOOKSHELF_LIST_CLASSES} style={style}>
      {children}
    </div>
  ),
);
BookshelfLinearList.displayName = 'BookshelfLinearList';

const GRID_VIRTUOSO_COMPONENTS: GridComponents<BookshelfListContext> = {
  List: BookshelfGridList,
  Footer: () => <div style={{ height: 34 }} />,
};
const LIST_VIRTUOSO_COMPONENTS: Components = {
  List: BookshelfLinearList,
  Footer: () => <div style={{ height: 34 }} />,
};

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
  handleSetSelectMode,
  handleShowDetailsBook,
  handleLibraryNavigation,
  handlePushLibrary,
  booksTransferProgress,
}) => {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { safeAreaInsets } = useThemeStore();

  const groupId = searchParams?.get('group') || '';
  const queryTerm = searchParams?.get('q') || null;
  const viewMode = searchParams?.get('view') || settings.libraryViewMode;
  const storedSortBy = ensureLibrarySortByType(searchParams?.get('sort'), settings.librarySortBy);
  const sortOrder = searchParams?.get('order') || (settings.librarySortAscending ? 'asc' : 'desc');
  const groupBy = ensureLibraryGroupByType(searchParams?.get('groupBy'), settings.libraryGroupBy);
  const sortByAuto = settings.librarySortByAuto ?? true;
  const sortBy = resolveEffectivePrimarySort(storedSortBy, groupBy, sortByAuto);
  const sortBy2Raw = ensureLibrarySecondarySortByType(
    searchParams?.get('sort2'),
    settings.librarySortBy2 ?? 'none',
  );
  const sortBy2 = resolveEffectiveSecondarySort(sortBy2Raw, groupBy);
  const coverFit = searchParams?.get('cover') || settings.libraryCoverFit;

  const [loading, setLoading] = useState(false);
  const [showSelectModeActions, setShowSelectModeActions] = useState(false);
  const [bookIdsToDelete, setBookIdsToDelete] = useState<string[]>([]);
  const [showDeleteAlert, setShowDeleteAlert] = useState(false);
  const [showStatusAlert, setShowStatusAlert] = useState(false);
  const [showGroupingModal, setShowGroupingModal] = useState(false);
  const [importBookUrl] = useState(searchParams?.get('url') || '');

  const abortDeletionRef = useRef(false);
  const isImportingBook = useRef(false);
  const iconSize15 = useResponsiveSize(15);
  const autofocusRef = useAutoFocus<HTMLDivElement>();
  useSpatialNavigation(autofocusRef);

  const { setCurrentBookshelf, setLibrary, updateBooks } = useLibraryStore();
  const { setSelectedBooks, getSelectedBooks, toggleSelectedBook } = useLibraryStore();
  const { getGroupName } = useLibraryStore();

  const uiLanguage = localStorage?.getItem('i18nextLng') || '';

  const updateUrlParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams?.toString());

      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === '') {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      });

      if (params.get('sort') === LibrarySortByType.Updated) params.delete('sort');
      if (params.get('order') === 'desc') params.delete('order');
      if (params.get('groupBy') === LibraryGroupByType.Group) params.delete('groupBy');
      if (params.get('cover') === 'crop') params.delete('cover');
      if (params.get('view') === 'grid') params.delete('view');

      const newParamString = params.toString();
      const currentParamString = searchParams?.toString() || '';

      if (newParamString !== currentParamString) {
        navigateToLibrary(router, newParamString);
      }
    },
    [router, searchParams],
  );

  const filteredBooks = useMemo(() => {
    const bookFilter = createBookFilter(queryTerm);
    return queryTerm ? libraryBooks.filter((book) => bookFilter(book)) : libraryBooks;
  }, [libraryBooks, queryTerm]);

  const currentBookshelfItems = useMemo(() => {
    if (groupBy === LibraryGroupByType.Group) {
      // Use existing generateBookshelfItems for group mode
      const groupName = getGroupName(groupId) || '';
      if (groupId && !groupName) {
        return [];
      }
      return generateBookshelfItems(filteredBooks, groupName);
    } else {
      // Use new createBookGroups for series/author/none modes
      const allItems = createBookGroups(filteredBooks, groupBy);

      // If navigating into a specific group, show only that group's books
      if (groupId) {
        const targetGroup = allItems.find(
          (item): item is BooksGroup => 'books' in item && item.id === groupId,
        );
        if (targetGroup) {
          // Return the books from the target group as individual items
          return targetGroup.books;
        }
        // Group not found, return empty
        return [];
      }

      return allItems;
    }
  }, [filteredBooks, groupBy, groupId, getGroupName]);

  useEffect(() => {
    if (groupId && currentBookshelfItems.length === 0) {
      updateUrlParams({ group: null });
    } else {
      updateUrlParams({});
    }
  }, [searchParams, groupId, currentBookshelfItems.length, updateUrlParams]);

  const sortedBookshelfItems = useMemo(() => {
    const sortOrderMultiplier = sortOrder === 'asc' ? 1 : -1;

    // Separate into ungrouped books and groups
    const ungroupedBooks = currentBookshelfItems.filter((item): item is Book => 'format' in item);
    const groups = currentBookshelfItems.filter((item): item is BooksGroup => 'books' in item);

    // Sort books within each group
    // For series groups, series index is always ascending; sort direction applies to fallback only
    const sortAscending = sortOrder === 'asc';
    const withinGroupSorter = createWithinGroupSorter(
      groupBy,
      sortBy,
      uiLanguage,
      sortAscending,
      sortBy2,
    );
    groups.forEach((group) => {
      group.books.sort(withinGroupSorter);
    });

    // Sort ungrouped books - use within-group sorter if we're inside a group
    // (for series, this ensures books are sorted by series index)
    const bookSorter = createBookSorter(sortBy, uiLanguage, sortBy2);
    if (groupId && groupBy !== LibraryGroupByType.Group && groupBy !== LibraryGroupByType.None) {
      ungroupedBooks.sort(withinGroupSorter);
      // When inside a group, books are already sorted correctly — return directly
      // to avoid the merge sort below overriding the within-group sort order
      return ungroupedBooks;
    } else {
      ungroupedBooks.sort((a, b) => bookSorter(a, b) * sortOrderMultiplier);
    }

    // Merge groups and ungrouped books, then sort them together
    const allItems: (Book | BooksGroup)[] = [...groups, ...ungroupedBooks];
    const groupSorter = createGroupSorter(sortBy, uiLanguage, groupBy);

    allItems.sort((a, b) => {
      const isAGroup = 'books' in a;
      const isBGroup = 'books' in b;

      // If both are groups, use group sorter
      if (isAGroup && isBGroup) {
        return groupSorter(a, b) * sortOrderMultiplier;
      }

      // If both are books, use book sorter
      if (!isAGroup && !isBGroup) {
        return bookSorter(a, b) * sortOrderMultiplier;
      }

      // For series/author groups: compare sort values to interleave properly
      if (isAGroup && !isBGroup) {
        const groupValue = getGroupSortValue(a, sortBy, groupBy);
        const bookValue = getBookSortValue(b, sortBy);
        return compareSortValues(groupValue, bookValue, uiLanguage) * sortOrderMultiplier;
      } else if (!isAGroup && isBGroup) {
        const bookValue = getBookSortValue(a, sortBy);
        const groupValue = getGroupSortValue(b, sortBy, groupBy);
        return compareSortValues(bookValue, groupValue, uiLanguage) * sortOrderMultiplier;
      }
      return 0;
    });

    return allItems;
  }, [sortOrder, sortBy, sortBy2, groupBy, groupId, uiLanguage, currentBookshelfItems]);

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
    setCurrentBookshelf(currentBookshelfItems);
  }, [currentBookshelfItems, setCurrentBookshelf]);

  const toggleSelection = useCallback(
    (id: string) => {
      toggleSelectedBook(id);
    },
    [toggleSelectedBook],
  );

  const openSelectedBooks = () => {
    handleSetSelectMode(false);
    if (appService?.hasWindow && settings.openBookInNewWindow) {
      showReaderWindow(appService, getSelectedBooks());
    } else {
      setTimeout(() => setLoading(true), 200);
      navigateToReader(router, getSelectedBooks());
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

  const confirmDelete = async () => {
    const books = getBooksToDelete();
    const concurrency = 20;

    for (let i = 0; i < books.length; i += concurrency) {
      if (abortDeletionRef.current) {
        abortDeletionRef.current = false;
        break;
      }
      const batch = books.slice(i, i + concurrency);
      await Promise.all(batch.map((book) => handleBookDelete(book, false)));
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

  const updateBooksStatus = async (status: ReadingStatus | undefined) => {
    const selectedIds = getSelectedBooks();
    const booksToUpdate: Book[] = [];

    for (const id of selectedIds) {
      const book = filteredBooks.find((b) => b.hash === id);
      if (book) {
        booksToUpdate.push({ ...book, readingStatus: status, updatedAt: Date.now() });
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
      const updatedBook = { ...book, readingStatus: status, updatedAt: Date.now() };
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
        setSelectedBooks(
          currentBookshelfItems.map((item) => ('hash' in item ? item.hash : item.id)),
        );
      } else if (isSelectNone) {
        setSelectedBooks([]);
      }
    } else {
      setSelectedBooks([]);
      setShowSelectModeActions(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSelectMode, isSelectAll, isSelectNone, currentBookshelfItems]);

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
  const osRootRef = useRef<HTMLDivElement>(null);
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
    const root = osRootRef.current;
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
  const isGridMode = viewMode === 'grid';
  const hasItems = sortedBookshelfItems.length > 0;
  // In grid mode the Import-Books "+" tile is rendered as an extra grid cell
  // after all books. We represent it to Virtuoso as an extra index past the
  // last book; list mode doesn't have an import tile.
  const gridTotalCount = hasItems ? sortedBookshelfItems.length + 1 : 0;

  const listContext = useMemo<BookshelfListContext>(
    () => ({
      autoColumns: settings.libraryAutoColumns,
      fixedColumns: settings.libraryColumns,
    }),
    [settings.libraryAutoColumns, settings.libraryColumns],
  );

  const renderBookshelfItem = useCallback(
    (index: number) => {
      if (isGridMode && index === sortedBookshelfItems.length) {
        return (
          <div
            className={clsx('bookshelf-import-item mx-0 my-2 sm:mx-4 sm:my-4')}
            style={
              coverFit === 'fit'
                ? { display: 'flex', paddingBottom: `${iconSize15 + 24}px` }
                : undefined
            }
          >
            <button
              aria-label={_('Import Books')}
              className={clsx(
                'bookitem-main bg-base-100 hover:bg-base-300/50',
                'flex items-center justify-center',
                'aspect-[28/41] w-full',
              )}
              onClick={handleImportBooks}
            >
              <div className='flex items-center justify-center'>
                <PiPlus className='size-10' color='gray' />
              </div>
            </button>
          </div>
        );
      }
      const item = sortedBookshelfItems[index];
      if (!item) return null;
      const itemSelected =
        'hash' in item ? selectedBooks.includes(item.hash) : selectedBooks.includes(item.id);
      return (
        <BookshelfItem
          item={item}
          mode={viewMode as LibraryViewModeType}
          coverFit={coverFit as LibraryCoverFitType}
          isSelectMode={isSelectMode}
          itemSelected={itemSelected}
          setLoading={setLoading}
          toggleSelection={toggleSelection}
          handleGroupBooks={groupSelectedBooks}
          handleBookUpload={handleBookUpload}
          handleBookDownload={handleBookDownload}
          handleBookDelete={handleBookDelete}
          handleSetSelectMode={handleSetSelectMode}
          handleShowDetailsBook={handleShowDetailsBook}
          handleLibraryNavigation={handleLibraryNavigation}
          handleUpdateReadingStatus={handleUpdateReadingStatus}
          transferProgress={
            'hash' in item ? booksTransferProgress[(item as Book).hash] || null : null
          }
        />
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      sortedBookshelfItems,
      selectedBooks,
      isGridMode,
      viewMode,
      coverFit,
      isSelectMode,
      booksTransferProgress,
      iconSize15,
      handleImportBooks,
      toggleSelection,
      handleBookUpload,
      handleBookDownload,
      handleBookDelete,
      handleSetSelectMode,
      handleShowDetailsBook,
      handleLibraryNavigation,
      handleUpdateReadingStatus,
    ],
  );

  const computeItemKey = useCallback(
    (index: number) => {
      if (isGridMode && index === sortedBookshelfItems.length) {
        return 'library-import-tile';
      }
      const item = sortedBookshelfItems[index];
      if (!item) return `library-item-${index}`;
      return `library-item-${'hash' in item ? item.hash : item.id}`;
    },
    [sortedBookshelfItems, isGridMode],
  );

  return (
    <div
      ref={autofocusRef}
      tabIndex={-1}
      role='main'
      aria-label={_('Bookshelf')}
      className='bookshelf min-h-0 flex-grow focus:outline-none'
    >
      <div ref={osRootRef} data-overlayscrollbars-initialize='' className='h-full'>
        {hasItems && isGridMode && (
          <VirtuosoGrid<unknown, BookshelfListContext>
            overscan={200}
            totalCount={gridTotalCount}
            components={GRID_VIRTUOSO_COMPONENTS}
            context={listContext}
            computeItemKey={computeItemKey}
            itemContent={renderBookshelfItem}
            scrollerRef={handleScrollerRef}
          />
        )}
        {hasItems && !isGridMode && (
          <Virtuoso
            overscan={200}
            totalCount={sortedBookshelfItems.length}
            components={LIST_VIRTUOSO_COMPONENTS}
            computeItemKey={computeItemKey}
            itemContent={renderBookshelfItem}
            scrollerRef={handleScrollerRef}
          />
        )}
      </div>
      {loading && (
        <div className='fixed inset-0 z-50 flex items-center justify-center'>
          <Spinner loading />
        </div>
      )}
      {!showGroupingModal && isSelectMode && showSelectModeActions && (
        <SelectModeActions
          selectedBooks={selectedBooks}
          safeAreaBottom={safeAreaInsets?.bottom || 0}
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
          onOpen={openSelectedBooks}
          onGroup={groupSelectedBooks}
          onDetails={openBookDetails}
          onStatus={showStatusSelection}
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
      {showDeleteAlert && (
        <div
          className={clsx('delete-alert fixed bottom-0 left-0 right-0 z-50 flex justify-center')}
          style={{
            paddingBottom: `${(safeAreaInsets?.bottom || 0) + 16}px`,
          }}
        >
          <Alert
            title={_('Confirm Deletion')}
            message={_('Are you sure to delete {{count}} selected book(s)?', {
              count: getBooksToDelete().length,
            })}
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
