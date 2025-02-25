import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import Image from 'next/image';

import { Book } from '@/types/book';
import { BookDoc } from '@/libs/document';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import {
  formatAuthors,
  formatDate,
  formatLanguage,
  formatPublisher,
  formatSubject,
  formatTitle,
} from '@/utils/book';
import Alert from '@/components/Alert';
import Spinner from './Spinner';
import Dialog from './Dialog';

interface BookDetailModalProps {
  book: Book;
  isOpen: boolean;
  onClose: () => void;
}

const BookDetailModal = ({ book, isOpen, onClose }: BookDetailModalProps) => {
  const _ = useTranslation();
  const [loading, setLoading] = useState(false);
  const [showDeleteAlert, setShowDeleteAlert] = useState(false);
  const [bookMeta, setBookMeta] = useState<BookDoc['metadata'] | null>(null);
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { updateBook } = useLibraryStore();

  useEffect(() => {
    const loadingTimeout = setTimeout(() => setLoading(true), 300);
    const fetchBookDetails = async () => {
      const appService = await envConfig.getAppService();
      try {
        const details = await appService.fetchBookDetails(book, settings);
        setBookMeta(details);
      } finally {
        if (loadingTimeout) clearTimeout(loadingTimeout);
        setLoading(false);
      }
    };
    fetchBookDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book]);

  const handleClose = () => {
    setBookMeta(null);
    onClose();
  };

  const handleDelete = () => {
    setShowDeleteAlert(true);
  };

  const confirmDelete = async () => {
    await appService?.deleteBook(book, !!book.uploadedAt);
    await updateBook(envConfig, book);
    handleClose();
    setShowDeleteAlert(false);
  };

  if (!bookMeta)
    return (
      loading && (
        <div className='fixed inset-0 z-50 flex items-center justify-center'>
          <Spinner loading />
        </div>
      )
    );

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center'>
      <Dialog
        title={_('Book Details')}
        isOpen={isOpen}
        onClose={handleClose}
        bgClassName='sm:bg-black/50'
        boxClassName='sm:min-w-[480px] sm:h-auto'
        contentClassName='!px-6 !py-2'
      >
        <div className='flex w-full select-text items-center justify-center'>
          <div className='relative w-full rounded-lg'>
            <div className='mb-10 flex h-40 items-start'>
              <div className='book-cover relative mr-10 aspect-[28/41] h-40 items-end shadow-lg'>
                <Image
                  src={book.coverImageUrl!}
                  alt={formatTitle(book.title)}
                  fill={true}
                  className='w-10 object-cover'
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
                  {formatTitle(book.title)}
                </div>
              </div>

              <div className='title-author flex h-40 flex-col justify-between'>
                <div>
                  <p className='text-base-content mb-2 line-clamp-2 break-all text-2xl font-bold'>
                    {formatTitle(book.title) || _('Untitled')}
                  </p>
                  <p className='text-neutral-content line-clamp-1'>
                    {formatAuthors(book.author, bookMeta.language) || _('Unknown')}
                  </p>
                </div>
                {window.innerWidth >= 400 && (
                  <div className='flex flex-wrap items-center gap-x-4 gap-y-2 py-2'>
                    <button
                      className='btn rounded-xl bg-red-600 px-4 text-white hover:bg-red-700'
                      onClick={handleDelete}
                    >
                      {_('Delete')}
                    </button>
                    <button className='btn btn-disabled bg-primary/25 hover:bg-primary/85 rounded-xl px-4 text-white'>
                      {_('More Info')}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {window.innerWidth < 400 && (
              <div className='flex flex-wrap items-center gap-x-4 gap-y-2 py-2'>
                <button
                  className='btn rounded bg-red-600 text-white hover:bg-red-700'
                  onClick={handleDelete}
                >
                  {_('Delete')}
                </button>
                <button className='btn btn-disabled bg-primary/25 hover:bg-primary/85 rounded px-4 text-white'>
                  {_('More Info')}
                </button>
              </div>
            )}

            <div className='text-base-content my-4'>
              <div className='mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3'>
                <div className='overflow-hidden'>
                  <span className='font-bold'>{_('Publisher:')}</span>
                  <p className='text-neutral-content line-clamp-1 text-sm'>
                    {formatPublisher(bookMeta.publisher || '') || _('Unknown')}
                  </p>
                </div>
                <div className='overflow-hidden'>
                  <span className='font-bold'>{_('Published:')}</span>
                  <p className='text-neutral-content max-w-28 text-ellipsis text-sm'>
                    {formatDate(bookMeta.published) || _('Unknown')}
                  </p>
                </div>
                <div className='overflow-hidden'>
                  <span className='font-bold'>{_('Updated:')}</span>
                  <p className='text-neutral-content text-sm'>
                    {formatDate(book.lastUpdated) || ''}
                  </p>
                </div>

                <div className='overflow-hidden'>
                  <span className='font-bold'>{_('Language:')}</span>
                  <p className='text-neutral-content text-sm'>
                    {formatLanguage(bookMeta.language) || _('Unknown')}
                  </p>
                </div>
                <div className='overflow-hidden'>
                  <span className='font-bold'>{_('Identifier:')}</span>
                  <p className='text-neutral-content line-clamp-1 text-sm'>
                    {bookMeta.identifier || 'N/A'}
                  </p>
                </div>
                <div className='overflow-hidden'>
                  <span className='font-bold'>{_('Subjects:')}</span>
                  <p className='text-neutral-content line-clamp-1 text-sm'>
                    {formatSubject(bookMeta.subject) || _('Unknown')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Dialog>
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
            }}
            onConfirm={confirmDelete}
          />
        </div>
      )}
    </div>
  );
};

export default BookDetailModal;
