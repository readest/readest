'use client';

import { useRef, useState } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { MdChevronLeft, MdChevronRight } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';

interface GroupCarouselProps {
  count: number;
  itemContent: (index: number) => React.ReactNode;
  // Initial row height (px) so the list renders before the real item height is
  // measured, avoiding a layout flash.
  defaultRowHeight: number;
  // Center the scroll arrows on the cover image rather than the whole card.
  coverCentered?: boolean;
}

export function GroupCarousel({
  count,
  itemContent,
  defaultRowHeight,
  coverCentered = false,
}: GroupCarouselProps) {
  const _ = useTranslation();
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const rangeRef = useRef({ startIndex: 0, endIndex: 0 });
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);
  const [rowHeight, setRowHeight] = useState(defaultRowHeight);
  // Vertical center of the cover (px from the carousel top). Cards carry a
  // title/author below the cover, so centering on the artwork keeps the arrows
  // visually balanced. Null falls back to centering on the whole row.
  const [coverCenter, setCoverCenter] = useState<number | null>(null);

  const measure = () => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const item = scroller.querySelector('[data-carousel-item]');
    if (item) {
      setRowHeight(item.getBoundingClientRect().height);
    }
    if (coverCentered) {
      const cover = scroller.querySelector('figure');
      if (cover) {
        const top = scroller.getBoundingClientRect().top;
        const rect = cover.getBoundingClientRect();
        setCoverCenter(rect.top - top + rect.height / 2);
      }
    }
  };

  // Page through the carousel by index rather than pixels: Virtuoso sizes the
  // horizontal track lazily, so a pixel `scrollBy` clamps to the rendered width.
  // Aligning the current edge item to the opposite side advances ~one page.
  const scrollByPage = (direction: -1 | 1) => {
    const { startIndex, endIndex } = rangeRef.current;
    if (direction === 1) {
      virtuosoRef.current?.scrollToIndex({
        index: Math.min(count - 1, endIndex),
        align: 'start',
        behavior: 'smooth',
      });
    } else {
      virtuosoRef.current?.scrollToIndex({
        index: Math.max(0, startIndex),
        align: 'end',
        behavior: 'smooth',
      });
    }
  };

  return (
    <div className='relative' data-testid='group-carousel'>
      <Virtuoso
        ref={virtuosoRef}
        horizontalDirection
        totalCount={count}
        itemContent={itemContent}
        increaseViewportBy={200}
        className='no-scrollbar px-4 pb-2'
        style={{ height: rowHeight }}
        scrollerRef={(ref) => {
          scrollerRef.current = ref as HTMLElement;
        }}
        rangeChanged={(range) => {
          rangeRef.current = range;
        }}
        atTopStateChange={(atStart) => setShowLeftArrow(!atStart)}
        atBottomStateChange={(atEnd) => setShowRightArrow(!atEnd)}
        totalListHeightChanged={measure}
      />
      {showLeftArrow && (
        <button
          aria-label={_('Scroll left')}
          onClick={() => scrollByPage(-1)}
          style={{ top: coverCenter ?? '50%' }}
          className='eink-bordered bg-base-100 border-base-content/10 hover:border-base-content/30 absolute left-2 -translate-y-1/2 rounded-full border p-1 shadow-sm transition-colors duration-200'
        >
          <MdChevronLeft size={20} className='text-base-content/60 hover:text-base-content/80' />
        </button>
      )}
      {showRightArrow && (
        <button
          aria-label={_('Scroll right')}
          onClick={() => scrollByPage(1)}
          style={{ top: coverCenter ?? '50%' }}
          className='eink-bordered bg-base-100 border-base-content/10 hover:border-base-content/30 absolute right-2 -translate-y-1/2 rounded-full border p-1 shadow-sm transition-colors duration-200'
        >
          <MdChevronRight size={20} className='text-base-content/60 hover:text-base-content/80' />
        </button>
      )}
    </div>
  );
}
