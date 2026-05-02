import clsx from 'clsx';
import { memo } from 'react';

import { Book } from '@/types/book';
import { LibraryCoverFitType, LibraryViewModeType } from '@/types/settings';
import BookCover from './BookCover';

const MISSING_COVER_URL = '/__citadel_missing_cover__.png';
const clampNumber = (value: number, minimum: number) => Math.max(minimum, value);

type BookObjectVariant = 'flat' | 'library' | 'featured';

interface BookObjectProps {
  book: Book;
  mode?: LibraryViewModeType;
  className?: string;
  coverClassName?: string;
  coverFit?: LibraryCoverFitType;
  showSpine?: boolean;
  variant?: BookObjectVariant;
  interactive?: boolean;
  isPreview?: boolean;
  onImageError?: () => void;
}

const VARIANT_SETTINGS: Record<
  BookObjectVariant,
  {
    thickness: number;
    pageInset: number;
    radius: number;
    pageRadius: number;
    shadowBlur: number;
    shadowOpacity: number;
    shadowSpreadX: string;
    shadowHeight: number;
    baseRotateX: number;
    baseRotateY: number;
    hoverRotateX: number;
    hoverRotateY: number;
    hoverLift: number;
    coverShadow: string;
    edgeShadow: string;
  }
> = {
  flat: {
    thickness: 0,
    pageInset: 0,
    radius: 0,
    pageRadius: 0,
    shadowBlur: 0,
    shadowOpacity: 0,
    shadowSpreadX: '0%',
    shadowHeight: 0,
    baseRotateX: 0,
    baseRotateY: 0,
    hoverRotateX: 0,
    hoverRotateY: 0,
    hoverLift: 0,
    coverShadow: 'none',
    edgeShadow: 'none',
  },
  library: {
    thickness: 6,
    pageInset: 2,
    radius: 12,
    pageRadius: 10,
    shadowBlur: 18,
    shadowOpacity: 0.22,
    shadowSpreadX: '9%',
    shadowHeight: 13,
    baseRotateX: 0,
    baseRotateY: -1.2,
    hoverRotateX: 0.6,
    hoverRotateY: -3,
    hoverLift: 4,
    coverShadow:
      '0 10px 18px rgba(0, 0, 0, 0.18), 0 3px 6px rgba(0, 0, 0, 0.1), inset -1px 0 0 rgba(0, 0, 0, 0.08)',
    edgeShadow:
      'inset 1px 0 0 rgba(255, 249, 235, 0.7), inset -1px 0 0 rgba(120, 105, 88, 0.24), 2px 0 4px rgba(0, 0, 0, 0.08)',
  },
  featured: {
    thickness: 11,
    pageInset: 3,
    radius: 14,
    pageRadius: 12,
    shadowBlur: 28,
    shadowOpacity: 0.34,
    shadowSpreadX: '12%',
    shadowHeight: 18,
    baseRotateX: 0.4,
    baseRotateY: -2.2,
    hoverRotateX: 1.1,
    hoverRotateY: -6,
    hoverLift: 8,
    coverShadow:
      '0 18px 34px rgba(0, 0, 0, 0.28), 0 6px 14px rgba(0, 0, 0, 0.16), inset -1px 0 0 rgba(0, 0, 0, 0.1)',
    edgeShadow:
      'inset 1px 0 0 rgba(255, 248, 232, 0.82), inset -1px 0 0 rgba(103, 88, 70, 0.28), 4px 0 8px rgba(0, 0, 0, 0.12)',
  },
};

