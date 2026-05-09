import clsx from 'clsx';
import { useRef } from 'react';
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
    <div className='border-[#5e4525]/18 flex w-full items-center gap-4 border bg-[linear-gradient(180deg,rgba(23,15,12,0.76),rgba(12,8,7,0.9))] px-4 py-4 text-[#dcc8a1] shadow-[inset_0_1px_0_rgba(255,237,193,0.05)]'>
      <div
        ref={bookCoverRef}
        className={clsx(
          'aspect-[28/41] max-h-[82px] w-[20%] max-w-[60px] overflow-hidden rounded-[8px] shadow-md',
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
        <h4 className='line-clamp-2 w-[92%] font-serif text-[16px] font-semibold text-[#e6d0a1]'>
          {formatTitle(title).replace(/\u00A0/g, ' ')}
        </h4>
        <p className='mt-1 truncate text-[11px] uppercase tracking-[0.16em] text-[#9f8254]'>
          {formatAuthors(author)}
        </p>
      </div>
      <button
        className='btn btn-ghost bg-[#1a110f]/62 h-8 min-h-8 w-8 border border-[#6a4d28]/20 p-0 text-[#c4a56d] transition-colors hover:bg-[#241612] hover:text-[#e6d0a1]'
        aria-label={_('More Info')}
        onClick={showBookDetails}
      >
        <MdInfoOutline size={iconSize18} className='fill-current' />
      </button>
    </div>
  );
};

export default BookCard;
