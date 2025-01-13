import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import Image from 'next/image';

import { Book } from '@/types/book';
import { BookDoc } from '@/libs/document';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { formatDate, formatLanguage, formatPublisher, formatSubject } from '@/utils/book';
import WindowButtons from '@/components/WindowButtons';
import Spinner from './Spinner';

interface BookDetailModalProps {
  book: Book;
  isOpen: boolean;
  onClose: () => void;
}

const BookDetailModal = ({ book, isOpen, onClose }: BookDetailModalProps) => {
  const _ = useTranslation();
  const [loading, setLoading] = useState(false);
  const [bookMeta, setBookMeta] = useState<BookDoc['metadata'] | null>(null);
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    const loadingTimeout = setTimeout(() => setLoading(true), 300);
    const fetchBookDetails = async () => {
      const appService = await envConfig.getAppService();
      const details = await appService.fetchBookDetails(book, settings);
      setBookMeta(details);
      setLoading(false);
      if (loadingTimeout) clearTimeout(loadingTimeout);
    };
    fetchBookDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book]);

  const handleClose = () => {
    setBookMeta(null);
    onClose();
  };

  if (!isOpen) return null;

  if (!bookMeta)
    return (
      loading && (
        <div className='fixed inset-0 z-50 flex items-center justify-center'>
          <Spinner loading />
        </div>
      )
    );

  return (
    <div className='fixed inset-0 z-50 flex w-full select-text items-center justify-center'>
      <div className='min-w-[480px] max-w-md'>
        <div className='fixed inset-0 bg-gray-800 bg-opacity-70' onClick={handleClose} />

        <div className='bg-base-200 relative z-50 w-full rounded-lg p-6 shadow-xl'>
          <div className='absolute right-4 top-4 flex space-x-2'>
            <WindowButtons
              className='window-buttons flex'
              showMinimize={false}
              showMaximize={false}
              onClose={handleClose}
            />
          </div>

          <div className='mb-6 flex h-40 items-start'>
            <div className='book-cover relative mr-10 aspect-[28/41] h-40 items-end shadow-lg'>
              <Image
                src={book.coverImageUrl!}
                alt={book.title}
                fill={true}
                className='w-10 object-cover'
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                  (e.target as HTMLImageElement).nextElementSibling?.classList.remove('invisible');
                }}
              />
              <div
                className={clsx(
                  'invisible absolute inset-0 flex items-center justify-center p-1',
                  'text-neutral-content rounded-none text-center font-serif text-base font-medium',
                )}
              >
                {book.title}
              </div>
            </div>

            <div className='title-author flex h-40 max-w-[60%] flex-col justify-between pr-4'>
              <div>
                <h2 className='text-base-content mb-2 line-clamp-2 break-all text-2xl font-bold'>
                  {book.title || _('Untitled')}
                </h2>
                <p className='text-neutral-content line-clamp-1'>{book.author || _('Unknown')}</p>
              </div>
              <button className='btn-disabled bg-primary/25 hover:bg-primary/85 w-36 rounded px-4 py-2 text-white'>
                {_('More Info')}
              </button>
            </div>
          </div>

          <div className='text-base-content mb-4'>
            <div className='mb-4 grid grid-cols-3 gap-4'>
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
                <p className='text-neutral-content text-sm'>{formatDate(book.lastUpdated) || ''}</p>
              </div>
            </div>

            <div className='grid grid-cols-3 gap-4'>
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
    </div>
  );
};

export default BookDetailModal;
