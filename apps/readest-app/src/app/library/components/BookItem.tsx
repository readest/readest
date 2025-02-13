import clsx from 'clsx';
import { MdCheckCircle, MdCheckCircleOutline } from 'react-icons/md';
import { CiCircleMore } from 'react-icons/ci';
import { LiaCloudUploadAltSolid, LiaCloudDownloadAltSolid } from 'react-icons/lia';

import { Book } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import ReadingProgress from './ReadingProgress';
import BookCover from './BookCover';

interface BookItemProps {
  book: Book;
  isSelectMode: boolean;
  selectedBooks: string[];
  transferProgress: number | null;
  handleBookUpload: (book: Book) => void;
  handleBookDownload: (book: Book) => void;
  showBookDetailsModal: (book: Book) => void;
  bookContextMenuHandler: (book: Book, e: React.MouseEvent<HTMLDivElement>) => void;
}

const BookItem: React.FC<BookItemProps> = ({
  book,
  isSelectMode,
  selectedBooks,
  transferProgress,
  handleBookUpload,
  handleBookDownload,
  showBookDetailsModal,
  bookContextMenuHandler,
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
        'book-item flex h-full flex-col',
        appService?.hasContextMenu ? 'cursor-pointer' : '',
      )}
      onContextMenu={bookContextMenuHandler.bind(null, book)}
    >
      <div className='bg-base-100 relative aspect-[28/41] shadow-md'>
        <BookCover book={book} />
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
      <div className={clsx('flex w-full flex-col p-0 pt-2')}>
        <div className='min-w-0 flex-1'>
          <h4 className='block overflow-hidden text-ellipsis whitespace-nowrap text-[0.6em] text-xs font-semibold'>
            {book.title}
          </h4>
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
                onTouchStart={(e) => stopEvent(e)}
                onMouseDown={(e) => stopEvent(e)}
                onTouchEnd={(e) => stopEvent(e)}
                onMouseUp={(e) => stopEvent(e)}
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
              onTouchStart={(e) => stopEvent(e)}
              onMouseDown={(e) => stopEvent(e)}
              onTouchEnd={(e) => stopEvent(e)}
              onMouseUp={(e) => stopEvent(e)}
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
