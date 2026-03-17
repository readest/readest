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
    const isVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;

    if (!isVisible) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    if (isCurrent) {
      element.setAttribute('aria-current', 'page');
    }
  }, [shouldScroll, isCurrent]);

  return { isCurrent, viewRef };
};

export default useScrollToItem;
