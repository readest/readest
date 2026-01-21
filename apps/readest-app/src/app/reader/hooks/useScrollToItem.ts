import { useEffect, useMemo, useRef } from 'react';
import { BookProgress } from '@/types/book';
import { isCfiInLocation } from '@/utils/cfi';

const useScrollToItem = (cfi: string, progress: BookProgress | null) => {
  const viewRef = useRef<HTMLLIElement | null>(null);

  const isCurrent = useMemo(() => isCfiInLocation(cfi, progress?.location), [cfi, progress]);

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
