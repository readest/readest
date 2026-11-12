import { create } from 'zustand';
import { BookProgress } from '@/types/book';

/**
 * Per-book reading progress, kept in its own store so that high-frequency
 * `setProgress` writes (fired once per page turn / scroll snap) do not
 * notify every component subscribed to `useReaderStore()`.
 *
 * Background — the "destructure-subscribes-the-whole-store" anti-pattern
 * --------------------------------------------------------------------
 * Zustand `useStore()` without a selector subscribes the caller to the
 * ENTIRE state object and re-renders on every top-level setState. The
 * reader subtree had ~65 places calling `useReaderStore()` and ~30
 * places calling `useBookDataStore()` in this destructure form. That
 * meant two separate problems happened at once:
 *
 *   1. **High-frequency writes** — `setProgress` updated readerStore
 *      multiple times per swipe burst. All 65 readerStore destructure
 *      sites re-rendered each time, even though only ~14 of them
 *      actually displayed or reacted to progress.
 *   2. **Medium-frequency writes** — `saveConfig` (fired ~1.5s after
 *      every page turn via useProgressAutoSave) wrote bookDataStore's
 *      `booksData`. All ~30 bookDataStore destructure sites re-rendered
 *      after each save.
 *
 * On Android release builds the combined React commit storm showed up
 * in Chrome DevTools' Bottom-Up profile as Layout = 9.8% and Function
 * Call = 9.6% of main-thread time during a reading session — directly
 * contributing to swipe jank ("感觉还是有点卡").
 *
 * Two-layer fix
 * -------------
 * Both layers had to land for the jank to go away:
 *
 *   A. **Split progress into its own tiny store** (this file). The 51
 *      readerStore subscribers that don't care about progress are
 *      auto-untouched once the field stops living there; only the ~14
 *      that genuinely need it opt in via `useBookProgress(bookKey)`.
 *   B. **Per-field selector pattern** for all remaining
 *      `useReaderStore()` / `useBookDataStore()` call sites: replace
 *      `const { x, y } = useStore()` with
 *      `const x = useStore((s) => s.x); const y = useStore((s) => s.y)`.
 *      Action identities are fixed at store creation, so selector
 *      results are stable references — the default `Object.is` bail-out
 *      eliminates the host component's re-renders entirely.
 *
 * Whenever you see a per-field selector comment in reader components
 * (FoliateViewer, Annotator, BooksGrid, etc.), this is the rationale
 * being applied.
 *
 * Lifecycle: `clearBookProgress(key)` is called from
 * `readerStore.clearViewState` to release the entry when a book view
 * tears down, mirroring the prior coupling to `viewStates[key]`.
 */
interface ReaderProgressState {
  // Keyed by book view key (matches readerStore.viewStates keys).
  progresses: { [key: string]: BookProgress | null };
}

export const useReaderProgressStore = create<ReaderProgressState>(() => ({
  progresses: {},
}));

/**
 * Imperative read — does NOT subscribe the caller. Use this inside event
 * handlers, callbacks, useEffect bodies, etc. — anywhere you want the
 * latest value without causing re-renders on subsequent progress changes.
 */
export const getBookProgress = (key: string | null): BookProgress | null => {
  if (!key) return null;
  return useReaderProgressStore.getState().progresses[key] ?? null;
};

/**
 * Imperative write — performs zustand setState only for this small store,
 * so subscribers to `useReaderStore()` are NOT touched.
 */
const sameRange = (a: Range, b: Range) =>
  a === b ||
  (a.startContainer === b.startContainer &&
    a.startOffset === b.startOffset &&
    a.endContainer === b.endContainer &&
    a.endOffset === b.endOffset);

// Equal fields, objects compared one level down (foliate builds new page objects per relocate).
const sameProgress = (a: BookProgress, b: BookProgress) =>
  (Object.keys(a) as (keyof BookProgress)[]).every((k) => {
    const x = a[k];
    const y = b[k];
    if (k === 'range') return !!x && !!y && sameRange(x as Range, y as Range);
    if (x && y && typeof x === 'object' && typeof y === 'object') {
      const xs = x as Record<string, unknown>;
      const ys = y as Record<string, unknown>;
      return (
        Object.keys(xs).length === Object.keys(ys).length &&
        Object.keys(xs).every((f) => xs[f] === ys[f])
      );
    }
    return x === y;
  }) && Object.keys(a).length === Object.keys(b).length;

export const setBookProgress = (key: string, progress: BookProgress | null) => {
  useReaderProgressStore.setState((state) => {
    const current = state.progresses[key];
    // foliate repeats a page turn's relocate once its scroll settles: the same position, in new
    // objects, must not re-render the progress readers again
    if (current && progress && sameProgress(current, progress)) return state;
    return {
      progresses: {
        ...state.progresses,
        [key]: progress,
      },
    };
  });
};

/**
 * Drop a book's progress entry — call from readerStore.clearViewState so
 * the map doesn't grow unbounded across opens/closes.
 */
export const clearBookProgress = (key: string) => {
  useReaderProgressStore.setState((state) => {
    if (!(key in state.progresses)) return state;
    const next = { ...state.progresses };
    delete next[key];
    return { progresses: next };
  });
};

/**
 * Reactive subscription — components that need to re-render when this
 * specific book's progress changes should use this hook. Selector form
 * ensures only progress changes for THIS key trigger a re-render
 * (and progress changes for OTHER books do not).
 */
export const useBookProgress = (key: string | null): BookProgress | null => {
  return useReaderProgressStore((s) => (key ? (s.progresses[key] ?? null) : null));
};

/**
 * What `select` takes from this book's progress (undefined before the first relocate, and for a
 * null key): re-renders only when that value changes. A page turn writes a new progress object,
 * so a component that shows only the section, or nothing until a feature is in use (a null key),
 * skips the turns that leave its value alone.
 */
export const useBookProgressValue = <T>(
  key: string | null,
  select: (progress: BookProgress) => T,
): T | undefined =>
  useReaderProgressStore((s) => {
    const progress = key ? s.progresses[key] : null;
    return progress ? select(progress) : undefined;
  });
