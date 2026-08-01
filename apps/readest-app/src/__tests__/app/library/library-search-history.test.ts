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
});
