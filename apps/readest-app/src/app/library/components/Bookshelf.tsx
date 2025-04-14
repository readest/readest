import clsx from 'clsx';
import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { MdDelete, MdOpenInNew, MdOutlineCancel } from 'react-icons/md';
import { LuFolderPlus } from 'react-icons/lu';
import { PiPlus } from 'react-icons/pi';
import { Book, BooksGroup } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useTranslation } from '@/hooks/useTranslation';
import { navigateToLibrary, navigateToReader } from '@/utils/nav';
import { formatAuthors, formatTitle } from '@/utils/book';
import { isMd5 } from '@/utils/md5';

import Alert from '@/components/Alert';
import Spinner from '@/components/Spinner';
import BookshelfItem, { generateBookshelfItems } from './BookshelfItem';
import GroupingModal from './GroupingModal';

interface BookshelfProps {
  libraryBooks: Book[];
  isSelectMode: boolean;
  handleImportBooks: () => void;
  handleBookUpload: (book: Book) => Promise<boolean>;
  handleBookDownload: (book: Book) => Promise<boolean>;
  handleBookDelete: (book: Book) => Promise<boolean>;
  handleSetSelectMode: (selectMode: boolean) => void;
  handleShowDetailsBook: (book: Book) => void;
  booksTransferProgress: { [key: string]: number | null };
}

