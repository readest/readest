import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import BookCard from '@/app/reader/components/sidebar/BookCard';
import { Book } from '@/types/book';

const mocks = vi.hoisted(() => ({
  dispatchSync: vi.fn(),
  config: { progress: undefined as [number, number] | undefined },
  settings: { librarySkeuomorphicCovers: false, libraryHideCovers: false },
  toDataUrl: vi.fn(async (url: string) => `data:image/png;base64,${url}`),
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
  useThemeStore: () => ({
    isDarkMode: false,
    safeAreaInsets: null,
    systemUIVisible: false,
    statusBarHeight: 0,
  }),
}));

vi.mock('@/store/settingsStore', () => {
  type State = { settings: typeof mocks.settings };
  const useSettingsStore = (selector?: (state: State) => unknown) => {
    const state: State = { settings: mocks.settings };
    return selector ? selector(state) : state;
  };
  return { useSettingsStore };
});

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

// The image viewer reads appService via useEnv (save button) and pulls the
// device store through useKeyDownActions; neither is under test here.
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: null }),
}));

vi.mock('@/hooks/useKeyDownActions', () => ({
  useKeyDownActions: () => {},
}));

// Blob -> data URL conversion needs a real fetch + FileReader; stub the
// boundary and assert on which cover URL was handed to it.
vi.mock('@/libs/document', () => ({
  convertBlobUrlToDataUrl: mocks.toDataUrl,
}));

afterEach(() => {
  mocks.dispatchSync.mockClear();
  mocks.toDataUrl.mockClear();
  mocks.config.progress = undefined;
  mocks.settings.libraryHideCovers = false;
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

// #5813: the sidebar thumbnail is too small to show someone the cover. Tapping
// it must blow the cover up full screen in the reader's image viewer, and
// closing the viewer must land back exactly where the reader was (the only
// other way was paging back to the cover and losing the position).
describe('BookCard cover viewer', () => {
  const coverBook = { ...book, coverImageUrl: 'blob:cover-full' } as Book;

  const tapCover = (container: HTMLElement) => {
    const cover = container.querySelector('button[aria-label="View Book Cover"]');
    expect(cover).toBeTruthy();
    fireEvent.click(cover!);
  };

  const findViewer = () => document.body.querySelector('[aria-label="Image viewer"]');

  it('opens the cover full screen in the image viewer when tapped', async () => {
    const { container } = render(<BookCard book={coverBook} />);

    tapCover(container);

    await waitFor(() => expect(findViewer()).toBeTruthy());
    // The viewer shows the book's full-resolution cover (converted the same way
    // as an in-book image), not a downscaled library thumbnail.
    expect(mocks.toDataUrl).toHaveBeenCalledWith('blob:cover-full');
    const img = findViewer()!.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('data:image/png;base64,blob:cover-full');
  });

  it('closes the viewer and leaves the sidebar in place', async () => {
    const { container } = render(<BookCard book={coverBook} />);
    tapCover(container);
    await waitFor(() => expect(findViewer()).toBeTruthy());

    fireEvent.click(findViewer()!.querySelector('button[aria-label="Close"]')!);

    expect(findViewer()).toBeNull();
    expect(container.querySelector('button[aria-label="View Book Cover"]')).toBeTruthy();
  });

  it('does not open anything when the book has no cover', async () => {
    const { container } = render(<BookCard book={book} />);

    tapCover(container);

    await Promise.resolve();
    expect(mocks.toDataUrl).not.toHaveBeenCalled();
    expect(findViewer()).toBeNull();
  });

  it('keeps the cover hidden when the library hides covers', async () => {
    mocks.settings.libraryHideCovers = true;
    const { container } = render(<BookCard book={coverBook} />);

    tapCover(container);

    await Promise.resolve();
    expect(mocks.toDataUrl).not.toHaveBeenCalled();
    expect(findViewer()).toBeNull();
  });
});
