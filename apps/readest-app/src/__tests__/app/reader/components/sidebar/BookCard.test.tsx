import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import BookCard from '@/app/reader/components/sidebar/BookCard';
import { Book } from '@/types/book';

const mocks = vi.hoisted(() => ({
  dispatchSync: vi.fn(),
  config: { progress: undefined as [number, number] | undefined },
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: { dispatchSync: mocks.dispatchSync },
}));

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: { getState: () => ({ sideBarBookKey: 'abc123-0' }) },
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: { getState: () => ({ getConfig: () => mocks.config }) },
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ isDarkMode: false }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { librarySkeuomorphicCovers: false } }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (n: number) => n,
}));

vi.mock('@/components/BookCover', () => ({
  __esModule: true,
  default: () => null,
}));

afterEach(() => {
  mocks.dispatchSync.mockClear();
  mocks.config.progress = undefined;
  cleanup();
});

const book = {
  hash: 'abc123',
  title: 'Test Book',
  author: 'Test Author',
  format: 'EPUB',
  progress: [10, 200],
} as Book;

const clickInfo = (container: HTMLElement) => {
  const button = container.querySelector('button[aria-label="More Info"]');
  expect(button).toBeTruthy();
  fireEvent.click(button!);
};

describe('BookCard book details', () => {
  // The reader holds the Book snapshot taken when the book was opened, so its
  // page count is the previous session's — or missing entirely on a first
  // read. Book Details must show the count for the current layout (#5516).
  it('overrides the stale snapshot progress with the live config progress', () => {
    mocks.config.progress = [42, 317];
    const { container } = render(<BookCard book={book} />);

    clickInfo(container);

    expect(mocks.dispatchSync).toHaveBeenCalledWith(
      'show-book-details',
      expect.objectContaining({ hash: 'abc123', progress: [42, 317] }),
    );
  });

  it('keeps the book as-is when the view has not reported progress yet', () => {
    const { container } = render(<BookCard book={book} />);

    clickInfo(container);

    expect(mocks.dispatchSync).toHaveBeenCalledWith('show-book-details', book);
  });
});
