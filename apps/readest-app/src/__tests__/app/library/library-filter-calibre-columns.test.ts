// Library search must match Calibre custom column values (readest#4811):
// the reporter categorizes children's books with a #recommends column
// ("TOD" = toddler) and wants to find them by typing the value.
import { describe, expect, it } from 'vitest';

import { createBookFilter } from '@/app/library/utils/libraryUtils';
import { Book } from '@/types/book';
import { BookMetadata } from '@/libs/document';

const bookWithColumns = (calibreColumns: BookMetadata['calibreColumns']): Book => ({
  hash: 'hash-1',
  format: 'EPUB',
  title: 'Goodnight (Moon)',
  author: 'Margaret Wise Brown',
  createdAt: 0,
  updatedAt: 0,
  metadata: { title: 'Goodnight (Moon)', author: '', language: 'en', calibreColumns },
});

describe('createBookFilter with calibre custom columns', () => {
  it('matches a custom column value', () => {
    const book = bookWithColumns([
      { label: 'recommends', name: 'Recommends', datatype: 'text', value: ['TOD', 'Grandma'] },
    ]);
    expect(createBookFilter('tod')(book)).toBe(true);
    expect(createBookFilter('grandma')(book)).toBe(true);
  });

  it('matches a custom column display name', () => {
    const book = bookWithColumns([
      { label: 'recommends', name: 'Recommends', datatype: 'text', value: ['TOD'] },
    ]);
    expect(createBookFilter('recommends')(book)).toBe(true);
  });

  it('matches scalar column values', () => {
    const book = bookWithColumns([
      { label: 'saga', name: 'My Saga', datatype: 'series', value: 'Cool Saga', extra: 2 },
    ]);
    expect(createBookFilter('cool saga')(book)).toBe(true);
  });

  it('does not match values the book does not have', () => {
    const book = bookWithColumns([
      { label: 'recommends', name: 'Recommends', datatype: 'text', value: ['TOD'] },
    ]);
    expect(createBookFilter('teen')(book)).toBeFalsy();
  });

  it('still works when calibreColumns is absent (regex and substring paths)', () => {
    const book = bookWithColumns(undefined);
    expect(createBookFilter('moon')(book)).toBe(true);
    expect(createBookFilter('(moon')(book)).toBe(true); // invalid regex falls back to substring
    expect(createBookFilter('tod')(book)).toBeFalsy();
  });
});
