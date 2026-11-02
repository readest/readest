import { beforeEach, describe, expect, it } from 'vitest';

import {
  addLibrarySearchHistory,
  clearLibrarySearchHistory,
  loadLibrarySearchHistory,
  removeLibrarySearchHistory,
} from '@/app/library/utils/searchHistory';

beforeEach(() => localStorage.clear());

describe('library search history', () => {
  it('stores trimmed book searches separately and removes only the chosen entry', () => {
    addLibrarySearchHistory('spice');
    addLibrarySearchHistory('  Dune  ', 'books');
    addLibrarySearchHistory('Earthsea', 'books');
    addLibrarySearchHistory('Dune', 'books');
    expect(loadLibrarySearchHistory('books')).toEqual(['Dune', 'Earthsea']);
    removeLibrarySearchHistory('Dune', 'books');
    expect(loadLibrarySearchHistory('books')).toEqual(['Earthsea']);
    clearLibrarySearchHistory('books');
    expect(loadLibrarySearchHistory('books')).toEqual([]);
    expect(loadLibrarySearchHistory()).toEqual(['spice']);
  });

  it('ignores blank terms', () => {
    addLibrarySearchHistory('  ', 'books');
    expect(loadLibrarySearchHistory('books')).toEqual([]);
  });

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
});
