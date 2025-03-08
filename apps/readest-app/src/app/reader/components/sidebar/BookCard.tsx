import clsx from 'clsx';
import React from 'react';
import Image from 'next/image';
import { MdInfoOutline } from 'react-icons/md';
import { Book } from '@/types/book';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { formatAuthors, formatTitle } from '@/utils/book';

const BookCard = ({ book }: { book: Book }) => {
  const { coverImageUrl, title, author } = book;
  const _ = useTranslation();
  const { isDarkMode } = useThemeStore();
  const iconSize18 = useResponsiveSize(18);

  const showBookDetails = () => {
    eventDispatcher.dispatchSync('show-book-details', book);
  };

  return (
    <div className='flex h-20 w-full items-center'>
      <Image
        src={coverImageUrl!}
        alt={_('Book Cover')}
        width={56}
        height={80}
        className={clsx(
          'me-4 aspect-auto max-h-16 w-[15%] max-w-12 rounded-sm object-cover shadow-md',
          isDarkMode ? 'mix-blend-screen' : 'mix-blend-multiply',
        )}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
      <div className='min-w-0 flex-1'>
        <h4 className='line-clamp-2 w-[90%] text-sm font-semibold'>{formatTitle(title)}</h4>
        <p className='truncate text-xs opacity-75'>{formatAuthors(author)}</p>
      </div>
      <button
        className='btn btn-ghost hover:bg-base-300 h-6 min-h-6 w-6 rounded-full p-0 transition-colors'
        aria-label={_('More Info')}
      >
        <MdInfoOutline size={iconSize18} className='fill-base-content' onClick={showBookDetails} />
      </button>
    </div>
  );
};

export default BookCard;
