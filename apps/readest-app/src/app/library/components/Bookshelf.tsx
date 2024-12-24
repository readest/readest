import clsx from 'clsx';
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { PiPlus } from 'react-icons/pi';
import { MdDelete, MdOpenInNew } from 'react-icons/md';
import { MdCheckCircle, MdCheckCircleOutline } from 'react-icons/md';

import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';

import { Book, BooksGroup } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { navigateToReader } from '@/utils/nav';
import Alert from '@/components/Alert';
import Spinner from '@/components/Spinner';

type BookshelfItem = Book | BooksGroup;

const UNGROUPED_NAME = 'ungrouped';

const generateBookshelfItems = (books: Book[]): BookshelfItem[] => {
  const groups: BooksGroup[] = books.reduce((acc: BooksGroup[], book: Book) => {
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
  onImportBooks: () => void;
}

const Bookshelf: React.FC<BookshelfProps> = ({ libraryBooks, isSelectMode, onImportBooks }) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { envConfig, appService } = useEnv();
  const { deleteBook } = useLibraryStore();
  const [loading, setLoading] = useState(false);
  const [selectedBooks, setSelectedBooks] = useState<string[]>([]);
  const [showDeleteAlert, setShowDeleteAlert] = useState(false);
  const [clickedImage, setClickedImage] = useState<string | null>(null);
  const [importBookUrl] = useState(searchParams.get('url') || '');
  const isImportingBook = useRef(false);

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

  const handleBookClick = (id: string) => {
    if (isSelectMode) {
      toggleSelection(id);
    } else {
      setClickedImage(id);
      setTimeout(() => setClickedImage(null), 300);
      setTimeout(() => setLoading(true), 200);
      navigateToReader(router, [id]);
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

  const confirmDelete = () => {
    for (const selectedBook of selectedBooks) {
      const book = libraryBooks.find((b) => b.hash === selectedBook);
      if (book) {
        deleteBook(envConfig, book);
      }
    }
    setSelectedBooks([]);
    setShowDeleteAlert(false);
  };

  const deleteSelectedBooks = () => {
    setShowDeleteAlert(true);
  };

  return (
    <div className='bookshelf'>
      <div className='grid grid-cols-3 gap-0 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8'>
        {bookshelfItems.map((item, index) => (
          <div
            key={`library-item-${index}`}
            className='hover:bg-base-300/50 flex h-full flex-col p-4'
          >
            <div className='flex-grow'>
              {'format' in item ? (
                <div
                  className='book-item cursor-pointer'
                  onClick={() => handleBookClick(item.hash)}
                >
                  <div key={(item as Book).hash} className='bg-base-100 shadow-md'>
                    <div className='relative aspect-[28/41]'>
                      <Image
                        src={item.coverImageUrl!}
                        alt={item.title}
                        fill={true}
                        className='object-cover'
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                          (e.target as HTMLImageElement).nextElementSibling?.classList.remove(
                            'invisible',
                          );
                        }}
                      />
                      <div
                        className={clsx(
                          'invisible absolute inset-0 flex items-center justify-center p-1',
                          'text-neutral-content rounded-none text-center font-serif text-base font-medium',
                        )}
                      >
                        {item.title}
                      </div>
                      {(selectedBooks.includes(item.hash) || clickedImage === item.hash) && (
                        <div className='absolute inset-0 bg-black opacity-30 transition-opacity duration-300'></div>
                      )}
                      {isSelectMode && (
                        <div className='absolute bottom-1 right-1'>
                          {selectedBooks.includes(item.hash) ? (
                            <MdCheckCircle size={20} className='fill-blue-500' />
                          ) : (
                            <MdCheckCircleOutline
                              size={20}
                              className='fill-gray-300 drop-shadow-sm'
                            />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className='card-body p-0 pt-2'>
                    <h4 className='card-title line-clamp-1 text-[0.6em] text-xs font-semibold'>
                      {(item as Book).title}
                    </h4>
                  </div>
                </div>
              ) : (
                <div>
                  {(item as BooksGroup).books.map((book) => (
                    <div key={book.hash} className='card bg-base-100 w-full shadow-md'>
                      <figure>
                        <Image
                          width={10}
                          height={10}
                          src={book.coverImageUrl!}
                          alt={book.title || ''}
                          className='h-48 w-full object-cover'
                        />
                      </figure>
                    </div>
                  ))}
                  <h2 className='mb-2 text-lg font-bold'>{(item as BooksGroup).name}</h2>
                </div>
              )}
            </div>
          </div>
        ))}

        {bookshelfItems.length > 0 && (
          <div
            className='border-1 bg-base-100 hover:bg-base-300/50 m-4 flex aspect-[28/41] items-center justify-center'
            role='button'
            onClick={onImportBooks}
          >
            <PiPlus className='size-10' color='gray' />
          </div>
        )}
      </div>
      {selectedBooks.length > 0 && (
        <div className='text-base-content bg-base-300 fixed bottom-4 left-1/2 flex -translate-x-1/2 transform space-x-4 rounded-lg p-4 shadow-lg'>
          <button onClick={openSelectedBooks} className='flex items-center space-x-2'>
            <MdOpenInNew />
            <span>Open</span>
          </button>
          <button onClick={deleteSelectedBooks} className='flex items-center space-x-2'>
            <MdDelete className='fill-red-500' />
            <span className='text-red-500'>Delete</span>
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
          title='Confirm Deletion'
          message='Are you sure to delete the selected books?'
          onClickCancel={() => setShowDeleteAlert(false)}
          onClickConfirm={confirmDelete}
        />
      )}
    </div>
  );
};

export default Bookshelf;
