import clsx from 'clsx';
import { MdCheckCircle, MdCheckCircleOutline } from 'react-icons/md';
import { CiCircleMore } from 'react-icons/ci';
import { LiaCloudUploadAltSolid, LiaCloudDownloadAltSolid } from 'react-icons/lia';

import { Book } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { LibraryViewModeType } from '@/types/settings';
import { formatAuthors } from '@/utils/book';
import ReadingProgress from './ReadingProgress';
import BookCover from '@/components/BookCover';

interface BookItemProps {
  mode: LibraryViewModeType;
  book: Book;
  isSelectMode: boolean;
  selectedBooks: string[];
  transferProgress: number | null;
  handleBookUpload: (book: Book) => void;
  handleBookDownload: (book: Book) => void;
  showBookDetailsModal: (book: Book) => void;
}

const BookItem: React.FC<BookItemProps> = ({
  mode,
  book,
  isSelectMode,
  selectedBooks,
  transferProgress,
  handleBookUpload,
  handleBookDownload,
  showBookDetailsModal,
}) => {
  const iconSize15 = useResponsiveSize(15);
  const { appService } = useEnv();

  const stopEvent = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      className={clsx(
        'book-item flex',
        mode === 'grid' && 'h-full flex-col',
        mode === 'list' && 'h-28 flex-row gap-4 overflow-hidden',
        appService?.hasContextMenu ? 'cursor-pointer' : '',
      )}
    >
      <div
        className={clsx(
          'bg-base-100 relative flex aspect-[28/41] items-center justify-center overflow-hidden shadow-md',
          mode === 'list' && 'min-w-20',
        )}
      >
        <BookCover mode={mode} book={book} />
        {selectedBooks.includes(book.hash) && (
          <div className='absolute inset-0 bg-black opacity-30 transition-opacity duration-300'></div>
        )}
        {isSelectMode && (
          <div className='absolute bottom-1 right-1'>
            {selectedBooks.includes(book.hash) ? (
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
          mode === 'list' && 'py-2',
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
        <div
          className={clsx('flex items-center', book.progress ? 'justify-between' : 'justify-end')}
        >
          {book.progress && <ReadingProgress book={book} />}
          <div className='flex items-center gap-x-1'>
            {transferProgress !== null ? (
              transferProgress === 100 ? null : (
                <div
                  className='radial-progress opacity-0 group-hover:opacity-100'
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
              <button
                className='show-detail-button opacity-0 group-hover:opacity-100'
                onPointerDown={(e) => stopEvent(e)}
                onPointerUp={(e) => stopEvent(e)}
                onPointerMove={(e) => stopEvent(e)}
                onPointerCancel={(e) => stopEvent(e)}
                onPointerLeave={(e) => stopEvent(e)}
                onClick={() => {
                  if (!book.uploadedAt) {
                    handleBookUpload(book);
                  } else if (!book.downloadedAt) {
                    handleBookDownload(book);
                  }
                }}
              >
                {!book.uploadedAt && <LiaCloudUploadAltSolid size={iconSize15} />}
                {book.uploadedAt && !book.downloadedAt && (
                  <LiaCloudDownloadAltSolid size={iconSize15} />
                )}
              </button>
            )}
            <button
              className='show-detail-button opacity-0 group-hover:opacity-100'
              onPointerDown={(e) => stopEvent(e)}
              onPointerUp={(e) => stopEvent(e)}
              onPointerMove={(e) => stopEvent(e)}
              onPointerCancel={(e) => stopEvent(e)}
              onPointerLeave={(e) => stopEvent(e)}
              onClick={() => showBookDetailsModal(book)}
            >
              <CiCircleMore size={iconSize15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BookItem;
