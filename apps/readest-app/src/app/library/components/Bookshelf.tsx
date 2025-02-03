import clsx from 'clsx';
import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { MdDelete, MdOpenInNew } from 'react-icons/md';
import { PiPlus } from 'react-icons/pi';
import { Menu, MenuItem } from '@tauri-apps/api/menu';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { Book, BooksGroup } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { navigateToReader } from '@/utils/nav';
import { getOSPlatform } from '@/utils/misc';
import { getFilename } from '@/utils/book';
import { FILE_REVEAL_LABELS, FILE_REVEAL_PLATFORMS } from '@/utils/os';

import Alert from '@/components/Alert';
import Spinner from '@/components/Spinner';
import BookDetailModal from '@/components/BookDetailModal';
import BookItem from './BookItem';
import GroupItem from './GroupItem';

type BookshelfItem = Book | BooksGroup;

const UNGROUPED_NAME = 'ungrouped';

const generateBookshelfItems = (books: Book[]): BookshelfItem[] => {
  const groups: BooksGroup[] = books.reduce((acc: BooksGroup[], book: Book) => {
    if (book.deletedAt) return acc;
    book.group = book.group || UNGROUPED_NAME;
    const groupIndex = acc.findIndex((group) => group.name === book.group);
    const booksGroup = acc[acc.findIndex((group) => group.name === book.group)];
    if (booksGroup) {
      booksGroup.books.push(book);
      booksGroup.updatedAt = Math.max(acc[groupIndex]!.updatedAt, book.updatedAt);
    } else {
      acc.push({
        name: book.group,
        books: [book],
        updatedAt: book.updatedAt,
      });
    }
    return acc;
  }, []);
  const ungroupedBooks: Book[] = groups.find((group) => group.name === UNGROUPED_NAME)?.books || [];
  const groupedBooks: BooksGroup[] = groups.filter((group) => group.name !== UNGROUPED_NAME);
  return [...ungroupedBooks, ...groupedBooks].sort((a, b) => b.updatedAt - a.updatedAt);
};

interface BookshelfProps {
  libraryBooks: Book[];
  isSelectMode: boolean;
  handleImportBooks: () => void;
  handleBookUpload: (book: Book) => void;
  handleBookDownload: (book: Book) => void;
  handleBookDelete: (book: Book) => void;
  booksTransferProgress: { [key: string]: number | null };
}

