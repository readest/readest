import { useRef } from 'react';
import { useReaderStore, type ViewState } from '@/store/readerStore';

// Set once each while a book opens, after the reader mounts, and read where they're needed rather
// than rendered: the page area's insets and whether the first section has loaded.
const UNRENDERED: ReadonlySet<string> = new Set<keyof ViewState>(['gridInsets', 'inited']);

/**
 * The book's view state, for the reader's chrome (header and footer bars) that renders from it.
 * An update that changes only fields the chrome doesn't render keeps the previous state, so it
 * doesn't re-render the chrome. Any other update does, including saving view settings that were
 * changed in place (the same settings object in a new view state).
 */
export const useBookViewState = (bookKey: string) => {
  const last = useRef<ViewState | undefined>(undefined);
  return useReaderStore((s) => {
    const next = s.viewStates[bookKey];
    const prev = last.current;
    if (prev && next && prev !== next) {
      const changed = Object.keys(next).filter(
        (k) => prev[k as keyof ViewState] !== next[k as keyof ViewState],
      );
      if (changed.length > 0 && changed.every((k) => UNRENDERED.has(k))) return prev;
    }
    last.current = next;
    return next;
  });
};
