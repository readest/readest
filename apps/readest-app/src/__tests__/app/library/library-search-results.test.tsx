import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LibrarySearchResults from '@/app/library/components/LibrarySearchResults';
import type { LibrarySearchEvent } from '@/services/librarySearchService';
import type { Book, LibrarySearchConfig } from '@/types/book';

const { searchMock, sessionClose, translate } = vi.hoisted(() => ({
  searchMock: vi.fn(),
  sessionClose: vi.fn(),
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
}));

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  searchMock.mockReset();
  sessionClose.mockReset();
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
    const props = {
      appService: {} as never,
      books: [book],
      query: 'needle',
      config,
      onSelectResult,
    };
    const { rerender, unmount } = render(<LibrarySearchResults {...props} />);

    await waitFor(() => expect(screen.getByText('Chapter One')).toBeTruthy());
    fireEvent.click(screen.getByText('needle'));
    expect(onSelectResult).toHaveBeenCalledWith(book, 'epubcfi(/6/2!/4/2:1)');
    expect(searchMock).toHaveBeenCalledOnce();

    vi.useFakeTimers();
    rerender(<LibrarySearchResults {...props} config={{ ...config }} />);
    await vi.runAllTimersAsync();
    expect(searchMock).toHaveBeenCalledOnce();
    unmount();
    expect(sessionClose).toHaveBeenCalledOnce();
  });
});
