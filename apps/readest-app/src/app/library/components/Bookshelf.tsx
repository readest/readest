import clsx from 'clsx';
import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PiPlus } from 'react-icons/pi';

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
import { navigateToLibrary, navigateToReader, showReaderWindow } from '@/utils/nav';
import {
  createBookFilter,
  createBookGroups,
  createBookSorter,
  createGroupSorter,
  createWithinGroupSorter,
  ensureLibraryGroupByType,
  ensureLibrarySortByType,
  getBookSortValue,
  getGroupSortValue,
  compareSortValues,
} from '../utils/libraryUtils';
import { eventDispatcher } from '@/utils/event';

import { useSpatialNavigation } from '../hooks/useSpatialNavigation';
import Alert from '@/components/Alert';
import Spinner from '@/components/Spinner';
import ModalPortal from '@/components/ModalPortal';
import BookshelfItem, { generateBookshelfItems } from './BookshelfItem';
import SelectModeActions from './SelectModeActions';
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

const BOOKSHELF_GRID_CLASSES =
  'bookshelf-items transform-wrapper grid grid-cols-1 gap-4 px-4 pb-2 sm:px-6 xl:grid-cols-2 2xl:grid-cols-3';

const BOOKSHELF_LIST_CLASSES =
  'bookshelf-items transform-wrapper flex flex-col gap-4 px-4 pb-2 sm:px-6';

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
  const viewMode = (searchParams?.get('view') || settings.libraryViewMode) as LibraryViewModeType;
  const sortBy = ensureLibrarySortByType(searchParams?.get('sort'), settings.librarySortBy);
  const sortOrder = searchParams?.get('order') || (settings.librarySortAscending ? 'asc' : 'desc');
  const groupBy = ensureLibraryGroupByType(
    searchParams?.get('groupBy'),
    searchParams?.get('group') ? settings.libraryGroupBy : LibraryGroupByType.None,
  );
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

  const collectionBooks = useMemo(
    () => filteredBooks.filter((book) => !book.deletedAt),
    [filteredBooks],
  );

  const currentBookshelfItems = useMemo(() => {
    if (groupBy === LibraryGroupByType.None) {
      return collectionBooks;
    }

    if (groupBy === LibraryGroupByType.Group) {
      const groupName = getGroupName(groupId) || '';
      if (groupId && !groupName) {
        return [];
      }
      return generateBookshelfItems(filteredBooks, groupName);
    }

    const allItems = createBookGroups(collectionBooks, groupBy);

    if (groupId) {
      const targetGroup = allItems.find(
        (item): item is BooksGroup => 'books' in item && item.id === groupId,
      );
      if (targetGroup) {
        return targetGroup.books;
      }
      return [];
    }

    return allItems;
  }, [collectionBooks, filteredBooks, getGroupName, groupBy, groupId]);

  useEffect(() => {
    if (groupId && currentBookshelfItems.length === 0) {
      updateUrlParams({ group: null });
    } else {
      updateUrlParams({});
    }
  }, [groupId, currentBookshelfItems.length, updateUrlParams]);

  const sortedBookshelfItems = useMemo(() => {
    const sortOrderMultiplier = sortOrder === 'asc' ? 1 : -1;

    const ungroupedBooks = currentBookshelfItems.filter((item): item is Book => 'format' in item);
    const groups = currentBookshelfItems.filter((item): item is BooksGroup => 'books' in item);

    const sortAscending = sortOrder === 'asc';
    const withinGroupSorter = createWithinGroupSorter(groupBy, sortBy, uiLanguage, sortAscending);
    groups.forEach((group) => {
      group.books.sort(withinGroupSorter);
    });

    const bookSorter = createBookSorter(sortBy, uiLanguage);
    if (groupId && groupBy !== LibraryGroupByType.Group && groupBy !== LibraryGroupByType.None) {
      ungroupedBooks.sort(withinGroupSorter);
      return ungroupedBooks;
    }

    ungroupedBooks.sort((a, b) => bookSorter(a, b) * sortOrderMultiplier);

    const allItems: (Book | BooksGroup)[] = [...groups, ...ungroupedBooks];
    const groupSorter = createGroupSorter(sortBy, uiLanguage, groupBy);

    allItems.sort((a, b) => {
      const isAGroup = 'books' in a;
      const isBGroup = 'books' in b;

      if (isAGroup && isBGroup) {
        return groupSorter(a, b) * sortOrderMultiplier;
      }

      if (!isAGroup && !isBGroup) {
        return bookSorter(a, b) * sortOrderMultiplier;
      }

      if (isAGroup && !isBGroup) {
        const groupValue = getGroupSortValue(a, sortBy, groupBy);
        const bookValue = getBookSortValue(b, sortBy);
        return compareSortValues(groupValue, bookValue, uiLanguage) * sortOrderMultiplier;
      }

      const bookValue = getBookSortValue(a as Book, sortBy);
      const groupValue = getGroupSortValue(b as BooksGroup, sortBy, groupBy);
      return compareSortValues(bookValue, groupValue, uiLanguage) * sortOrderMultiplier;
    });

    return allItems;
  }, [currentBookshelfItems, groupBy, groupId, sortBy, sortOrder, uiLanguage]);

  const renderedItems = useMemo(() => {
    if (groupBy === LibraryGroupByType.None) {
      return sortedBookshelfItems.filter((item): item is Book => 'format' in item);
    }
    return sortedBookshelfItems;
  }, [groupBy, sortedBookshelfItems]);

  useEffect(() => {
    if (isImportingBook.current) return;
    isImportingBook.current = true;

    if (importBookUrl && appService) {
      const importBook = async () => {
        const book = await appService.importBook(importBookUrl, libraryBooks);
        if (book) {
          setLibrary(libraryBooks);
          appService.saveLibraryBooks(libraryBooks);
          navigateToReader(router, [book.hash]);
        }
      };
      importBook();
    }
  }, [appService, importBookUrl, libraryBooks, router, setLibrary]);

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

  const getBooksToDelete = () => {
    const booksToDelete: Book[] = [];
    bookIdsToDelete.forEach((id) => {
      for (const book of filteredBooks.filter((book) => book.hash === id || book.groupId === id)) {
        if (book && !book.deletedAt) {
          booksToDelete.push(book);
        }
      }
    });
    return booksToDelete;
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
    setBookIdsToDelete(getSelectedBooks());
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
  }, [currentBookshelfItems, isSelectAll, isSelectMode, isSelectNone, setSelectedBooks]);

  useEffect(() => {
    eventDispatcher.on('delete-books', handleDeleteBooksIntent);
    return () => {
      eventDispatcher.off('delete-books', handleDeleteBooksIntent);
    };
  }, []);

  const scrollerRef = useCallback(
    (el: HTMLDivElement | null) => {
      onScrollerRef(el);
    },
    [onScrollerRef],
  );

  const selectedBooks = getSelectedBooks();
  const isGridMode = viewMode === 'grid';
  const hasItems = renderedItems.length > 0;

  return (
    <div
      ref={autofocusRef}
      tabIndex={-1}
      role='main'
      aria-label={_('Bookshelf')}
      className='bookshelf min-h-0 flex-grow focus:outline-none'
    >
      <div
        ref={scrollerRef}
        className={clsx(
          'bookshelf-grid-viewport h-full overflow-y-auto overflow-x-hidden pb-2',
          !isGridMode && 'pb-4',
        )}
      >
        {hasItems && isGridMode && (
          <div className={BOOKSHELF_GRID_CLASSES}>
            {renderedItems.map((item) => {
              const itemSelected =
                'hash' in item
                  ? selectedBooks.includes(item.hash)
                  : selectedBooks.includes(item.id);
              return (
                <BookshelfItem
                  key={'hash' in item ? item.hash : item.id}
                  item={item}
                  mode={viewMode}
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
            })}
            <div className='h-full'>
              <button
                aria-label={_('Import Books')}
                className='bookitem-main flex h-full min-h-[178px] w-full items-center justify-center rounded-[24px] border border-dashed border-[rgba(185,133,44,0.32)] bg-[linear-gradient(180deg,rgba(16,14,14,0.92)_0%,rgba(11,10,10,0.88)_100%)] text-[#aa8753] transition-all duration-200 hover:-translate-y-0.5 hover:border-[rgba(212,170,92,0.42)] hover:text-[#d3b57e]'
                onClick={handleImportBooks}
              >
                <div className='flex flex-col items-center justify-center gap-3'>
                  <PiPlus className='size-10' />
                  <span className='text-xs uppercase tracking-[0.18em]'>{_('Import Books')}</span>
                </div>
              </button>
            </div>
          </div>
        )}

        {hasItems && !isGridMode && (
          <div className={BOOKSHELF_LIST_CLASSES}>
            {renderedItems.map((item) => {
              const itemSelected =
                'hash' in item
                  ? selectedBooks.includes(item.hash)
                  : selectedBooks.includes(item.id);
              return (
                <BookshelfItem
                  key={'hash' in item ? item.hash : item.id}
                  item={item}
                  mode={viewMode}
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
            })}
          </div>
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
          onOpen={openSelectedBooks}
          onGroup={groupSelectedBooks}
          onDetails={openBookDetails}
          onStatus={showStatusSelection}
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
    </div>
  );
};

export default Bookshelf;
