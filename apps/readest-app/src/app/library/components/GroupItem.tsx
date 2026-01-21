import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { MdCheckCircle, MdCheckCircleOutline, MdChevronRight, MdChevronLeft } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { BooksGroup } from '@/types/book';
import { LibraryViewModeType } from '@/types/settings';
import BookCover from '@/components/BookCover';

interface GroupItemProps {
  mode: LibraryViewModeType;
  group: BooksGroup;
  isSelectMode: boolean;
  groupSelected: boolean;
}

const GroupItem: React.FC<GroupItemProps> = ({ mode, group, isSelectMode, groupSelected }) => {
  const { appService } = useEnv();
  const iconSize15 = useResponsiveSize(15);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);

  const checkScrollArrows = () => {
    if (mode === 'list' && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const hasOverflow = container.scrollWidth > container.clientWidth;

      if (hasOverflow) {
        const isAtStart = container.scrollLeft <= 5;
        const isAtEnd = container.scrollLeft >= container.scrollWidth - container.clientWidth - 5;
        setShowLeftArrow(!isAtStart);
        setShowRightArrow(!isAtEnd);
      } else {
        setShowLeftArrow(false);
        setShowRightArrow(false);
      }
    } else {
      setShowLeftArrow(false);
      setShowRightArrow(false);
    }
  };

  useEffect(() => {
    checkScrollArrows();
    if (mode === 'list' && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      setTimeout(() => {
        container.style.transform = 'translateZ(0)';
        container.scrollLeft = 0;
      }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, group.books.length, scrollContainerRef.current]);

  const handleScroll = () => {
    checkScrollArrows();
  };

  const scrollLeft = () => {
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const scrollAmount = container.clientWidth * 0.5;
      const currentScroll = container.scrollLeft;
      const targetScroll = Math.max(0, currentScroll - scrollAmount);
      container.scrollTo({ left: targetScroll, behavior: 'smooth' });
    }
  };

  const scrollRight = () => {
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const scrollAmount = container.clientWidth * 0.5;
      const currentScroll = container.scrollLeft;
      const maxScroll = container.scrollWidth - container.clientWidth;
      const targetScroll = Math.min(maxScroll, currentScroll + scrollAmount);
      container.scrollTo({ left: targetScroll, behavior: 'smooth' });
    }
  };

  const stopEvent = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleLeftArrowClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    scrollLeft();
  };

  const handleRightArrowClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    scrollRight();
  };

  return (
    <div className={clsx('group-item', appService?.hasContextMenu ? 'cursor-pointer' : '')}>
      <div
        className={clsx(
          'groupitem-main relative flex overflow-hidden rounded',
          mode === 'grid' && 'bg-base-100 aspect-[28/41] items-center justify-center shadow-md',
          mode === 'list' && 'items-center justify-start gap-4 py-2',
        )}
      >
        <div
          className={clsx(
            mode === 'grid' && 'flex h-full w-full p-2',
            mode === 'list' && 'relative min-w-0 max-w-[85%]',
          )}
        >
          <div
            ref={mode === 'list' ? scrollContainerRef : undefined}
            className={clsx(
              mode === 'grid' && 'grid w-full grid-cols-2 grid-rows-2 gap-1 overflow-hidden',
              mode === 'list' && 'flex h-28 gap-2 overflow-x-auto overflow-y-hidden',
              mode === 'list' ? 'library-list-item' : 'library-grid-item',
            )}
            style={
              mode === 'list'
                ? {
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                    WebkitOverflowScrolling: 'touch',
                    transform: 'translateZ(0)',
                    willChange: 'scroll-position',
                  }
                : undefined
            }
            onScroll={mode === 'list' ? handleScroll : undefined}
          >
            {group.books.slice(0, mode === 'grid' ? 4 : undefined).map((book) => (
              <div
                key={book.hash}
                className={clsx(
                  'relative aspect-[28/41] h-full',
                  mode === 'grid' && 'w-full',
                  mode === 'list' && 'flex-shrink-0',
                )}
              >
                <BookCover book={book} isPreview imageClassName='rounded-[2px]' />
              </div>
            ))}
          </div>
          {mode === 'list' && showLeftArrow && (
            <div className='absolute left-[-0.5px] top-0 h-full w-12'>
              <div className='from-base-200/85 via-base-200/20 absolute inset-0 bg-gradient-to-r to-transparent'></div>
              <button
                onClick={handleLeftArrowClick}
                onPointerDown={(e) => stopEvent(e)}
                onPointerUp={(e) => stopEvent(e)}
                onPointerMove={(e) => stopEvent(e)}
                onPointerCancel={(e) => stopEvent(e)}
                onPointerLeave={(e) => stopEvent(e)}
                className='absolute left-2 top-1/2 -translate-y-1/2 transition-all duration-200 hover:scale-110'
              >
                <div className='bg-base-100 border-base-content/10 hover:border-base-content/30 rounded-full border p-1 shadow-sm transition-colors duration-200'>
                  <MdChevronLeft
                    size={16}
                    className='text-base-content/50 hover:text-base-content/70'
                  />
                </div>
              </button>
            </div>
          )}
          {mode === 'list' && showRightArrow && (
            <div className='absolute right-[-0.5px] top-0 h-full w-12'>
              <div className='from-base-200/85 via-base-200/20 absolute inset-0 bg-gradient-to-l to-transparent'></div>
              <button
                onClick={handleRightArrowClick}
                onPointerDown={(e) => stopEvent(e)}
                onPointerUp={(e) => stopEvent(e)}
                onPointerMove={(e) => stopEvent(e)}
                onPointerCancel={(e) => stopEvent(e)}
                onPointerLeave={(e) => stopEvent(e)}
                className='absolute right-2 top-1/2 -translate-y-1/2 transition-all duration-200 hover:scale-110'
              >
                <div className='bg-base-100 border-base-content/10 hover:border-base-content/30 rounded-full border p-1 shadow-sm transition-colors duration-200'>
                  <MdChevronRight
                    size={16}
                    className='text-base-content/50 hover:text-base-content/70'
                  />
                </div>
              </button>
            </div>
          )}
        </div>
        {mode === 'list' && (
          <div className='text-base-content/75 w-28 min-w-24 max-w-40 overflow-hidden text-ellipsis text-base font-semibold'>
            {group.displayName}
          </div>
        )}
        {groupSelected && (
          <div className='absolute inset-0 bg-black opacity-30 transition-opacity duration-300'></div>
        )}
        {isSelectMode && (
          <div className='absolute bottom-1 right-1'>
            {groupSelected ? (
              <MdCheckCircle className='fill-blue-500' />
            ) : (
              <MdCheckCircleOutline className='fill-gray-300 drop-shadow-sm' />
            )}
          </div>
        )}
      </div>
      {mode === 'grid' && (
        <div className={clsx('flex w-full flex-col pt-2')}>
          <div className='min-w-0 flex-1'>
            <h4 className='block overflow-hidden text-ellipsis whitespace-nowrap text-xs font-semibold'>
              {group.displayName}
            </h4>
          </div>
          <div className='placeholder' style={{ height: `${iconSize15}px` }}></div>
        </div>
      )}
    </div>
  );
};

export default GroupItem;
