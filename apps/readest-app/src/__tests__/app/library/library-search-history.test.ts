import { beforeEach, describe, expect, it } from 'vitest';

import {
  addLibrarySearchHistory,
  clearLibrarySearchHistory,
  loadLibrarySearchHistory,
} from '@/app/library/utils/searchHistory';

beforeEach(() => localStorage.clear());

describe('library search history', () => {
  it('keeps most-recent-first, deduplicates, and caps at ten entries', () => {
    for (let i = 1; i <= 12; i++) addLibrarySearchHistory(`term${i}`);
    addLibrarySearchHistory('term5');

    const history = loadLibrarySearchHistory();
    expect(history[0]).toBe('term5');
    expect(history).toHaveLength(10);
    expect(history).not.toContain('term1');

    clearLibrarySearchHistory();
    expect(loadLibrarySearchHistory()).toEqual([]);
  });

  it('keeps books search history separate from text search history (#7126)', () => {
    addLibrarySearchHistory('Dune', 'books');
    addLibrarySearchHistory('Herbert', 'books');
    addLibrarySearchHistory('spice melange', 'text');

    const booksHistory = loadLibrarySearchHistory('books');
    const textHistory = loadLibrarySearchHistory('text');

    expect(booksHistory).toEqual(['Herbert', 'Dune']);
    expect(textHistory).toEqual(['spice melange']);

    clearLibrarySearchHistory('books');
    expect(loadLibrarySearchHistory('books')).toEqual([]);
    expect(loadLibrarySearchHistory('text')).toEqual(['spice melange']);
  });

  it('falls back to legacy storage key for text target when empty', () => {
    localStorage.setItem('search-history-library', JSON.stringify(['legacy query']));
    expect(loadLibrarySearchHistory('text')).toEqual(['legacy query']);
  });
});
