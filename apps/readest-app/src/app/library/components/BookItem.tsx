import clsx from 'clsx';
import Image from 'next/image';
import { MdCheckCircle, MdCheckCircleOutline } from 'react-icons/md';
import { CiCircleMore } from 'react-icons/ci';
import { LiaCloudUploadAltSolid, LiaCloudDownloadAltSolid } from 'react-icons/lia';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { isWebAppPlatform } from '@/services/environment';
import ReadingProgress from './ReadingProgress';
import { Book } from '@/types/book';

interface BookItemProps {
  book: Book;
  isSelectMode: boolean;
  selectedBooks: string[];
  clickedBookHash: string | null;
  handleBookClick: (book: Book) => void;
  handleBookUpload: (book: Book) => void;
  handleBookDownload: (book: Book) => void;
  showBookDetailsModal: (book: Book) => void;
  bookContextMenuHandler: (book: Book, e: React.MouseEvent<HTMLDivElement>) => void;
}

const BookItem: React.FC<BookItemProps> = ({
  book,
  isSelectMode,
  selectedBooks,
  clickedBookHash,
  handleBookClick,
  handleBookUpload,
  handleBookDownload,
  showBookDetailsModal,
  bookContextMenuHandler,
}) => {
  const iconSize15 = useResponsiveSize(15);

  return (
    <div
      className='book-item cursor-pointer'
      onContextMenu={bookContextMenuHandler.bind(null, book)}
    >
      <div className='bg-base-100 shadow-md' onClick={() => handleBookClick(book)}>
        <div className='relative aspect-[28/41]'>
          <Image
            src={book.coverImageUrl!}
            alt={book.title}
            fill={true}
            className='object-cover'
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
              (e.target as HTMLImageElement).nextElementSibling?.classList.remove('invisible');
            }}
          />
          <div
            className={clsx(
              'invisible absolute inset-0 flex items-center justify-center p-1',
              'text-neutral-content rounded-none text-center font-serif text-base font-medium',
              'line-clamp-3',
            )}
          >
            {book.title}
          </div>
          {(selectedBooks.includes(book.hash) || clickedBookHash === book.hash) && (
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
      </div>
      <div
        className={clsx(
          'flex w-full p-0 pt-2',
          isWebAppPlatform() ? 'flex-col' : 'flex-row justify-between',
        )}
      >
        <div className='min-w-0 flex-1'>
          <h4 className='block overflow-hidden text-ellipsis whitespace-nowrap text-[0.6em] text-xs font-semibold'>
            {book.title}
          </h4>
        </div>
        <div
          className={clsx('flex items-center', book.progress ? 'justify-between' : 'justify-end')}
        >
          {book.progress && <ReadingProgress book={book} />}
          {isWebAppPlatform() && (
            <div className='flex items-center gap-x-1'>
              <button
                className='show-detail-button opacity-0 group-hover:opacity-100'
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
              <button
                className='show-detail-button opacity-0 group-hover:opacity-100'
                onClick={() => showBookDetailsModal(book)}
              >
                <CiCircleMore size={iconSize15} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BookItem;
