import clsx from 'clsx';
import Image from 'next/image';
import { Book } from '@/types/book';
import { LibraryCoverFitType, LibraryViewModeType } from '@/types/settings';
import { formatAuthors, formatTitle } from '@/utils/book';

interface BookCoverProps {
  book: Book;
  mode?: LibraryViewModeType;
  coverFit?: LibraryCoverFitType;
  className?: string;
  imageClassName?: string;
  isPreview?: boolean;
}

const BookCover: React.FC<BookCoverProps> = ({
  book,
  mode = 'grid',
  coverFit = 'crop',
  className,
  imageClassName,
  isPreview,
}) => {
  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.target as HTMLImageElement;
    img.style.display = 'none';

    const mainContainer = img.closest('.book-cover-container');
    const fallbackDiv = mainContainer?.querySelector('.fallback-cover');

    if (fallbackDiv) {
      fallbackDiv.classList.remove('invisible');
    }
  };

  return (
    <div className={clsx('book-cover-container relative flex h-full w-full', className)}>
      {coverFit === 'crop' ? (
        <Image
          src={book.coverImageUrl!}
          alt={book.title}
          fill={true}
          className={clsx('crop-cover-img object-cover shadow-md', imageClassName)}
          onError={handleImageError}
        />
      ) : (
        <div
          className={clsx(
            'flex h-full w-full justify-center',
            mode === 'grid' ? 'items-end' : 'items-center',
          )}
        >
          <Image
            src={book.coverImageUrl!}
            alt={book.title}
            width={0}
            height={0}
            sizes='100vw'
            className={clsx(
              'fit-cover-img h-auto max-h-full w-auto max-w-full shadow-md',
              imageClassName,
            )}
            onError={handleImageError}
          />
        </div>
      )}
      <div
        className={clsx(
          'fallback-cover invisible absolute inset-0 rounded-none p-2',
          'text-neutral-content text-center font-serif font-medium',
          isPreview ? 'bg-base-200/50' : 'bg-base-100',
        )}
      >
        <div className='flex h-1/2 items-center justify-center'>
          <span
            className={clsx(
              isPreview ? 'line-clamp-2' : mode === 'grid' ? 'line-clamp-3' : 'line-clamp-2',
              isPreview ? 'text-[0.5em]' : mode === 'grid' ? 'text-lg' : 'text-sm',
            )}
          >
            {formatTitle(book.title)}
          </span>
        </div>
        <div className='h-1/6'></div>
        <div className='flex h-1/3 items-center justify-center'>
          <span
            className={clsx(
              'text-neutral-content/50 line-clamp-1',
              isPreview ? 'text-[0.4em]' : mode === 'grid' ? 'text-base' : 'text-xs',
            )}
          >
            {formatAuthors(book.author)}
          </span>
        </div>
      </div>
    </div>
  );
};

export default BookCover;