const BookObject: React.FC<BookObjectProps> = memo(
  ({
    book,
    mode = 'grid',
    className,
    coverClassName,
    coverFit = 'crop',
    showSpine = false,
    variant = 'library',
    interactive = false,
    isPreview = false,
    onImageError,
  }) => {
    const baseSettings = VARIANT_SETTINGS[variant];
    const isListMode = mode === 'list';
    const settings =
      variant === 'library'
        ? {
            ...baseSettings,
            thickness: isListMode ? 3 : 5,
            pageInset: isListMode ? 1 : 2,
            radius: isListMode ? 10 : 12,
            pageRadius: isListMode ? 8 : 10,
            shadowBlur: isListMode ? 10 : 15,
            shadowOpacity: isListMode ? 0.12 : 0.17,
            shadowSpreadX: isListMode ? '13%' : '10%',
            shadowHeight: isListMode ? 8 : 11,
            baseRotateX: 0,
            baseRotateY: isListMode ? -0.2 : -0.65,
            hoverRotateX: isListMode ? 0.15 : 0.5,
            hoverRotateY: isListMode ? -0.5 : -2.2,
            hoverLift: isListMode ? 1 : 2,
            coverShadow: isListMode
              ? '0 5px 10px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.05)'
              : '0 8px 16px rgba(0, 0, 0, 0.16), 0 3px 6px rgba(0, 0, 0, 0.07)',
            edgeShadow: isListMode
              ? 'inset 1px 0 0 rgba(102, 78, 52, 0.18), inset -1px 0 0 rgba(32, 24, 18, 0.22), 1px 0 2px rgba(0, 0, 0, 0.05)'
              : 'inset 1px 0 0 rgba(108, 82, 54, 0.22), inset -1px 0 0 rgba(34, 26, 19, 0.26), 1px 0 3px rgba(0, 0, 0, 0.06)',
          }
        : baseSettings;
    const hasCoverImage = Boolean(book.metadata?.coverImageUrl || book.coverImageUrl);
    const safeBook = hasCoverImage
      ? book
      : {
          ...book,
          coverImageUrl: MISSING_COVER_URL,
        };

    return (
      <div
        className={clsx(
          'book-object-root relative isolate block h-full w-full',
          variant === 'flat' && 'book-object-flat',
          interactive && variant !== 'flat' && 'book-object-interactive',
          className,
        )}
      >
        {variant !== 'flat' && (
          <div aria-hidden='true' className='book-object-shadow pointer-events-none absolute z-0' />
        )}

        <div className='book-object-shape relative z-[1] h-full w-full'>
          {variant !== 'flat' && (
            <div
              aria-hidden='true'
              className='book-object-page-block pointer-events-none absolute bottom-0 top-0 z-0'
            />
          )}

          <div className='book-object-cover-shell absolute inset-0 z-10 overflow-hidden'>
            <BookCover
              book={safeBook}
              mode={mode}
              coverFit={coverFit}
              showSpine={showSpine}
              isPreview={isPreview}
              onImageError={onImageError}
              className='h-full w-full'
              imageClassName={coverClassName}
            />
            {variant !== 'flat' && (
              <>
                <div
                  aria-hidden='true'
                  className='book-object-spine-shade pointer-events-none absolute inset-y-0 left-0 z-[11]'
                />
                <div
                  aria-hidden='true'
                  className='book-object-vignette pointer-events-none absolute inset-0 z-[11]'
                />
              </>
            )}
          </div>

          {variant !== 'flat' && (
            <div
              aria-hidden='true'
              className='book-object-page-highlight pointer-events-none absolute bottom-0 top-0 z-[1]'
            />
          )}
        </div>

        <style jsx>{`
          .book-object-root {
            overflow: visible;
          }

          .book-object-shadow {
            left: ${settings.shadowSpreadX};
            right: ${settings.shadowSpreadX};
            bottom: ${variant === 'featured' ? '-1.5%' : '0'};
            height: ${settings.shadowHeight}px;
            border-radius: 9999px;
            background: radial-gradient(
              ellipse at center,
              rgba(0, 0, 0, ${settings.shadowOpacity}) 0%,
              rgba(0, 0, 0, ${settings.shadowOpacity * 0.64}) 34%,
              rgba(0, 0, 0, 0.06) 72%,
              transparent 100%
            );
            filter: blur(${settings.shadowBlur}px);
            transform: translateZ(0);
            transition:
              opacity 220ms ease,
              transform 280ms cubic-bezier(0.22, 1, 0.36, 1);
          }

          .book-object-shape {
            transform: perspective(1440px) rotateX(${settings.baseRotateX}deg)
              rotateY(${settings.baseRotateY}deg) translateY(0);
            transform-origin: 46% 58%;
            transform-style: preserve-3d;
            transition:
              transform 280ms cubic-bezier(0.22, 1, 0.36, 1),
              filter 220ms ease;
            will-change: transform;
            backface-visibility: hidden;
            -webkit-backface-visibility: hidden;
          }

          .book-object-interactive:hover .book-object-shape,
          .book-object-interactive:focus-within .book-object-shape {
            transform: perspective(1440px) rotateX(${settings.hoverRotateX}deg)
              rotateY(${settings.hoverRotateY}deg);
          }

          .book-object-interactive:hover .book-object-shadow,
          .book-object-interactive:focus-within .book-object-shadow {
            opacity: ${Math.min(0.42, settings.shadowOpacity + 0.06)};
            transform: translateY(${clampNumber(Math.round(settings.hoverLift * 0.5), 1)}px)
              scaleX(1.02);
          }

          .book-object-cover-shell {
            border-radius: ${settings.radius}px;
            box-shadow: ${settings.coverShadow};
            background: rgba(0, 0, 0, 0.02);
            transform: translateZ(1px);
          }

          .book-object-page-block {
            top: ${settings.pageInset}px;
            bottom: ${settings.pageInset}px;
            right: -${clampNumber(Math.round(settings.thickness * 0.55), 2)}px;
            width: ${settings.thickness}px;
            border-radius: 0 ${settings.pageRadius}px ${settings.pageRadius}px 0;
            background:
              linear-gradient(
                180deg,
                rgba(88, 67, 45, ${variant === 'featured' ? 0.44 : isListMode ? 0.24 : 0.3}) 0%,
                rgba(66, 49, 35, ${variant === 'featured' ? 0.5 : isListMode ? 0.3 : 0.36}) 52%,
                rgba(36, 27, 20, ${variant === 'featured' ? 0.62 : isListMode ? 0.42 : 0.48}) 100%
              ),
              linear-gradient(
                90deg,
                rgba(104, 80, 53, ${variant === 'featured' ? 0.12 : isListMode ? 0.05 : 0.08}) 0%,
                rgba(58, 43, 31, ${variant === 'featured' ? 0.16 : isListMode ? 0.08 : 0.11}) 48%,
                rgba(24, 18, 14, ${variant === 'featured' ? 0.28 : isListMode ? 0.18 : 0.22}) 100%
              );
            box-shadow: ${settings.edgeShadow};
            overflow: hidden;
            transform: translateZ(0);
          }

          .book-object-page-block::before {
            content: '';
            position: absolute;
            inset: 3% auto 3% 0;
            width: 1px;
            background: linear-gradient(
              180deg,
              rgba(34, 26, 20, 0.08),
              rgba(34, 26, 20, 0.18),
              rgba(12, 10, 9, 0.08)
            );
          }

          .book-object-spine-shade {
            width: ${variant === 'featured' ? '15%' : isListMode ? '9%' : '11%'};
            background: linear-gradient(
              90deg,
              rgba(0, 0, 0, ${variant === 'featured' ? 0.28 : isListMode ? 0.14 : 0.18}) 0%,
              rgba(0, 0, 0, ${variant === 'featured' ? 0.1 : isListMode ? 0.04 : 0.07}) 46%,
              transparent 100%
            );
          }

          .book-object-vignette {
            background:
              linear-gradient(
                180deg,
                rgba(255, 255, 255, ${variant === 'featured' ? 0.04 : isListMode ? 0.02 : 0.03}) 0%,
                rgba(255, 255, 255, 0) 14%,
                rgba(0, 0, 0, 0) 72%,
                rgba(0, 0, 0, ${variant === 'featured' ? 0.14 : isListMode ? 0.07 : 0.09}) 100%
              ),
              linear-gradient(
                90deg,
                rgba(255, 255, 255, 0.02) 0%,
                rgba(255, 255, 255, 0) 18%,
                rgba(0, 0, 0, 0) 78%,
                rgba(0, 0, 0, ${variant === 'featured' ? 0.08 : isListMode ? 0.03 : 0.045}) 100%
              );
            mix-blend-mode: multiply;
          }

          .book-object-page-highlight {
            right: 0;
            width: 1px;
            background: linear-gradient(
              180deg,
              rgba(120, 92, 58, ${variant === 'featured' ? 0.16 : isListMode ? 0.05 : 0.08}) 0%,
              rgba(92, 70, 45, ${variant === 'featured' ? 0.1 : isListMode ? 0.03 : 0.05}) 48%,
              rgba(64, 48, 34, 0.02) 100%
            );
          }

          .book-object-flat .book-object-shape,
          .book-object-flat .book-object-cover-shell {
            transform: none;
            box-shadow: none;
            border-radius: 0;
          }

          .book-object-flat .book-object-cover-shell {
            inset: 0;
          }
        `}</style>
      </div>
    );
  },
  (prevProps, nextProps) =>
    prevProps.book.coverImageUrl === nextProps.book.coverImageUrl &&
    prevProps.book.metadata?.coverImageUrl === nextProps.book.metadata?.coverImageUrl &&
    prevProps.book.updatedAt === nextProps.book.updatedAt &&
    prevProps.mode === nextProps.mode &&
    prevProps.className === nextProps.className &&
    prevProps.coverClassName === nextProps.coverClassName &&
    prevProps.coverFit === nextProps.coverFit &&
    prevProps.showSpine === nextProps.showSpine &&
    prevProps.variant === nextProps.variant &&
    prevProps.interactive === nextProps.interactive &&
    prevProps.isPreview === nextProps.isPreview &&
    prevProps.onImageError === nextProps.onImageError,
);

BookObject.displayName = 'BookObject';

export type { BookObjectProps, BookObjectVariant };
export default BookObject;
