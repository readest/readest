import { describe, expect, it } from 'vitest';

import { getBookGoodreadsQuery, getGoodreadsSearchUrl } from '@/utils/goodreads';
import { Book } from '@/types/book';

const createBook = (overrides: Partial<Book> = {}): Book => ({
  hash: 'hash-1',
  format: 'EPUB',
  title: 'The Left Hand of Darkness',
  author: 'Ursula K. Le Guin',
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

describe('getGoodreadsSearchUrl', () => {
  it('builds a Goodreads search URL with the query percent-encoded', () => {
    expect(getGoodreadsSearchUrl('The Left Hand of Darkness')).toBe(
      'https://www.goodreads.com/search?q=The%20Left%20Hand%20of%20Darkness',
    );
  });

  it('trims surrounding whitespace before encoding', () => {
    expect(getGoodreadsSearchUrl('  Dune  ')).toBe('https://www.goodreads.com/search?q=Dune');
  });

  it('encodes reserved characters so the query survives intact', () => {
    expect(getGoodreadsSearchUrl('Cat & Mouse')).toBe(
      'https://www.goodreads.com/search?q=Cat%20%26%20Mouse',
    );
  });
});

describe('getBookGoodreadsQuery', () => {
  it('combines title and author', () => {
    expect(getBookGoodreadsQuery(createBook())).toBe('The Left Hand of Darkness Ursula K. Le Guin');
  });

  it('falls back to the title alone when the author is empty', () => {
    expect(getBookGoodreadsQuery(createBook({ author: '' }))).toBe('The Left Hand of Darkness');
  });

  it('trims each part', () => {
    expect(getBookGoodreadsQuery(createBook({ title: '  Dune  ', author: '  Herbert ' }))).toBe(
      'Dune Herbert',
    );
  });
});
