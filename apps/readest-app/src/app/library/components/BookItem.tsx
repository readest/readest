import clsx from 'clsx';
import { MdCheckCircle, MdCheckCircleOutline } from 'react-icons/md';
import {
  LiaCloudUploadAltSolid,
  LiaCloudDownloadAltSolid,
  LiaInfoCircleSolid,
} from 'react-icons/lia';

import { Book } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { LibraryCoverFitType, LibraryViewModeType } from '@/types/settings';
import { navigateToLogin } from '@/utils/nav';
import { formatAuthors, formatDescription } from '@/utils/book';
import ReadingProgress from './ReadingProgress';
import BookCover from '@/components/BookCover';

interface BookItemProps {
  book: Book;
  mode: LibraryViewModeType;
  coverFit: LibraryCoverFitType;
  isSelectMode: boolean;
  bookSelected: boolean;
  transferProgress: number | null;
  handleBookUpload: (book: Book) => void;
  handleBookDownload: (book: Book, options?: { redownload?: boolean; queued?: boolean }) => void;
  showBookDetailsModal: (book: Book) => void;
}

const BookItem: React.FC<BookItemProps> = ({
  book,
  mode,
  coverFit,
  isSelectMode,
  bookSelected,
  transferProgress,
  handleBookUpload,
  handleBookDownload,
  showBookDetailsModal,
}) => {
  const _ = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const { appService } = useEnv();
  const iconSize15 = useResponsiveSize(15);

  return (
    <div
      role='none'
      className={clsx(
        'book-item flex',
        mode === 'grid' && 'h-full flex-col justify-end',
        mode === 'list' && 'h-28 flex-row gap-4 overflow-hidden',
        mode === 'list' ? 'library-list-item' : 'library-grid-item',
        appService?.hasContextMenu ? 'cursor-pointer' : '',
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className={clsx(
          'bookitem-main relative flex aspect-[28/41] justify-center rounded',
          coverFit === 'crop' && 'overflow-hidden shadow-md',
          mode === 'grid' && 'items-end',
          mode === 'list' && 'min-w-20 items-center',
        )}
      >
        <BookCover
          mode={mode}
          book={book}
          coverFit={coverFit}
          showSpine={false}
          imageClassName='rounded shadow-md'
        />
        {bookSelected && (
          <div className='absolute inset-0 bg-black opacity-30 transition-opacity duration-300'></div>
        )}
        {isSelectMode && (
          <div className='absolute bottom-1 right-1'>
            {bookSelected ? (
              <MdCheckCircle className='fill-blue-500' />
            ) : (
              <MdCheckCircleOutline className='fill-gray-300 drop-shadow-sm' />
            )}
          </div>
        )}
      </div>
      <div
        className={clsx(
          'flex w-full flex-col p-0',
          mode === 'grid' && 'pt-2',
          mode === 'list' && 'gap-2 py-0',
        )}
      >
        <div className={clsx('min-w-0 flex-1', mode === 'list' && 'flex flex-col gap-2')}>
          <h4
            className={clsx(
              'overflow-hidden text-ellipsis font-semibold',
              mode === 'grid' && 'block whitespace-nowrap text-[0.6em] text-xs',
              mode === 'list' && 'line-clamp-2 text-base',
            )}
          >
            {book.title}
          </h4>
          {mode === 'list' && (
            <p className='text-neutral-content line-clamp-1 text-sm'>
              {formatAuthors(book.author, book.primaryLanguage) || ''}
            </p>
          )}
        </div>
        {mode === 'list' && (
          <h4 className='text-neutral-content line-clamp-1 text-sm'>
            {formatDescription(book.metadata?.description)}
          </h4>
        )}
        <div
          className={clsx('flex items-center', book.progress ? 'justify-between' : 'justify-end')}
          style={{
            height: `${iconSize15}px`,
            minHeight: `${iconSize15}px`,
          }}
        >
          {book.progress && <ReadingProgress book={book} />}
          <div className='flex items-center justify-center gap-x-2'>
            {!appService?.isMobile && (
              <button
                aria-label={_('Show Book Details')}
                className='show-detail-button -m-2 p-2 sm:opacity-0 sm:group-hover:opacity-100'
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  showBookDetailsModal(book);
                }}
              >
                <div className='pt-[2px] sm:pt-[1px]'>
                  <LiaInfoCircleSolid size={iconSize15} />
                </div>
              </button>
            )}
            {transferProgress !== null ? (
              transferProgress === 100 ? null : (
                <div
                  className='radial-progress'
                  style={
                    {
                      '--value': transferProgress,
                      '--size': `${iconSize15}px`,
                      '--thickness': '2px',
                    } as React.CSSProperties
                  }
                  role='progressbar'
                ></div>
              )
            ) : (
              (!book.uploadedAt || (book.uploadedAt && !book.downloadedAt)) && (
                <button
                  className='show-cloud-button -m-2 p-2'
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    if (!user) {
                      navigateToLogin(router);
                      return;
                    }
                    if (!book.uploadedAt) {
                      handleBookUpload(book);
                    } else if (!book.downloadedAt) {
                      handleBookDownload(book, { queued: true });
                    }
                  }}
                >
                  {!book.uploadedAt && <LiaCloudUploadAltSolid size={iconSize15} />}
                  {book.uploadedAt && !book.downloadedAt && (
                    <LiaCloudDownloadAltSolid size={iconSize15} />
                  )}
                </button>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BookItem;