const Bookshelf: React.FC<BookshelfProps> = ({
  libraryBooks,
  isSelectMode,
  handleImportBooks,
  handleBookUpload,
  handleBookDownload,
  handleBookDelete,
  booksTransferProgress,
}) => {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { updateBook } = useLibraryStore();
  const [loading, setLoading] = useState(false);
  const [selectedBooks, setSelectedBooks] = useState<string[]>([]);
  const [showDeleteAlert, setShowDeleteAlert] = useState(false);
  const [clickedImage, setClickedImage] = useState<string | null>(null);
  const [importBookUrl] = useState(searchParams?.get('url') || '');
  const isImportingBook = useRef(false);
  const [showDetailsBook, setShowDetailsBook] = useState<Book | null>(null);

  const makeBookAvailable = async (book: Book) => {
    if (book.uploadedAt && !book.downloadedAt) {
      let available = false;
      try {
        await handleBookDownload(book);
        updateBook(envConfig, book);
        available = true;
      } finally {
        return available;
      }
    }
    return true;
  };

  const showBookDetailsModal = async (book: Book) => {
    if (await makeBookAvailable(book)) {
      setShowDetailsBook(book);
    }
  };

  const dismissBookDetailsModal = () => {
    setShowDetailsBook(null);
  };

  const { setLibrary } = useLibraryStore();

  useEffect(() => {
    setSelectedBooks([]);
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

  const bookshelfItems = generateBookshelfItems(libraryBooks);

  const handleBookClick = async (book: Book) => {
    if (!(await makeBookAvailable(book))) return;

    if (isSelectMode) {
      toggleSelection(book.hash);
    } else {
      setClickedImage(book.hash);
      setTimeout(() => setClickedImage(null), 300);
      setTimeout(() => setLoading(true), 200);
      navigateToReader(router, [book.hash]);
    }
  };

  const toggleSelection = (id: string) => {
    setSelectedBooks((prev) =>
      prev.includes(id) ? prev.filter((bookId) => bookId !== id) : [...prev, id],
    );
  };

  const openSelectedBooks = () => {
    setTimeout(() => setLoading(true), 200);
    navigateToReader(router, selectedBooks);
  };

  const confirmDelete = async () => {
    for (const selectedBook of selectedBooks) {
      const book = libraryBooks.find((b) => b.hash === selectedBook);
      if (book) {
        await handleBookDelete(book);
      }
    }
    setSelectedBooks([]);
    setShowDeleteAlert(false);
  };

  const deleteSelectedBooks = () => {
    setShowDeleteAlert(true);
  };

  const bookContextMenuHandler = async (book: Book, e: React.MouseEvent) => {
    if (!appService?.hasContextMenu) return;
    e.preventDefault();
    e.stopPropagation();
    const osPlatform = getOSPlatform();
    const fileRevealLabel =
      FILE_REVEAL_LABELS[osPlatform as FILE_REVEAL_PLATFORMS] || FILE_REVEAL_LABELS.default;
    const openBookMenuItem = await MenuItem.new({
      text: isSelectMode ? _('Select Book') : _('Open Book'),
      action: async () => {
        handleBookClick(book);
      },
    });
    const showBookInFinderMenuItem = await MenuItem.new({
      text: _(fileRevealLabel),
      action: async () => {
        const folder = `${settings.localBooksDir}/${getFilename(book)}`;
        revealItemInDir(folder);
      },
    });
    const showBookDetailsMenuItem = await MenuItem.new({
      text: _('Show Book Details'),
      action: async () => {
        showBookDetailsModal(book);
      },
    });
    const uploadBookMenuItem = await MenuItem.new({
      text: _('Upload Book'),
      action: async () => {
        handleBookUpload(book);
      },
    });
    const deleteBookMenuItem = await MenuItem.new({
      text: _('Delete'),
      action: async () => {
        await handleBookDelete(book);
      },
    });
    const menu = await Menu.new();
    menu.append(openBookMenuItem);
    menu.append(showBookDetailsMenuItem);
    menu.append(showBookInFinderMenuItem);
    menu.append(uploadBookMenuItem);
    menu.append(deleteBookMenuItem);
    menu.popup();
  };

  return (
    <div className='bookshelf'>
      <div className='grid grid-cols-3 gap-0 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8'>
        {bookshelfItems.map((item, index) => (
          <div
            key={`library-item-${index}`}
            className='hover:bg-base-300/50 group flex h-full flex-col p-4'
          >
            <div className='flex-grow'>
              {'format' in item ? (
                <BookItem
                  book={item}
                  isSelectMode={isSelectMode}
                  selectedBooks={selectedBooks}
                  clickedBookHash={clickedImage}
                  handleBookClick={handleBookClick}
                  handleBookUpload={handleBookUpload}
                  handleBookDownload={handleBookDownload}
                  showBookDetailsModal={showBookDetailsModal}
                  bookContextMenuHandler={bookContextMenuHandler}
                  transferProgress={booksTransferProgress[item.hash] || null}
                />
              ) : (
                <GroupItem group={item} />
              )}
            </div>
          </div>
        ))}
        {bookshelfItems.length > 0 && (
          <div
            className='border-1 bg-base-100 hover:bg-base-300/50 m-4 flex aspect-[28/41] items-center justify-center'
            role='button'
            onClick={handleImportBooks}
          >
            <PiPlus className='size-10' color='gray' />
          </div>
        )}
      </div>
      {selectedBooks.length > 0 && (
        <div
          className={clsx(
            'text-base-content bg-base-300 fixed bottom-4 left-1/2 flex',
            '-translate-x-1/2 transform space-x-4 rounded-lg p-4 shadow-lg',
          )}
        >
          <button onClick={openSelectedBooks} className='flex items-center space-x-2'>
            <MdOpenInNew />
            <span>{_('Open')}</span>
          </button>
          <button onClick={deleteSelectedBooks} className='flex items-center space-x-2'>
            <MdDelete className='fill-red-500' />
            <span className='text-red-500'>{_('Delete')}</span>
          </button>
        </div>
      )}
      {loading && (
        <div className='fixed inset-0 z-50 flex items-center justify-center'>
          <Spinner loading />
        </div>
      )}
      {showDeleteAlert && (
        <Alert
          title={_('Confirm Deletion')}
          message={_('Are you sure to delete the selected books?')}
          onClickCancel={() => setShowDeleteAlert(false)}
          onClickConfirm={confirmDelete}
        />
      )}
      {showDetailsBook && (
        <BookDetailModal
          isOpen={!!showDetailsBook}
          book={showDetailsBook}
          onClose={dismissBookDetailsModal}
        />
      )}
    </div>
  );
};

export default Bookshelf;
