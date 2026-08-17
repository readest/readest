import clsx from 'clsx';
import Image from 'next/image';
import { memo, useEffect, useRef, useState } from 'react';
import { Book } from '@/types/book';
import { LibraryCoverFitType, LibraryViewModeType } from '@/types/settings';
import { formatAuthors, formatTitle } from '@/utils/book';
import { getInitializedAppService } from '@/services/environment';
import { observeCoverForThumbnail } from '@/services/coverThumbnailService';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';

interface BookCoverProps {
  book: Book;
  mode?: LibraryViewModeType;
  coverFit?: LibraryCoverFitType;
  className?: string;
  imageClassName?: string;
  showSpine?: boolean;
  isPreview?: boolean;
  onImageError?: () => void;
  onAspectRatioChange?: (ratio: number) => void;
}

const BookCover: React.FC<BookCoverProps> = memo<BookCoverProps>(
  ({
    book,
    mode = 'grid',
    coverFit = 'crop',
    showSpine = false,
    className,
    imageClassName,
    isPreview,
    onImageError,
    onAspectRatioChange,
  }) => {
    const coverRef = useRef<HTMLDivElement>(null);
    const bookRef = useRef(book);
    bookRef.current = book;
    const [imageLoaded, setImageLoaded] = useState(false);
    const [imageError, setImageError] = useState(false);
    const [failedThumbnailUrl, setFailedThumbnailUrl] = useState<string | null>(null);
    const thumbnail = useLibraryStore((state) => state.coverThumbnails.get(book.hash));
    const matchingThumbnail =
      thumbnail?.coverHash === (book.coverHash ?? null) ? thumbnail.url : null;
    const usableThumbnail = matchingThumbnail === failedThumbnailUrl ? null : matchingThumbnail;
    const metadataCoverImageUrl = book.metadata?.coverImageUrl || null;
    const coverImageUrl = metadataCoverImageUrl || usableThumbnail || book.coverImageUrl || null;
    const hideCovers = useSettingsStore((state) => state.settings.libraryHideCovers);
    const displayCoverUrl = hideCovers ? null : coverImageUrl;

    const shouldShowSpine = showSpine && !hideCovers && imageLoaded && !imageError;

    const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
      setImageLoaded(true);
      setImageError(false);
      const img = e.currentTarget;
      if (onAspectRatioChange && img.naturalWidth > 0 && img.naturalHeight > 0) {
        onAspectRatioChange(img.naturalWidth / img.naturalHeight);
      }
    };

    const handleImageError = () => {
      if (usableThumbnail && book.coverImageUrl) {
        setFailedThumbnailUrl(usableThumbnail);
        setImageLoaded(false);
        setImageError(false);
        return;
      }
      setImageLoaded(false);
      setImageError(true);
      onImageError?.();
    };

    useEffect(() => {
      setImageLoaded(false);
      setImageError(false);
    }, [coverImageUrl]);

    useEffect(() => {
      setFailedThumbnailUrl(null);
    }, [book.hash, book.coverHash]);

    useEffect(() => {
      const element = coverRef.current;
      const appService = getInitializedAppService();
      if (
        !element ||
        hideCovers ||
        !book.coverImageUrl ||
        metadataCoverImageUrl ||
        matchingThumbnail ||
        !appService?.supportsCoverThumbnailOptimization
      ) {
        return;
      }
      return observeCoverForThumbnail(element, () =>
        appService.requestCoverThumbnail(bookRef.current),
      );
    }, [
      book.hash,
      book.coverHash,
      book.coverImageUrl,
      book.deletedAt,
      matchingThumbnail,
      metadataCoverImageUrl,
      hideCovers,
    ]);

    return (
      <div
        ref={coverRef}
        className={clsx('book-cover-container relative flex h-full w-full', className)}
      >
        {coverFit === 'crop' ? (
          <>
            {displayCoverUrl && (
              <Image
                src={displayCoverUrl}
                alt={book.title}
                fill={true}
                loading='lazy'
                draggable={false}
                className={clsx(
                  'cover-image crop-cover-img object-cover',
                  imageError && 'invisible',
                  imageClassName,
                )}
                onLoad={handleImageLoad}
                onError={handleImageError}
              />
            )}
            <div
              className={`book-spine absolute inset-0 ${shouldShowSpine ? 'visible' : 'invisible'}`}
            />
          </>
        ) : (
          <div className={clsx('flex h-full w-full justify-start')}>
            <div
              className={clsx(
                'flex h-full max-h-full items-end',
                mode === 'grid' ? 'items-end' : 'items-center',
              )}
            >
              {displayCoverUrl && (
                <Image
                  src={displayCoverUrl}
                  alt={book.title}
                  width={0}
                  height={0}
                  sizes='100vw'
                  loading='lazy'
                  draggable={false}
                  className={clsx(
                    'cover-image fit-cover-img h-auto max-h-full w-auto max-w-full shadow-md',
                    imageError && 'invisible',
                    imageClassName,
                  )}
                  onLoad={handleImageLoad}
                  onError={handleImageError}
                />
              )}
              <div
                className={`book-spine absolute inset-0 ${shouldShowSpine ? 'visible' : 'invisible'}`}
              />
            </div>
          </div>
        )}

        <div
          className={clsx(
            'fallback-cover absolute inset-0 p-2',
            displayCoverUrl && !imageError && 'invisible',
            'text-neutral-content text-center font-serif font-medium',
            isPreview ? 'bg-base-200/50' : 'bg-base-100',
            imageClassName,
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
              {formatAuthors(book.author || book.metadata?.author || '')}
            </span>
          </div>
        </div>
      </div>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.book.hash === nextProps.book.hash &&
      prevProps.book.coverHash === nextProps.book.coverHash &&
      prevProps.book.deletedAt === nextProps.book.deletedAt &&
      prevProps.book.coverImageUrl === nextProps.book.coverImageUrl &&
      prevProps.book.metadata?.coverImageUrl === nextProps.book.metadata?.coverImageUrl &&
      prevProps.book.updatedAt === nextProps.book.updatedAt &&
      prevProps.mode === nextProps.mode &&
      prevProps.coverFit === nextProps.coverFit &&
      prevProps.isPreview === nextProps.isPreview &&
      prevProps.showSpine === nextProps.showSpine &&
      prevProps.className === nextProps.className &&
      prevProps.imageClassName === nextProps.imageClassName
    );
  },
);

BookCover.displayName = 'BookCover';

export default BookCover;
