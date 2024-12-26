import React, { useEffect, useState } from 'react';

import { Book } from '@/types/book';
import { EnvConfigType } from '@/services/environment';
import { fetchBookDetails } from '@/services/bookService';

import WindowButtons from '@/components/WindowButtons';

const BookDetailModal = ({
  isOpen,
  onClose,
  book,
  envConfig,
}: {
  isOpen: boolean;
  onClose: () => void;
  book: Book;
  envConfig: EnvConfigType;
}) => {
  if (!isOpen) return null;
  const [bookMeta, setBookMeta] = useState<null | {
    title: string;
    language: string | string[];
    editor?: string;
    publisher?: string;
    description?: string;
  }>(null);

  useEffect(() => {
    fetchBookDetails(book, envConfig).then((details) => setBookMeta(details));
  }, [book]);

  if (!bookMeta)
    return (
      <div className='fixed inset-0 z-50 flex items-center justify-center'>
        {/* Transparent gray overlay */}
        <div className='fixed inset-0 bg-gray-800 bg-opacity-70' onClick={onClose} />

        <div className='bg-base-200 relative z-50 w-full max-w-md rounded-lg p-6 shadow-xl'>
          {/* Close button */}
          <WindowButtons
            className='window-buttons absolute right-4 top-4 !ml-2 flex'
            showMinimize={false}
            showMaximize={false}
            onClose={onClose}
          />
          <h2 className='text-base-content text-center text-2xl font-semibold'>
            Loading Book Details...
          </h2>
        </div>
      </div>
    );

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center'>
      {/* Transparent gray overlay */}
      <div className='fixed inset-0 bg-gray-800 bg-opacity-70' onClick={onClose} />

      <div className='bg-base-200 relative z-50 w-full max-w-md rounded-lg p-6 shadow-xl'>
        {/* Close button */}
        <WindowButtons
          className='window-buttons absolute right-4 top-4 !ml-2 flex'
          showMinimize={false}
          showMaximize={false}
          onClose={onClose}
        />

        {/* Book Cover */}
        <div className='mb-4 flex flex-col items-center'>
          {book.coverImageUrl ? (
            <img
              src={book.coverImageUrl}
              alt={book.title}
              className='mb-4 h-32 w-32 object-contain'
            />
          ) : (
            <div className='mb-4 flex h-32 w-32 items-center justify-center bg-gray-300'>
              <span className='text-gray-500'>No Image</span>
            </div>
          )}
        </div>

        {/* Book Details */}
        {bookMeta && (
          <>
            <h2 className='text-base-content text-center text-2xl font-semibold'>
              {bookMeta.title || 'Untitled'}
            </h2>
            <p className='text-neutral-content'>
              <span className='font-medium'>Author:</span> {book.author || 'Unknown Author'}
            </p>
            <p className='text-neutral-content'>
              <span className='font-medium'>Publisher:</span>{' '}
              {bookMeta.publisher || 'Unknown Publisher'}
            </p>
            <p className='text-neutral-content'>
              <span className='font-medium'>Updated:</span>{' '}
              {book.lastUpdated ? new Date(book.lastUpdated).toLocaleDateString() : 'Unknown Date'}
            </p>
            <p className='text-neutral-content'>
              <span className='font-medium'>Language:</span>{' '}
              {bookMeta.language || 'Unknown Language'}
            </p>
            <p className='text-neutral-content'>
              <span className='font-medium'>Description:</span>{' '}
              {bookMeta.description || 'No Description'}
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default BookDetailModal;
