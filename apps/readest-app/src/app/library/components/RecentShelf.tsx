import clsx from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MdChevronLeft, MdChevronRight } from 'react-icons/md';
import { Book } from '@/types/book';
import { LibraryCoverFitType } from '@/types/settings';
import { useTranslation } from '@/hooks/useTranslation';
import { useLongPress } from '@/hooks/useLongPress';
import BookItem from './BookItem';

/**
 * How many recently-read books the top shelf holds. Fixed (no user option) so
 * the row stays a compact quick-resume strip rather than a second library.
 */
export const RECENT_SHELF_BOOK_COUNT = 12;

interface RecentShelfProps {
  books: Book[];
  coverFit: LibraryCoverFitType;
  // Mirror the bookshelf grid's column model so covers are the same size.
  autoColumns: boolean;
  fixedColumns: number;
  onOpenBook: (book: Book) => void;
  handleBookUpload: (book: Book) => void;
  handleBookDownload: (book: Book, options?: { redownload?: boolean; queued?: boolean }) => void;
  showBookDetailsModal: (book: Book) => void;
}

/**
 * Each slide is exactly one bookshelf-grid column wide. The width is the grid's
 * own gap-aware formula — `(100% - (cols - 1) * gap) / cols` — so it matches a
 * CSS-grid column for any column count or gap (flex `basis-1/N` does NOT, since
 * it ignores the row gap). `cols`/`gap` come from CSS vars set on the row.
 * `min-w-0` stops a flex item from growing to its cover image's intrinsic width.
 */
const RECENT_SLIDE_WIDTH =
  'calc((100% - (var(--rs-cols, 6) - 1) * var(--rs-gap, 0px)) / var(--rs-cols, 6))';

type RecentSlideProps = Pick<
  RecentShelfProps,
  'coverFit' | 'onOpenBook' | 'handleBookUpload' | 'handleBookDownload' | 'showBookDetailsModal'
> & { book: Book };

const RecentSlide: React.FC<RecentSlideProps> = ({
  book,
  coverFit,
  onOpenBook,
  handleBookUpload,
  handleBookDownload,
  showBookDetailsModal,
}) => {
  // Pointer-based tap, exactly like the grid (`BookItem` stops click
  // propagation). A swipe-to-scroll moves past useLongPress's moveThreshold and
  // cancels the tap, so horizontal scrolling never opens a book.
  const { pressing, handlers } = useLongPress({ onTap: () => onOpenBook(book) }, [
    book,
    onOpenBook,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpenBook(book);
    }
  };

  return (
    <div className='min-w-0 shrink-0' style={{ flexBasis: RECENT_SLIDE_WIDTH }}>
      {/* Same chassis as the grid item (BookshelfItem grid branch) so the cover,
          title, progress and badges render identically. */}
      <div
        className={clsx(
          'visible-focus-inset-2 group flex h-full cursor-pointer select-none flex-col',
          'sm:hover:bg-base-300/50 px-0 py-2 sm:rounded-md sm:px-4 sm:py-4',
          pressing ? 'not-eink:scale-95' : 'scale-100',
        )}
        role='button'
        tabIndex={0}
        aria-label={book.title}
        style={{ transition: 'transform 0.2s' }}
        onKeyDown={handleKeyDown}
        {...handlers}
      >
        <div className='flex h-full flex-col justify-end'>
          <BookItem
            mode='grid'
            book={book}
            coverFit={coverFit}
            isSelectMode={false}
            bookSelected={false}
            transferProgress={null}
            handleBookUpload={handleBookUpload}
            handleBookDownload={handleBookDownload}
            showBookDetailsModal={showBookDetailsModal}
          />
        </div>
      </div>
    </div>
  );
};

/**
 * Recently-read shelf at the top of the library: a flat, recency-ordered strip
 * of covers, independent of the main shelf's sort/grouping. It scrolls only
 * horizontally and shares the grid's column widths, gap and insets, so each
 * cover lines up with the shelf below and renders identically (reuses
 * `BookItem`) at any column count.
 */
