import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LibrarySearchResults from '@/app/library/components/LibrarySearchResults';
import type { LibrarySearchEvent } from '@/services/librarySearchService';
import type { Book, LibrarySearchConfig } from '@/types/book';

const { searchMock, sessionClose, resolveCfi, translate } = vi.hoisted(() => ({
  searchMock: vi.fn(),
  sessionClose: vi.fn(),
  resolveCfi: vi.fn(),
  translate: (key: string, values?: Record<string, string | number>) =>
    Object.entries(values ?? {}).reduce(
      (value, [name, replacement]) => value.replace(`{{${name}}}`, String(replacement)),
      key,
    ),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => translate,
}));

vi.mock('@/services/librarySearchService', () => ({
  createLibrarySearchSession: () => ({ close: sessionClose }),
  searchLibraryBooks: (...args: unknown[]) => searchMock(...args),
  resolveSearchResultCfi: (...args: unknown[]) => resolveCfi(...args),
}));

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  searchMock.mockReset();
  sessionClose.mockReset();
  resolveCfi.mockReset();
});

const book: Book = {
  hash: 'book',
  format: 'MD',
  title: 'Search Book',
  author: 'Author',
  createdAt: 1,
  updatedAt: 1,
};
const config: LibrarySearchConfig = {
  scope: 'book',
  mode: 'contains',
  matchCase: false,
  matchDiacritics: false,
};

const events = async function* (values: LibrarySearchEvent[]) {
  for (const value of values) yield value;
};

describe('LibrarySearchResults', () => {
  it('forwards the clicked CFI, avoids equivalent-config rescans, and closes its session', async () => {
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
                locator: { section: 0, start: 7, end: 13 },
                excerpt: { pre: 'before ', match: 'needle', post: ' after' },
              },
            ],
          },
        },
        { type: 'completed', searchedBooks: 1, skippedBooks: 0, erroredBooks: 0, matchCount: 1 },
      ]),
    );
    const onSelectResult = vi.fn();
    const props = {
      appService: {} as never,
      books: [book],
      query: 'needle',
      config,
      onSelectResult,
    };
    const { rerender, unmount } = render(<LibrarySearchResults {...props} />);

    await waitFor(() => expect(screen.getByText('Search Book')).toBeTruthy());
    fireEvent.click(screen.getByText('Search Book'));
    await waitFor(() => expect(screen.getByText('Chapter One')).toBeTruthy());
    resolveCfi.mockResolvedValue('epubcfi(/6/2!/4/2:1)');
    fireEvent.click(screen.getByText('needle'));
    await waitFor(() => expect(onSelectResult).toHaveBeenCalledWith(book, 'epubcfi(/6/2!/4/2:1)'));
    expect(resolveCfi).toHaveBeenCalledWith(expect.anything(), book, {
      section: 0,
      start: 7,
      end: 13,
    });
    expect(searchMock).toHaveBeenCalledOnce();

    vi.useFakeTimers();
    rerender(<LibrarySearchResults {...props} config={{ ...config }} />);
    await vi.runAllTimersAsync();
    expect(searchMock).toHaveBeenCalledOnce();
    unmount();
    expect(sessionClose).toHaveBeenCalledOnce();
  });

  it('labels a capped result set as partial', async () => {
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
                locator: { section: 0, start: 0, end: 6 },
                excerpt: { pre: '', match: 'needle', post: '' },
              },
            ],
          },
        },
        {
          type: 'completed',
          searchedBooks: 1,
          skippedBooks: 0,
          erroredBooks: 0,
          matchCount: 1,
          truncated: true,
        },
      ]),
    );

    render(
      <LibrarySearchResults
        appService={{} as never}
        books={[book]}
        query='capped'
        config={config}
        onSelectResult={vi.fn()}
      />,
    );

    expect(await screen.findByText('1+ results')).toBeTruthy();
  });

  it('restores the completed results when remounted with the same search', async () => {
    const resultEvents = (): LibrarySearchEvent[] => [
      {
        type: 'result',
        book,
        result: {
          index: 0,
          label: 'Chapter One',
          subitems: [
            {
              locator: { section: 0, start: 7, end: 15 },
              excerpt: { pre: 'before ', match: 'restored', post: ' after' },
            },
          ],
        },
      },
      { type: 'completed', searchedBooks: 1, skippedBooks: 0, erroredBooks: 0, matchCount: 1 },
    ];
    searchMock.mockImplementation(() => events(resultEvents()));
    const props = {
      appService: {} as never,
      books: [book],
      query: 'restored',
      config,
      onSelectResult: vi.fn(),
    };
    const { unmount } = render(<LibrarySearchResults {...props} />);
    await waitFor(() => expect(screen.getByText('1 results')).toBeTruthy());
    // Expand a group so the remount can prove the expansion survives too.
    fireEvent.click(screen.getByText('Search Book'));
    await waitFor(() => expect(screen.getByText('Chapter One')).toBeTruthy());
    expect(searchMock).toHaveBeenCalledOnce();
    unmount();

    // Opening a result navigates to the reader; coming back remounts the
    // component with the same books/config/query and must not rescan.
    const { unmount: unmountRestored } = render(<LibrarySearchResults {...props} />);
    await waitFor(() => expect(screen.getByText('1 results')).toBeTruthy());
    expect(screen.getByText('Chapter One')).toBeTruthy();
    expect(searchMock).toHaveBeenCalledOnce();
    unmountRestored();

    // Importing or deleting a book changes the hash list, which invalidates
    // the snapshot and rescans.
    const imported: Book = { ...book, hash: 'imported', title: 'Imported Book' };
    render(<LibrarySearchResults {...props} books={[book, imported]} />);
    await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(2));
  });
});