const Bookshelf: React.FC<BookshelfProps> = ({
  libraryBooks,
  isSelectMode,
  handleImportBooks,
  handleBookUpload,
  handleBookDownload,
  handleBookDelete,
  handleSetSelectMode,
  handleShowDetailsBook,
  booksTransferProgress,
}) => {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const [loading, setLoading] = useState(false);
  const [selectedBooks, setSelectedBooks] = useState<string[]>([]);
  const [showSelectModeActions, setShowSelectModeActions] = useState(false);
  const [showDeleteAlert, setShowDeleteAlert] = useState(false);
  const [showGroupingModal, setShowGroupingModal] = useState(false);
  const [queryTerm, setQueryTerm] = useState<string | null>(null);
  const [navBooksGroup, setNavBooksGroup] = useState<BooksGroup | null>(null);
  const [importBookUrl] = useState(searchParams?.get('url') || '');
  const [sortBy, setSortBy] = useState(searchParams?.get('sort') || 'updated');
  const [sortOrder, setSortOrder] = useState(searchParams?.get('order') || 'desc');
  const isImportingBook = useRef(false);

  const { setLibrary } = useLibraryStore();
  const allBookshelfItems = generateBookshelfItems(libraryBooks);

  useEffect(() => {
    if (isSelectMode) {
      setShowSelectModeActions(true);
    } else {
      setSelectedBooks([]);
      setShowSelectModeActions(false);
    }
  }, [isSelectMode]);

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
    const group = searchParams?.get('group') || '';
    const query = searchParams?.get('q') || '';
    const sort = searchParams?.get('sort') || settings.librarySortBy;
    const order = searchParams?.get('order') || (settings.librarySortAscending ? 'asc' : 'desc');
    const params = new URLSearchParams(searchParams?.toString());
    if (query) {
      params.set('q', query);
      setQueryTerm(query);
    } else {
      params.delete('q');
      setQueryTerm(null);
    }
    if (sort) {
      params.set('sort', sort);
      setSortBy(sort);
    } else {
      params.delete('sort');
    }
    if (order) {
      params.set('order', order);
      setSortOrder(order);
    } else {
      params.delete('order');
    }
    if (sort === 'updated' && order === 'desc') {
      params.delete('sort');
      params.delete('order');
    }
    if (group) {
      const booksGroup = allBookshelfItems.find(
        (item) => 'name' in item && item.id === group,
      ) as BooksGroup;
      if (booksGroup) {
        setNavBooksGroup(booksGroup);
        params.set('group', group);
      } else {
        params.delete('group');
        navigateToLibrary(router, `${params.toString()}`);
      }
    } else {
      setNavBooksGroup(null);
      params.delete('group');
      navigateToLibrary(router, `${params.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, libraryBooks, showGroupingModal]);

  const toggleSelection = (id: string) => {
    setSelectedBooks((prev) =>
      prev.includes(id) ? prev.filter((selectedId) => selectedId !== id) : [...prev, id],
    );
  };

  const openSelectedBooks = () => {
    setTimeout(() => setLoading(true), 200);
    navigateToReader(router, selectedBooks);
  };

  const confirmDelete = async () => {
    selectedBooks.forEach((id) => {
      for (const book of libraryBooks.filter((book) => book.hash === id || book.groupId === id)) {
        if (book && !book.deletedAt) {
          handleBookDelete(book);
        }
      }
    });
    setSelectedBooks([]);
    setShowDeleteAlert(false);
    setShowSelectModeActions(true);
  };

  const deleteSelectedBooks = () => {
    setShowSelectModeActions(false);
    setShowDeleteAlert(true);
  };

  const groupSelectedBooks = () => {
    setShowSelectModeActions(false);
    setShowGroupingModal(true);
  };

  const currentBookshelfItems = navBooksGroup ? navBooksGroup.books : allBookshelfItems;
  const bookFilter = (item: Book, queryTerm: string) => {
    if (item.deletedAt) return false;
    const searchTerm = new RegExp(queryTerm, 'i');
    const title = formatTitle(item.title);
    const authors = formatAuthors(item.author);
    return searchTerm.test(title) || searchTerm.test(authors);
  };
  const bookSorter = (a: Book, b: Book) => {
    const uiLanguage = localStorage?.getItem('i18nextLng') || '';
    switch (sortBy) {
      case 'title':
        const aTitle = formatTitle(a.title);
        const bTitle = formatTitle(b.title);
        return aTitle.localeCompare(bTitle, uiLanguage || navigator.language);
      case 'author':
        const aAuthors = formatAuthors(a.author);
        const bAuthors = formatAuthors(b.author);
        return aAuthors.localeCompare(bAuthors, uiLanguage || navigator.language);
      case 'updated':
        return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      case 'created':
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      case 'format':
        return a.format.localeCompare(b.format, uiLanguage || navigator.language);
      default:
        return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
    }
  };
  const sortOrderMultiplier = sortOrder === 'asc' ? 1 : -1;
  const filteredBookshelfItems = currentBookshelfItems
    .filter((item) => {
      if ('name' in item) return item.books.some((book) => bookFilter(book, queryTerm || ''));
      else if (queryTerm) return bookFilter(item, queryTerm);
      return true;
    })
    .sort((a, b) => {
      const uiLanguage = localStorage?.getItem('i18nextLng') || '';
      if (sortBy === 'updated') {
        return (
          (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()) * sortOrderMultiplier
        );
      } else if ('name' in a || 'name' in b) {
        const aName = 'name' in a ? a.name : formatTitle(a.title);
        const bName = 'name' in b ? b.name : formatTitle(b.title);
        return aName.localeCompare(bName, uiLanguage || navigator.language) * sortOrderMultiplier;
      } else if (!('name' in a || 'name' in b)) {
        return bookSorter(a, b) * sortOrderMultiplier;
      } else {
        return 0;
      }
    });

  return (
    <div className='bookshelf'>
      <div
        className={clsx(
          'transform-wrapper grid flex-1 gap-x-4 sm:gap-x-0',
          'grid-cols-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-12',
        )}
      >
        {filteredBookshelfItems.map((item, index) => (
          <BookshelfItem
            key={`library-item-${index}`}
            item={item}
            isSelectMode={isSelectMode}
            selectedBooks={selectedBooks}
            setLoading={setLoading}
            toggleSelection={toggleSelection}
            handleBookUpload={handleBookUpload}
            handleBookDownload={handleBookDownload}
            handleBookDelete={handleBookDelete}
            handleSetSelectMode={handleSetSelectMode}
            handleShowDetailsBook={handleShowDetailsBook}
            transferProgress={
              'hash' in item ? booksTransferProgress[(item as Book).hash] || null : null
            }
          />
        ))}
        {!navBooksGroup && allBookshelfItems.length > 0 && (
          <div
            className={clsx(
              'border-1 bg-base-100 hover:bg-base-300/50 flex items-center justify-center',
              'mx-0 my-4 aspect-[28/41] sm:mx-4',
            )}
            role='button'
            onClick={handleImportBooks}
          >
            <PiPlus className='size-10' color='gray' />
          </div>
        )}
      </div>
      {loading && (
        <div className='fixed inset-0 z-50 flex items-center justify-center'>
          <Spinner loading />
        </div>
      )}
      <div className='fixed bottom-0 left-0 right-0 z-40 pb-[calc(env(safe-area-inset-bottom)+16px)]'>
        {isSelectMode && showSelectModeActions && (
          <div
            className={clsx(
              'flex items-center justify-center shadow-lg',
              'text-base-content bg-base-300 text-sm',
              'mx-auto w-fit space-x-6 rounded-lg p-4',
            )}
          >
            <button
              onClick={openSelectedBooks}
              className={clsx(
                'flex flex-col items-center justify-center',
                (!selectedBooks.length || !selectedBooks.every((id) => isMd5(id))) &&
                  'btn-disabled opacity-50',
              )}
            >
              <MdOpenInNew />
              <div>{_('Open')}</div>
            </button>
            <button
              onClick={groupSelectedBooks}
              className={clsx(
                'flex flex-col items-center justify-center',
                !selectedBooks.length && 'btn-disabled opacity-50',
              )}
            >
              <LuFolderPlus />
              <div>{_('Group')}</div>
            </button>
            <button
              onClick={deleteSelectedBooks}
              className={clsx(
                'flex flex-col items-center justify-center',
                !selectedBooks.length && 'btn-disabled opacity-50',
              )}
            >
              <MdDelete className='fill-red-500' />
              <div className='text-red-500'>{_('Delete')}</div>
            </button>
            <button
              onClick={() => handleSetSelectMode(false)}
              className={clsx('flex flex-col items-center justify-center')}
            >
              <MdOutlineCancel />
              <div>{_('Cancel')}</div>
            </button>
          </div>
        )}
      </div>
      {showGroupingModal && (
        <div>
          <GroupingModal
            libraryBooks={libraryBooks}
            selectedBooks={selectedBooks}
            onCancel={() => {
              setShowGroupingModal(false);
              setShowSelectModeActions(true);
            }}
            onConfirm={() => {
              setShowGroupingModal(false);
              handleSetSelectMode(false);
            }}
          />
        </div>
      )}
      {showDeleteAlert && (
        <div
          className={clsx(
            'fixed bottom-0 left-0 right-0 z-50 flex justify-center',
            'pb-[calc(env(safe-area-inset-bottom)+16px)]',
          )}
        >
          <Alert
            title={_('Confirm Deletion')}
            message={_('Are you sure to delete the selected books?')}
            onCancel={() => {
              setShowDeleteAlert(false);
              setShowSelectModeActions(true);
            }}
            onConfirm={confirmDelete}
          />
        </div>
      )}
    </div>
  );
};

export default Bookshelf;
