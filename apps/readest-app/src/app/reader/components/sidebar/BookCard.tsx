import clsx from 'clsx';
import React, { useRef } from 'react';
import { MdInfoOutline } from 'react-icons/md';
import { Book } from '@/types/book';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { formatAuthors, formatTitle } from '@/utils/book';
import BookCover from '@/components/BookCover';

const BookCard = ({ book }: { book: Book }) => {
  const { title, author } = book;
  const _ = useTranslation();
  const { isDarkMode } = useThemeStore();
  const iconSize18 = useResponsiveSize(18);
  const bookCoverRef = useRef<HTMLDivElement | null>(null);

  const showBookDetails = () => {
    eventDispatcher.dispatchSync('show-book-details', book);
  };

  return (
    <div className='flex h-20 w-full items-center'>
      <div
        ref={bookCoverRef}
        className={clsx(
          'me-4 aspect-[28/41] max-h-16 w-[15%] max-w-12 overflow-hidden rounded-sm shadow-md',
          isDarkMode ? 'mix-blend-screen' : 'mix-blend-multiply',
        )}
      >
        <BookCover
          book={book}
          mode='list'
          coverFit='crop'
          imageClassName='rounded-sm'
          onImageError={() => (bookCoverRef.current!.style.display = 'none')}
        />
      </div>
      <div className='min-w-0 flex-1'>
        <h4 className='line-clamp-2 w-[90%] text-sm font-semibold'>
          {formatTitle(title).replace(/\u00A0/g, ' ')}
        </h4>
        <p className='truncate text-xs opacity-75'>{formatAuthors(author)}</p>
      </div>
      <button
        className='btn btn-ghost hover:bg-base-300 h-6 min-h-6 w-6 rounded-full p-0 transition-colors'
        aria-label={_('More Info')}
        onClick={showBookDetails}
      >
        <MdInfoOutline size={iconSize18} className='fill-base-content' />
      </button>
    </div>
  );
};

export default BookCard;
