import { useEffect, useMemo, useRef } from 'react';
import { BookProgress } from '@/types/book';
import * as CFI from 'foliate-js/epubcfi.js';

const useScrollToItem = (cfi: string, progress: BookProgress | null) => {
  const viewRef = useRef<HTMLLIElement | null>(null);

  const isCurrent = useMemo(() => {
    if (!progress) return false;

    const { location } = progress;
    const start = CFI.collapse(location);
    const end = CFI.collapse(location, true);
    return CFI.compare(cfi, start) >= 0 && CFI.compare(cfi, end) <= 0;
  }, [cfi, progress]);

  useEffect(() => {
    if (!viewRef.current || !isCurrent) return;

    // Scroll to the item if it's the current one and not visible
    const element = viewRef.current;
    const rect = element.getBoundingClientRect();
    const isVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;

    if (!isVisible) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    element.setAttribute('aria-current', 'page');
  }, [isCurrent]);

  return { isCurrent, viewRef };
};

export default useScrollToItem;
