import { describe, expect, test } from 'vitest';
import { isInHiddenDir } from '@/services/bookService';

describe('isInHiddenDir', () => {
  test('flags files under a dot-directory at any depth', () => {
    expect(isInHiddenDir('.sync/Archive/book.epub')).toBe(true);
    expect(isInHiddenDir('Fiction/.git/objects/book.pdf')).toBe(true);
    expect(isInHiddenDir('Fiction\\.sync\\Archive\\book.epub')).toBe(true);
  });

  test('keeps files in regular directories and hidden file names', () => {
    expect(isInHiddenDir('book.epub')).toBe(false);
    expect(isInHiddenDir('Fiction/Sci-Fi/book.epub')).toBe(false);
    expect(isInHiddenDir('Fiction/.book.epub')).toBe(false);
    expect(isInHiddenDir('Vol. 1/book.epub')).toBe(false);
  });
});
