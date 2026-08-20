import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { MdCheckCircle, MdCheckCircleOutline } from 'react-icons/md';
import {
  LiaCloudUploadAltSolid,
  LiaCloudDownloadAltSolid,
  LiaHeadphonesSolid,
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
import { isReadestCloudStorageActive } from '@/services/sync/cloudSyncProvider';
import { isFeedBook } from '@/services/rss/feedBookUrl';
import { isAudiobook } from '@/utils/audiobook';
import { formatAuthors, formatDescription, formatSeries } from '@/utils/book';
import { formatCompactTime } from '@/utils/time';
import { INDETERMINATE_PROGRESS } from '@/utils/transfer';
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
  showTimeRemaining: boolean;
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
  showTimeRemaining,
}) => {
  const _ = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const iconSize15 = useResponsiveSize(15);

  const [coverAspect, setCoverAspect] = useState<number | null>(null);
  useEffect(() => {
    setCoverAspect(null);
  }, [book.hash, book.metadata?.coverImageUrl, book.coverImageUrl]);

  const CELL_ASPECT_RATIO = 28 / 41;
  const fitCoverInGrid = mode === 'grid' && coverFit === 'fit' && coverAspect !== null;
  const shouldShrinkWidth = fitCoverInGrid && coverAspect! < CELL_ASPECT_RATIO;
  const bookitemMainStyle = fitCoverInGrid
    ? {
        aspectRatio: coverAspect!,
        ...(shouldShrinkWidth ? { width: `${(coverAspect! / CELL_ASPECT_RATIO) * 100}%` } : {}),
      }
    : undefined;

  const seriesText = formatSeries(book.metadata?.series, book.metadata?.seriesIndex);

  // One condition drives both the cover overlay and the hiding of the row's
  // transfer buttons, so the cover can never end up showing neither. The
  // entry is removed once the transfer settles, including at 100%.
  const isTransferring = transferProgress !== null;
  const isIndeterminate = transferProgress === INDETERMINATE_PROGRESS;

  // ABS books track progress in seconds, not pages, so the row shows a
  // duration/remaining-time label instead of ReadingProgress's page percent:
  // total length when unplayed, remaining time once started (mirrors the
  // scrubber's "-remaining" convention).
  const isAbsBook = isAudiobook(book);
  const isPodcastShow = book.absMediaType === 'podcast';
  const absDuration = book.duration ?? 0;
  const absCurrentTime = book.progress?.[0] ?? 0;
  const absTimeLabel =
    absCurrentTime > 0
      ? `-${formatCompactTime(Math.max(absDuration - absCurrentTime, 0))}`
      : formatCompactTime(absDuration);
  // A podcast show has no total duration or resume position of its own (those
  // live per-episode, a later task), so the row badges its episode count
  // instead of the duration/remaining-time label audiobooks get.
  const episodeCountLabel = _('{{count}} episodes', { count: book.episodeCount ?? 0 });

  return (
    <div
      role='none'
      className={clsx(
        'book-item flex',
        mode === 'grid' && 'h-full flex-col justify-end',
        mode === 'list' && 'min-h-28 flex-row gap-4 overflow-hidden',
        mode === 'list' ? 'library-list-item' : 'library-grid-item',
        appService?.hasContextMenu ? 'cursor-pointer' : '',
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className={clsx(
          'bookitem-main relative flex justify-center overflow-hidden rounded',
          !fitCoverInGrid && 'aspect-[28/41]',
          coverFit === 'crop' && 'shadow-md',
          mode === 'grid' && 'items-end',
          mode === 'list' && 'min-w-20 items-center',
        )}
        style={bookitemMainStyle}
      >
        <BookCover
          mode={mode}
          book={book}
          coverFit={coverFit}
          showSpine={settings.librarySkeuomorphicCovers}
          imageClassName={clsx(
            'shadow-md',
            settings.librarySkeuomorphicCovers ? 'rounded-none' : 'rounded',
          )}
          onAspectRatioChange={setCoverAspect}
        />
        {isTransferring && (
          // E-ink cannot render a translucent wash — it dithers over the cover
          // art — and has no shadows, so the scrim becomes a solid base-100
          // panel with a 1px base-content border and ink-colored content.
          <div
            className='absolute inset-0 flex items-center justify-center bg-black/40 eink:border eink:border-base-content eink:bg-base-100'
            role='progressbar'
            aria-label={_('Downloading {{title}}', { title: book.title })}
            aria-valuenow={isIndeterminate ? undefined : Math.round(transferProgress)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            {isIndeterminate ? (
              <span className='loading loading-spinner loading-sm text-white eink:text-base-content' />
            ) : (
              <span className='eink:text-base-content text-sm font-semibold text-white not-eink:drop-shadow-sm'>
                {Math.round(transferProgress)}%
              </span>
            )}
          </div>
        )}
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
          mode === 'list' && 'gap-1 py-0',
        )}
      >
        <div className={clsx('min-w-0 flex-1', mode === 'list' && 'flex flex-col gap-1')}>
          <h4
            className={clsx(
              'overflow-hidden text-ellipsis font-semibold',
              mode === 'grid' && 'block whitespace-nowrap text-[0.6em] text-xs',
              mode === 'list' && 'line-clamp-1 text-base',
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
        {mode === 'list' && seriesText && (
          <p className='text-neutral-content line-clamp-1 text-sm'>{seriesText}</p>
        )}
        {mode === 'list' && (
          <h4 className='text-neutral-content line-clamp-1 text-sm'>
            {formatDescription(book.metadata?.description)}
          </h4>
        )}
        <div
          className={clsx(
            'flex items-center',
            book.progress || book.readingStatus || isAbsBook ? 'justify-between' : 'justify-end',
          )}
          style={{
            height: `${iconSize15}px`,
            minHeight: `${iconSize15}px`,
          }}
        >
          {isAbsBook ? (
            <div
              className='text-neutral-content/70 flex min-w-0 justify-between text-xs'
              role='status'
            >
              <span className='truncate tabular-nums'>
                {isPodcastShow ? episodeCountLabel : absTimeLabel}
              </span>
            </div>
          ) : (
            (book.progress || book.readingStatus) && (
              <ReadingProgress book={book} showTimeRemaining={showTimeRemaining} />
            )
          )}
          <div className='flex shrink-0 items-center justify-center gap-x-2'>
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
            {(book.hasNarration || isAbsBook) && (
              <div
                className='pt-[2px] sm:pt-[1px]'
                title={isAbsBook ? _('Audiobook') : _('Includes narration')}
                aria-label={isAbsBook ? _('Audiobook') : _('Includes narration')}
              >
                <LiaHeadphonesSolid size={iconSize15} />
              </div>
            )}
            {isTransferring
              ? // Progress is rendered as a cover overlay; keep the row's action
                // buttons hidden while a transfer is active. Same condition as
                // the overlay, so a book can never show neither.
                null
              : // A feed book has no file to move either way, so it never gets a
                // cloud badge — it would only queue a transfer that fails (#5307).
                // Same for an ABS book: it streams from the server and never has
                // uploadedAt/downloadedAt set, so without this check the badge
                // would render forever and Upload would always fail.
                !isFeedBook(book) &&
                !isAudiobook(book) &&
                (!book.uploadedAt || (book.uploadedAt && !book.downloadedAt)) && (
                  <button
                    aria-label={!book.uploadedAt ? _('Upload Book') : _('Download Book')}
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
                    {!book.uploadedAt && isReadestCloudStorageActive(settings) && (
                      <LiaCloudUploadAltSolid size={iconSize15} />
                    )}
                    {book.uploadedAt && !book.downloadedAt && (
                      <LiaCloudDownloadAltSolid size={iconSize15} />
                    )}
                  </button>
                )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BookItem;
