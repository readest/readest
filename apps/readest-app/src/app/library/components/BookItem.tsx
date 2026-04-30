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
import { useSettingsStore } from '@/store/settingsStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { LibraryCoverFitType, LibraryViewModeType } from '@/types/settings';
import { navigateToLogin } from '@/utils/nav';
import { formatAuthors } from '@/utils/book';
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
  const { settings } = useSettingsStore();
  const iconSize15 = useResponsiveSize(15);
  const authorLabel = formatAuthors(book.author, book.primaryLanguage) || _('Unknown author');
  const totalPages = book.progress?.[1];
  const metadataItems = [
    typeof totalPages === 'number' && totalPages > 0 ? `${totalPages} ${_('pages')}` : null,
    book.format,
  ]
    .filter(Boolean)
    .join(' / ');

  return (
    <div
      role='none'
      className={clsx(
        'book-item relative grid h-full grid-cols-[112px_minmax(0,1fr)] items-stretch rounded-[14px] border border-[rgba(168,119,22,0.24)] bg-[linear-gradient(180deg,rgba(22,18,17,0.94)_0%,rgba(15,13,12,0.92)_100%)] p-3.5 shadow-[0_16px_30px_rgba(0,0,0,0.2)]',
        mode === 'grid' && 'min-h-[178px] gap-4 overflow-hidden sm:grid-cols-[120px_minmax(0,1fr)]',
        mode === 'list' && 'min-h-[178px] gap-4 overflow-hidden sm:grid-cols-[120px_minmax(0,1fr)]',
        mode === 'list' ? 'library-list-item' : 'library-grid-item',
        appService?.hasContextMenu ? 'cursor-pointer' : '',
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className={clsx(
          'bookitem-main relative h-full w-full shrink-0 self-stretch overflow-hidden rounded-[14px] border border-[rgba(168,119,22,0.26)] bg-[#12100f] transition-[transform,box-shadow,border-color] duration-200',
          coverFit === 'crop' && 'shadow-[0_18px_34px_rgba(0,0,0,0.34)]',
          mode === 'grid' &&
            'sm:group-hover:-translate-y-0.5 sm:group-hover:border-[rgba(212,170,92,0.48)]',
          bookSelected && 'border-[var(--citadel-line-gold)] shadow-[var(--citadel-border-glow)]',
        )}
      >
        <BookCover
          mode={mode}
          book={book}
          coverFit={coverFit}
          showSpine={false}
          className='h-full w-full'
          imageClassName='h-full w-full rounded-[10px] object-cover'
        />
        {bookSelected && (
          <div className='absolute inset-0 bg-black opacity-30 transition-opacity duration-300'></div>
        )}
        {isSelectMode && (
          <div className='absolute bottom-1 right-1'>
            {bookSelected ? (
              <MdCheckCircle className='fill-[var(--citadel-gold)]' />
            ) : (
              <MdCheckCircleOutline className='fill-[#8a8883] drop-shadow-sm' />
            )}
          </div>
        )}
      </div>
      <div className='relative flex min-w-0 flex-1 flex-col py-1.5 pr-8'>
        <div className='min-w-0 flex-1'>
          <h4
            className={clsx(
              'overflow-hidden text-ellipsis font-semibold uppercase tracking-[0.1em]',
              mode === 'grid' && 'line-clamp-2 text-[0.97rem] leading-[1.35rem] text-[#ede2d0]',
              mode === 'list' && 'line-clamp-2 text-[0.97rem] leading-[1.35rem] text-[#ede2d0]',
            )}
            style={{ fontFamily: 'Georgia, Palatino, "Palatino Linotype", serif' }}
          >
            {book.title}
          </h4>
          <p className='mt-2 line-clamp-1 text-[0.88rem] text-[#b8892f]'>{authorLabel}</p>
          <p className='mt-3 text-[10px] uppercase tracking-[0.16em] text-[#9a8970]'>
            {metadataItems}
          </p>
        </div>
        <div className='mt-auto flex min-w-0 items-end justify-between gap-3 pt-4'>
          <div className='min-w-0 flex-1'>
            <ReadingProgress book={book} />
          </div>
          <div className='flex shrink-0 items-center justify-center gap-x-2 self-center text-[#9a8460]'>
            {!appService?.isMobile && (
              <button
                aria-label={_('Show Book Details')}
                className='show-detail-button absolute right-0 top-0 rounded-full p-1.5 text-[#8c7248] transition-colors hover:text-[#d4af7a] sm:opacity-70 sm:group-hover:opacity-100'
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  showBookDetailsModal(book);
                }}
              >
                <LiaInfoCircleSolid size={iconSize15} />
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
                  aria-label={!book.uploadedAt ? _('Upload Book') : _('Download Book')}
                  className='show-cloud-button -m-1 p-1 transition-colors hover:text-[#d4af7a]'
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
                  {!book.uploadedAt && settings.autoUpload && (
                    <LiaCloudUploadAltSolid size={iconSize15} />
                  )}
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
