import { useEffect, useMemo, useRef } from 'react';
import { BookProgress } from '@/types/book';
import { isCfiInLocation } from '@/utils/cfi';

const useScrollToItem = (
  cfi: string,
  progress: BookProgress | null,
  isNearest: boolean = false,
) => {
  const viewRef = useRef<HTMLLIElement | null>(null);

  const isCurrent = useMemo(() => isCfiInLocation(cfi, progress?.location), [cfi, progress]);
  const shouldScroll = isCurrent || isNearest;

  useEffect(() => {
    if (!viewRef.current || !shouldScroll) return;

    const element = viewRef.current;
    const rect = element.getBoundingClientRect();

    // Find the actual scrollable container (OverlayScrollbars viewport)
    const scrollContainer = element.closest('[data-overlayscrollbars-viewport]');
    const containerRect = scrollContainer?.getBoundingClientRect();

    const isVisible = containerRect
      ? rect.top >= containerRect.top && rect.bottom <= containerRect.bottom
      : rect.top >= 0 && rect.bottom <= window.innerHeight;

    if (!isVisible) {
      const isEink = document.documentElement.getAttribute('data-eink') === 'true';

      const containerCenter = containerRect
        ? (containerRect.top + containerRect.bottom) / 2
        : window.innerHeight / 2;
      const distance = Math.abs(rect.top - containerCenter);
      const SMOOTH_THRESHOLD = 1000;
      const behavior = isEink || distance > SMOOTH_THRESHOLD ? 'auto' : 'smooth';

      element.scrollIntoView({ behavior, block: 'center' });
    }

    if (isCurrent) {
      element.setAttribute('aria-current', 'page');
    }
  }, [shouldScroll, isCurrent]);

  return { isCurrent, viewRef };
};

export default useScrollToItem;
