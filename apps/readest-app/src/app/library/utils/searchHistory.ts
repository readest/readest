import type { LibrarySearchTarget } from '@/types/book';

const STORAGE_KEY_DEFAULT = 'search-history-library';
const STORAGE_KEY_BOOKS = 'search-history-library-books';
const STORAGE_KEY_TEXT = 'search-history-library-text';
const MAX_SEARCH_HISTORY = 10;

const getStorageKey = (target?: LibrarySearchTarget): string => {
  if (target === 'books') return STORAGE_KEY_BOOKS;
  if (target === 'text') return STORAGE_KEY_TEXT;
  return STORAGE_KEY_DEFAULT;
};

export const loadLibrarySearchHistory = (target?: LibrarySearchTarget): string[] => {
  try {
    const key = getStorageKey(target);
    let saved = localStorage.getItem(key);
    if (!saved && target === 'text') {
      saved = localStorage.getItem(STORAGE_KEY_DEFAULT);
    }
    return saved ? (JSON.parse(saved) as string[]) : [];
  } catch {
    return [];
  }
};

export const addLibrarySearchHistory = (term: string, target?: LibrarySearchTarget): void => {
  const trimmed = term.trim();
  if (!trimmed) return;
  const key = getStorageKey(target);
  const updated = [trimmed, ...loadLibrarySearchHistory(target).filter((t) => t !== trimmed)].slice(
    0,
    MAX_SEARCH_HISTORY,
  );
  try {
    localStorage.setItem(key, JSON.stringify(updated));
  } catch {
    /* best effort */
  }
};

export const clearLibrarySearchHistory = (target?: LibrarySearchTarget): void => {
  try {
    const key = getStorageKey(target);
    localStorage.removeItem(key);
    if (target === 'text' || !target) {
      localStorage.removeItem(STORAGE_KEY_DEFAULT);
    }
  } catch {
    /* best effort */
  }
};
