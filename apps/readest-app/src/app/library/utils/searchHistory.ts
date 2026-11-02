import type { LibrarySearchTarget } from '@/types/book';

const STORAGE_KEY = 'search-history-library';
const MAX_SEARCH_HISTORY = 10;
const storageKey = (target: LibrarySearchTarget) =>
  target === 'text' ? STORAGE_KEY : `${STORAGE_KEY}-books`;

export const loadLibrarySearchHistory = (target: LibrarySearchTarget = 'text'): string[] => {
  try {
    const saved = localStorage.getItem(storageKey(target));
    return saved ? (JSON.parse(saved) as string[]) : [];
  } catch {
    return [];
  }
};

export const addLibrarySearchHistory = (
  term: string,
  target: LibrarySearchTarget = 'text',
): void => {
  const trimmed = term.trim();
  if (!trimmed) return;
  const updated = [trimmed, ...loadLibrarySearchHistory(target).filter((t) => t !== trimmed)].slice(
    0,
    MAX_SEARCH_HISTORY,
  );
  try {
    localStorage.setItem(storageKey(target), JSON.stringify(updated));
  } catch {
    /* best effort */
  }
};

export const removeLibrarySearchHistory = (term: string, target: LibrarySearchTarget): void => {
  try {
    localStorage.setItem(
      storageKey(target),
      JSON.stringify(loadLibrarySearchHistory(target).filter((entry) => entry !== term)),
    );
  } catch {
    /* best effort */
  }
};

export const clearLibrarySearchHistory = (target: LibrarySearchTarget = 'text'): void => {
  try {
    localStorage.removeItem(storageKey(target));
  } catch {
    /* best effort */
  }
};
