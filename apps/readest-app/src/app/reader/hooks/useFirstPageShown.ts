import { useEffect, useState } from 'react';
import { useReaderStore } from '@/store/readerStore';

/**
 * Whether the book's first page has been painted. The view is inited once it has gone to its first
 * page; that page is painted with the next frame, and a task queued from that frame runs after it.
 * Stays true from then on.
 */
export const useFirstPageShown = (bookKey: string) => {
  const inited = useReaderStore((s) => !!s.viewStates[bookKey]?.inited);
  const [shown, setShown] = useState(inited);
  useEffect(() => {
    if (shown || !inited) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => setShown(true), 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [inited, shown]);
  return shown;
};
