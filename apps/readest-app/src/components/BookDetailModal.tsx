import React, { useEffect, useState } from 'react';

import { Book } from '@/types/book';
import { EnvConfigType } from '@/services/environment';
import { useSettingsStore } from '@/store/settingsStore';

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
    published?: string;
    description?: string;
    subject?: string[];
    identifier?: string;
  }>(null);

  const { settings } = useSettingsStore();

  useEffect(() => {
    const fetchBookDetails = async () => {
      const appService = await envConfig.getAppService();
      const details = await appService.fetchBookDetails(book, settings);
      setBookMeta(details);
    };
    fetchBookDetails();
  }, [book]);

  if (!bookMeta)
    return (
      <div className='fixed inset-0 z-50 flex items-center justify-center'>
        <div className='fixed inset-0 bg-gray-800 bg-opacity-70' onClick={onClose} />

        <div className='bg-base-200 relative z-50 w-full max-w-md rounded-lg p-6 shadow-xl'>
          <div className='absolute right-4 top-4 flex space-x-2'>
            <WindowButtons
              className='window-buttons flex'
              showMinimize={false}
              showMaximize={false}
              onClose={onClose}
            />
          </div>
          <h2 className='text-base-content text-center text-2xl font-semibold'>
            Loading Book Details...
          </h2>
        </div>
      </div>
    );

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center'>
      <div className='fixed inset-0 bg-gray-800 bg-opacity-70' onClick={onClose} />

      <div className='bg-base-200 relative z-50 w-full max-w-md rounded-lg p-6 shadow-xl'>
        <div className='absolute right-4 top-4 flex space-x-2'>
          <WindowButtons
            className='window-buttons flex'
            showMinimize={false}
            showMaximize={false}
            onClose={onClose}
          />
        </div>

        <div className='mb-6 flex items-start'>
          {book.coverImageUrl ? (
            <img
              src={book.coverImageUrl}
              alt={book.title}
              className='mr-4 h-40 w-30 rounded-lg object-contain shadow-md'
            />
          ) : (
            <div className='mr-4 flex h-40 w-30 items-center justify-center rounded-lg bg-gray-300'>
              <span className='text-gray-500'>No Image</span>
            </div>
          )}

          <div className='h-40 flex flex-col justify-between'>
            <h2 className='text-base-content mb-2 text-2xl font-bold'>
              {bookMeta.title || 'Untitled'}
            </h2>
            <p className='text-neutral-content mb-4'>{book.author || 'Unknown Author'}</p>
            <button className='mt-4 rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600'>
              More Info
            </button>
          </div>
        </div>

        <div className='text-base-content mb-4'>
          <div className='mb-4 grid grid-cols-3 gap-4'>
            <div>
              <span className='font-bold'>Publisher:</span>
              <p className='text-neutral-content'>{bookMeta.publisher || 'Unknown'}</p>
            </div>
            <div>
              <span className='font-bold'>Published:</span>
              <p className='text-neutral-content'>{bookMeta.published || 'Unknown Date'}</p>
            </div>
            <div>
              <span className='font-bold'>Updated:</span>
              <p className='text-neutral-content'>
                {book.lastUpdated
                  ? new Date(book.lastUpdated).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })
                  : 'Unknown Date'}
              </p>
            </div>
          </div>

          <div className='grid grid-cols-3 gap-4'>
            <div>
              <span className='font-bold'>Language:</span>
              <p className='text-neutral-content'>{bookMeta.language || 'Unknown'}</p>
            </div>
            <div>
              <span className='font-bold'>Identifier:</span>
              <p className='text-neutral-content'>
                {bookMeta.identifier ? bookMeta.identifier.slice(-8) : 'N/A'}
              </p>{' '}
              {/* Show last 8 characters */}
            </div>
            <div>
              <span className='font-bold'>Subjects:</span>
              <p className='text-neutral-content'>{bookMeta.subject?.join(', ') || 'None'}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BookDetailModal;
