import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LibrarySearchResults from '@/app/library/components/LibrarySearchResults';
import type { LibrarySearchEvent } from '@/services/librarySearchService';
import type { Book, BookSearchConfig } from '@/types/book';

const { searchMock, translate } = vi.hoisted(() => ({
  searchMock: vi.fn(),
  translate: (key: string, values?: { count?: number }) =>
    values?.count === undefined ? key : key.replace('{{count}}', String(values.count)),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => translate,
}));

vi.mock('@/services/librarySearchService', () => ({
  searchLibraryBooks: (...args: unknown[]) => searchMock(...args),
}));

afterEach(() => {
  cleanup();
  searchMock.mockReset();
});

const book: Book = {
  hash: 'book',
  format: 'MD',
  title: 'Search Book',
  author: 'Author',
  createdAt: 1,
  updatedAt: 1,
};
const config: BookSearchConfig = {
  scope: 'book',
  mode: 'contains',
  matchCase: false,
  matchDiacritics: false,
};

const events = async function* (values: LibrarySearchEvent[]) {
  for (const value of values) yield value;
};

describe('LibrarySearchResults', () => {
  it('streams grouped matches and opens the exact primary CFI', async () => {
    searchMock.mockReturnValue(
      events([
        {
          type: 'result',
          book,
          result: {
            index: 0,
            label: 'Chapter One',
            subitems: [
              {
                cfi: 'epubcfi(/6/2!/4/2:1)',
                excerpt: { pre: 'before ', match: 'needle', post: ' after' },
              },
            ],
          },
        },
        { type: 'completed', searchedBooks: 1, skippedBooks: 0, erroredBooks: 0, matchCount: 1 },
      ]),
    );
    const onSelectResult = vi.fn();
    render(
      <LibrarySearchResults
        appService={{} as never}
        books={[book]}
        query='needle'
        config={config}
        onSelectResult={onSelectResult}
      />,
    );

    await waitFor(() => expect(screen.getByText('Chapter One')).toBeTruthy());
    fireEvent.click(screen.getByText('needle'));

    expect(onSelectResult).toHaveBeenCalledWith(book, 'epubcfi(/6/2!/4/2:1)');
    expect(screen.queryByRole('progressbar', { name: 'Library Search Progress' })).toBeNull();
    expect(screen.getByText('needle').classList.contains('text-bold-in-eink')).toBe(true);
    expect(screen.getByText('1 results')).toBeTruthy();
  });

  it('reports unavailable books without showing a false no-results message', async () => {
    searchMock.mockReturnValue(
      events([
        { type: 'book-skipped', book, reason: 'unavailable' },
        { type: 'completed', searchedBooks: 0, skippedBooks: 1, erroredBooks: 0, matchCount: 0 },
      ]),
    );
    render(
      <LibrarySearchResults
        appService={{} as never}
        books={[book]}
        query='needle'
        config={config}
        onSelectResult={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText('Unavailable')).toBeTruthy());
    expect(screen.queryByText('No results found')).toBeNull();
  });
});
