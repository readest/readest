import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, act } from '@testing-library/react';

const requestCoverThumbnailMock = vi.fn();

vi.mock('@/services/environment', () => ({
  getInitializedAppService: () => ({
    supportsCoverThumbnailOptimization: true,
    requestCoverThumbnail: requestCoverThumbnailMock,
  }),
  isTauriAppPlatform: () => true,
}));

import BookCover from '@/components/BookCover';
import { Book } from '@/types/book';
import { SystemSettings } from '@/types/settings';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    // biome-ignore lint/a11y/useAltText: test mock; alt comes from spread props
    return <img {...props} />;
  },
}));

beforeEach(() => {
  requestCoverThumbnailMock.mockClear();
  useLibraryStore.setState({
    coverThumbnails: new Map(),
    library: [],
    hashIndex: new Map(),
    visibleLibrary: [],
  });
  useSettingsStore.setState({ settings: { ...DEFAULT_SYSTEM_SETTINGS } as SystemSettings });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const makeBook = (overrides?: Partial<Book>): Book =>
  ({
    hash: 'abc123',
    title: 'Test Book',
    author: 'Test Author',
    format: 'epub',
    coverImageUrl: 'https://example.com/cover.jpg',
    ...overrides,
  }) as Book;

describe('BookCover', () => {
  it('passes loading="lazy" to crop-mode Image', () => {
    const { container } = render(<BookCover book={makeBook()} coverFit='crop' />);
    const img = container.querySelector('img.cover-image');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('loading')).toBe('lazy');
  });

  it('passes loading="lazy" to fit-mode Image', () => {
    const { container } = render(<BookCover book={makeBook()} coverFit='fit' />);
    const img = container.querySelector('img.cover-image');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('loading')).toBe('lazy');
  });

  it('reports natural aspect ratio via onAspectRatioChange when fit-mode image loads', () => {
    const onAspectRatioChange = vi.fn();
    const { container } = render(
      <BookCover book={makeBook()} coverFit='fit' onAspectRatioChange={onAspectRatioChange} />,
    );
    const img = container.querySelector('img.cover-image') as HTMLImageElement;
    expect(img).toBeTruthy();

    Object.defineProperty(img, 'naturalWidth', { value: 600, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 900, configurable: true });
    fireEvent.load(img);

    expect(onAspectRatioChange).toHaveBeenCalledWith(600 / 900);
  });

  it('falls back to metadata.author on the fallback cover when book.author is empty', () => {
    const book = makeBook({
      author: '',
      coverImageUrl: undefined,
      metadata: { author: 'Edited Author' } as Book['metadata'],
    });
    const { container } = render(<BookCover book={book} coverFit='crop' />);
    const fallback = container.querySelector('.fallback-cover');
    expect(fallback?.textContent).toContain('Edited Author');
  });

  it('shows the placeholder and reports an error when the original cover cannot load', () => {
    const onImageError = vi.fn();
    const { container } = render(
      <BookCover book={makeBook()} coverFit='crop' onImageError={onImageError} />,
    );

    fireEvent.error(container.querySelector('img')!);

    expect(container.querySelector('.fallback-cover')?.classList.contains('invisible')).toBe(false);
    expect(onImageError).toHaveBeenCalledOnce();
  });

  it('uses an edited metadata cover without scheduling native optimization', () => {
    const { container } = render(
      <BookCover
        book={makeBook({
          coverImageUrl: 'asset://original.png',
          metadata: { coverImageUrl: 'blob:edited-cover' } as Book['metadata'],
        })}
        coverFit='crop'
      />,
    );

    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:edited-cover');
    expect(requestCoverThumbnailMock).not.toHaveBeenCalled();
  });

  it('keeps the original cover visible while requesting its thumbnail', async () => {
    const book = makeBook({
      coverHash: 'cover-v1',
      coverImageUrl: 'https://example.com/full-size-cover.jpg',
    });

    const { container } = render(<BookCover book={book} coverFit='crop' />);

    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.com/full-size-cover.jpg',
    );
    expect(container.querySelector('.fallback-cover')?.classList.contains('invisible')).toBe(true);
    await waitFor(() => expect(requestCoverThumbnailMock).toHaveBeenCalledWith(book));
  });

  it('switches to a matching optimized thumbnail without mutating the original cover URL', () => {
    const book = makeBook({
      hash: 'book-1',
      coverHash: 'cover-v1',
      coverImageUrl: 'https://example.com/full-size-cover.jpg',
    });
    useLibraryStore.setState({
      library: [book],
      hashIndex: new Map([['book-1', 0]]),
      visibleLibrary: [book],
    });
    const { container } = render(<BookCover book={book} coverFit='crop' />);

    act(() => {
      useLibraryStore
        .getState()
        .setBookCoverThumbnail('book-1', 'cover-v1', 'asset://thumbnail.jpg');
    });

    expect(container.querySelector('img')?.getAttribute('src')).toBe('asset://thumbnail.jpg');
    expect(book.coverImageUrl).toBe('https://example.com/full-size-cover.jpg');
    expect(container.querySelector('.fallback-cover')?.classList.contains('invisible')).toBe(true);
  });

  it('ignores a thumbnail for an older cover revision and requests the current one', async () => {
    const book = makeBook({
      hash: 'book-1',
      coverHash: 'cover-v2',
      coverImageUrl: 'asset://original-v2.png',
    });
    useLibraryStore.setState({
      coverThumbnails: new Map([
        ['book-1', { coverHash: 'cover-v1', url: 'asset://stale-thumbnail.jpg' }],
      ]),
    });

    const { container } = render(<BookCover book={book} coverFit='crop' />);

    expect(container.querySelector('img')?.getAttribute('src')).toBe('asset://original-v2.png');
    await waitFor(() => expect(requestCoverThumbnailMock).toHaveBeenCalledWith(book));
  });

  it('requests a new thumbnail when the cover revision changes without a timestamp change', async () => {
    const book = makeBook({ hash: 'book-1', coverHash: 'cover-v1', updatedAt: 1 });
    const { rerender } = render(<BookCover book={book} coverFit='crop' />);
    await waitFor(() => expect(requestCoverThumbnailMock).toHaveBeenCalledWith(book));

    const revisedBook = { ...book, coverHash: 'cover-v2' };
    rerender(<BookCover book={revisedBook} coverFit='crop' />);

    await waitFor(() => expect(requestCoverThumbnailMock).toHaveBeenCalledWith(revisedBook));
  });

  it('falls back to the original image rather than the placeholder if a thumbnail cannot load', () => {
    const book = makeBook({
      hash: 'book-1',
      coverHash: 'cover-v1',
      coverImageUrl: 'https://example.com/full-size-cover.jpg',
    });
    useLibraryStore.setState({
      library: [book],
      hashIndex: new Map([['book-1', 0]]),
      visibleLibrary: [book],
    });
    useLibraryStore.getState().setBookCoverThumbnail('book-1', 'cover-v1', 'asset://thumbnail.jpg');
    const { container } = render(<BookCover book={book} coverFit='crop' />);

    fireEvent.error(container.querySelector('img')!);

    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.com/full-size-cover.jpg',
    );
    expect(container.querySelector('.fallback-cover')?.classList.contains('invisible')).toBe(true);
  });

  it('waits for the viewport prefetch margin before requesting optimization', () => {
    let reveal: (() => void) | undefined;
    const observe = vi.fn();
    const unobserve = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          reveal = () =>
            callback(
              [
                {
                  isIntersecting: true,
                  target: observe.mock.calls[0]![0],
                } as IntersectionObserverEntry,
              ],
              this as unknown as IntersectionObserver,
            );
        }
        observe = observe;
        unobserve = unobserve;
        disconnect = vi.fn();
        takeRecords = () => [];
        root = null;
        rootMargin = '400px';
        thresholds = [0];
      },
    );
    const book = makeBook({ coverHash: 'cover-v1' });

    const { rerender } = render(<BookCover book={book} coverFit='crop' />);

    expect(observe).toHaveBeenCalledOnce();
    expect(requestCoverThumbnailMock).not.toHaveBeenCalled();
    const progressedBook = { ...book, updatedAt: 2 };
    rerender(<BookCover book={progressedBook} coverFit='crop' />);
    expect(observe).toHaveBeenCalledOnce();
    act(() => reveal?.());
    expect(requestCoverThumbnailMock).toHaveBeenCalledWith(progressedBook);
    expect(unobserve).toHaveBeenCalledOnce();
  });

  describe('hide covers', () => {
    const enableHideCovers = () =>
      useSettingsStore.setState({
        settings: {
          ...DEFAULT_SYSTEM_SETTINGS,
          libraryHideCovers: true,
        } as SystemSettings,
      });

    it('renders the title panel instead of the cover image when enabled', () => {
      enableHideCovers();
      const book = makeBook();

      const { container } = render(<BookCover book={book} coverFit='crop' />);

      expect(container.querySelector('img.cover-image')).toBeNull();
      const fallback = container.querySelector('.fallback-cover');
      expect(fallback).toBeTruthy();
      expect(fallback?.classList.contains('invisible')).toBe(false);
      expect(fallback?.textContent).toContain('Test Book');
    });

    it('does not request thumbnail optimization when covers are hidden', async () => {
      enableHideCovers();
      const book = makeBook({ hash: 'book-1', coverHash: 'cover-v1' });

      render(<BookCover book={book} coverFit='crop' />);

      await waitFor(() => expect(requestCoverThumbnailMock).not.toHaveBeenCalled());
    });

    it('still renders the real cover when the option is disabled', () => {
      const book = makeBook();

      const { container } = render(<BookCover book={book} coverFit='crop' />);

      expect(container.querySelector('img.cover-image')).toBeTruthy();
      expect(container.querySelector('.fallback-cover')?.classList.contains('invisible')).toBe(
        true,
      );
    });

    it('switches an already-mounted cover when the option is toggled', () => {
      const book = makeBook();
      const { container } = render(<BookCover book={book} coverFit='crop' />);
      expect(container.querySelector('img.cover-image')).toBeTruthy();

      act(() => enableHideCovers());

      expect(container.querySelector('img.cover-image')).toBeNull();
      expect(container.querySelector('.fallback-cover')?.classList.contains('invisible')).toBe(
        false,
      );
    });

    it('hides the spine when covers are hidden even after a cover has loaded', () => {
      const book = makeBook();
      const { container } = render(<BookCover book={book} coverFit='crop' showSpine />);
      const img = container.querySelector('img.cover-image')!;
      fireEvent.load(img);
      expect(container.querySelector('.book-spine')?.classList.contains('visible')).toBe(true);

      act(() => enableHideCovers());

      expect(container.querySelector('.book-spine')?.classList.contains('visible')).toBe(false);
    });
  });
});