const RecentShelf: React.FC<RecentShelfProps> = ({
  books,
  coverFit,
  autoColumns,
  fixedColumns,
  onOpenBook,
  handleBookUpload,
  handleBookDownload,
  showBookDetailsModal,
}) => {
  const _ = useTranslation();
  // `--rs-cols` mirrors the grid's column count: the responsive ladder
  // (BOOKSHELF_GRID_CLASSES) when auto, or the fixed setting otherwise.
  // `--rs-gap` mirrors the grid's `gap-x-4 sm:gap-x-0` so the width formula
  // subtracts the right gap at each breakpoint.
  const colsClass = autoColumns
    ? '[--rs-cols:3] sm:[--rs-cols:4] md:[--rs-cols:6] xl:[--rs-cols:8] 2xl:[--rs-cols:12]'
    : '';
  const colsStyle = autoColumns
    ? undefined
    : ({ '--rs-cols': fixedColumns } as React.CSSProperties);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);
  // Vertical center of the cover artwork (px from the scroller top). The slide
  // carries a title below the cover, so centering the arrows on the artwork
  // keeps them visually balanced. Null falls back to the row's mid-height.
  const [coverCenter, setCoverCenter] = useState<number | null>(null);

  // Cheap, runs on every scroll: which edges have more content to reveal.
  const updateArrows = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setShowLeft(el.scrollLeft > 1);
    setShowRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  // Heavier: also re-measures the cover center. Runs on mount/resize, not scroll.
  const measure = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    updateArrows();
    const cover = el.querySelector('.bookitem-main');
    if (cover) {
      const rect = cover.getBoundingClientRect();
      setCoverCenter(rect.top - el.getBoundingClientRect().top + rect.height / 2);
    }
  }, [updateArrows]);

  useEffect(() => {
    measure();
    const el = scrollerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, books, autoColumns, fixedColumns, coverFit]);

  const scrollByPage = (direction: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  return (
    <div className='recent-shelf select-none pt-3'>
      <h3 className='text-base-content/60 mb-1 ps-4 text-xs font-medium sm:ps-6'>
        {_('Recently read')}
      </h3>
      <div className='relative'>
        {/* Horizontal-only scroll; px insets + gap mirror the grid. */}
        <div
          ref={scrollerRef}
          onScroll={updateArrows}
          className='no-scrollbar overflow-x-auto overflow-y-hidden overscroll-x-contain px-4 sm:px-2'
        >
          <div
            className={clsx('flex gap-x-4 sm:gap-x-0 [--rs-gap:1rem] sm:[--rs-gap:0px]', colsClass)}
            style={colsStyle}
          >
            {books.map((book) => (
              <RecentSlide
                key={book.hash}
                book={book}
                coverFit={coverFit}
                onOpenBook={onOpenBook}
                handleBookUpload={handleBookUpload}
                handleBookDownload={handleBookDownload}
                showBookDetailsModal={showBookDetailsModal}
              />
            ))}
          </div>
        </div>
        {showLeft && (
          <button
            type='button'
            aria-label={_('Scroll left')}
            onClick={() => scrollByPage(-1)}
            style={{ top: coverCenter ?? '50%' }}
            className='eink-bordered bg-base-100 border-base-content/10 hover:border-base-content/30 absolute start-2 -translate-y-1/2 rounded-full border p-1 shadow-sm transition-colors duration-200'
          >
            <MdChevronLeft
              size={20}
              className='text-base-content/60 hover:text-base-content/80 rtl:rotate-180'
            />
          </button>
        )}
        {showRight && (
          <button
            type='button'
            aria-label={_('Scroll right')}
            onClick={() => scrollByPage(1)}
            style={{ top: coverCenter ?? '50%' }}
            className='eink-bordered bg-base-100 border-base-content/10 hover:border-base-content/30 absolute end-2 -translate-y-1/2 rounded-full border p-1 shadow-sm transition-colors duration-200'
          >
            <MdChevronRight
              size={20}
              className='text-base-content/60 hover:text-base-content/80 rtl:rotate-180'
            />
          </button>
        )}
      </div>
      {/* Modern divider: an inset hairline with breathing room above and below
          so it does not crowd the first shelf row. */}
      <div aria-hidden='true' className='border-base-content/10 mx-4 mb-3 mt-4 border-t sm:mx-6' />
    </div>
  );
};

export default RecentShelf;
