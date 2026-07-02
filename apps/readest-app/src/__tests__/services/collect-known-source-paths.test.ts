import { describe, expect, test } from 'vitest';
import { collectKnownSourcePaths } from '@/services/bookService';
import type { Book } from '@/types/book';

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    hash: 'bookhash',
    format: 'EPUB',
    title: 'sample',
    author: 'Author',
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    downloadedAt: 1,
    ...overrides,
  };
}

describe('collectKnownSourcePaths', () => {
  test('includes a live in-place book path', () => {
    const book = makeBook({ filePath: '/Users/me/Books/sample.epub' });
    const result = collectKnownSourcePaths([book]);
    expect(result.has('/Users/me/Books/sample.epub')).toBe(true);
  });

  test('includes a soft-deleted in-place book path (key regression)', () => {
    const book = makeBook({ filePath: '/Users/me/Books/deleted.epub', deletedAt: Date.now() });
    const result = collectKnownSourcePaths([book]);
    expect(result.has('/Users/me/Books/deleted.epub')).toBe(true);
  });

  test('excludes a book whose filePath is a URL (http)', () => {
    const book = makeBook({ filePath: 'http://example.com/book.epub' });
    const result = collectKnownSourcePaths([book]);
    expect(result.size).toBe(0);
  });

  test('excludes a book whose filePath is a URL (https)', () => {
    const book = makeBook({ filePath: 'https://example.com/book.epub' });
    const result = collectKnownSourcePaths([book]);
    expect(result.size).toBe(0);
  });

  test('excludes a book with no filePath', () => {
    const book = makeBook();
    const result = collectKnownSourcePaths([book]);
    expect(result.size).toBe(0);
  });

  test('normalizes case on osPlatform macos (key is lowercased)', () => {
    const book = makeBook({ filePath: '/Users/Me/Books/Sample.EPUB' });
    const result = collectKnownSourcePaths([book], 'macos');
    expect(result.has('/users/me/books/sample.epub')).toBe(true);
    expect(result.has('/Users/Me/Books/Sample.EPUB')).toBe(false);
  });

  test('preserves case on osPlatform linux', () => {
    const book = makeBook({ filePath: '/home/Me/Books/Sample.epub' });
    const result = collectKnownSourcePaths([book], 'linux');
    expect(result.has('/home/Me/Books/Sample.epub')).toBe(true);
    expect(result.has('/home/me/books/sample.epub')).toBe(false);
  });
});
