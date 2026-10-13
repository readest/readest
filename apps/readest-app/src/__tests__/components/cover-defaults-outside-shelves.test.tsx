import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, renderHook, act } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  toDataUrl: vi.fn(async (url: string) => `data:image/png;base64,${url}`),
}));

vi.mock('@/services/environment', () => ({
  getInitializedAppService: () => undefined,
  isTauriAppPlatform: () => false,
}));

vi.mock('@/libs/document', () => ({ convertBlobUrlToDataUrl: mocks.toDataUrl }));

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    // biome-ignore lint/a11y/useAltText: test mock; alt comes from spread props
    return <img {...props} />;
  },
}));

import BookCover, { HideBookCoversContext } from '@/components/BookCover';
import { useBookCoverViewer } from '@/components/BookCoverViewer';
import { useDefaultBookshelfCovers } from '@/hooks/useDefaultBookshelfCovers';
import { readDefaultBookshelfCovers } from '@/services/bookshelves/state';
import { DEFAULT_BOOKSHELF_ID, defaultBookshelves } from '@/services/bookshelves/definitions';
import { hlcPack } from '@/libs/crdt';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { Book } from '@/types/book';
import type { BookshelfDefinition } from '@/types/bookshelf';
import type { SystemSettings } from '@/types/settings';

const STAMP = hlcPack(1_700_000_000_000, 0, 'dev');

/** Cover appearance moved into the shelf definitions, so the Default shelf's
 * row is what surfaces outside any shelf must follow. */
const withDefaultShelf = (
  definition: Partial<BookshelfDefinition>,
  legacy: Partial<SystemSettings> = {},
): SystemSettings => {
  const shelf = {
    ...defaultBookshelves({}).find((s) => s.id === DEFAULT_BOOKSHELF_ID)!,
    ...definition,
  };
  return {
    ...DEFAULT_SYSTEM_SETTINGS,
    ...legacy,
    bookshelves: {
      rows: {
        [DEFAULT_BOOKSHELF_ID]: {
          user_id: '',
          kind: 'bookshelf',
          replica_id: DEFAULT_BOOKSHELF_ID,
          fields_jsonb: { definition: { v: shelf, t: STAMP, s: 'dev' } },
          deleted_at_ts: null,
          updated_at_ts: STAMP,
          reincarnation: null,
          manifest_jsonb: null,
          schema_version: 1,
        },
      },
    },
  } as SystemSettings;
};

const makeBook = (overrides?: Partial<Book>): Book =>
  ({
    hash: 'abc123',
    title: 'Test Book',
    author: 'Test Author',
    format: 'epub',
    coverImageUrl: 'https://example.com/cover.jpg',
    ...overrides,
  }) as Book;

beforeEach(() => {
  mocks.toDataUrl.mockClear();
  useLibraryStore.setState({
    coverThumbnails: new Map(),
    library: [],
    hashIndex: new Map(),
    visibleLibrary: [],
  });
  useSettingsStore.setState({ settings: { ...DEFAULT_SYSTEM_SETTINGS } as SystemSettings });
});

afterEach(() => cleanup());

describe('readDefaultBookshelfCovers', () => {
  it('prefers the Default shelf definition over the frozen legacy preferences', () => {
    const covers = readDefaultBookshelfCovers(
      withDefaultShelf(
        { hideCovers: false, skeuomorphicCovers: true, coverFit: 'fit' },
        { libraryHideCovers: true, librarySkeuomorphicCovers: false, libraryCoverFit: 'crop' },
      ),
    );
    expect(covers).toEqual({ hideCovers: false, skeuomorphicCovers: true, coverFit: 'fit' });
  });

  it('falls back to the legacy preferences when the shelf has no saved row', () => {
    const covers = readDefaultBookshelfCovers({
      ...DEFAULT_SYSTEM_SETTINGS,
      libraryHideCovers: true,
      librarySkeuomorphicCovers: true,
    } as SystemSettings);
    expect(covers.hideCovers).toBe(true);
    expect(covers.skeuomorphicCovers).toBe(true);
  });

  it('returns a stable object so card renders do not reparse every shelf', () => {
    const settings = withDefaultShelf({ hideCovers: true });
    expect(readDefaultBookshelfCovers(settings)).toBe(readDefaultBookshelfCovers(settings));
  });
});

describe('useDefaultBookshelfCovers', () => {
  it('follows the Default shelf, which Manage Bookshelves can still change', () => {
    useSettingsStore.setState({
      settings: withDefaultShelf(
        { skeuomorphicCovers: true },
        { librarySkeuomorphicCovers: false },
      ),
    });
    const { result } = renderHook(() => useDefaultBookshelfCovers());
    expect(result.current.skeuomorphicCovers).toBe(true);

    act(() =>
      useSettingsStore.setState({ settings: withDefaultShelf({ skeuomorphicCovers: false }) }),
    );
    expect(result.current.skeuomorphicCovers).toBe(false);
  });
});

describe('BookCover outside a shelf', () => {
  it('shows the cover when the Default shelf shows covers but the legacy setting hid them', () => {
    useSettingsStore.setState({
      settings: withDefaultShelf({ hideCovers: false }, { libraryHideCovers: true }),
    });
    const { container } = render(<BookCover book={makeBook()} coverFit='crop' />);
    expect(container.querySelector('img.cover-image')).toBeTruthy();
  });

  it('hides the cover when the Default shelf hides covers', () => {
    useSettingsStore.setState({
      settings: withDefaultShelf({ hideCovers: true }, { libraryHideCovers: false }),
    });
    const { container } = render(<BookCover book={makeBook()} coverFit='crop' />);
    expect(container.querySelector('img.cover-image')).toBeNull();
  });

  it('keeps the shelf context winning inside a shelf', () => {
    useSettingsStore.setState({ settings: withDefaultShelf({ hideCovers: false }) });
    const { container } = render(
      <HideBookCoversContext.Provider value={true}>
        <BookCover book={makeBook()} coverFit='crop' />
      </HideBookCoversContext.Provider>,
    );
    expect(container.querySelector('img.cover-image')).toBeNull();
  });
});

describe('useBookCoverViewer', () => {
  const book = makeBook();

  it('opens the full-screen cover when the Default shelf shows covers', async () => {
    useSettingsStore.setState({
      settings: withDefaultShelf({ hideCovers: false }, { libraryHideCovers: true }),
    });
    const { result } = renderHook(() => useBookCoverViewer(book));
    await act(() => result.current.openCoverViewer());
    expect(result.current.coverSrc).toBe('data:image/png;base64,https://example.com/cover.jpg');
  });

  it('stays closed when the Default shelf hides covers', async () => {
    useSettingsStore.setState({
      settings: withDefaultShelf({ hideCovers: true }, { libraryHideCovers: false }),
    });
    const { result } = renderHook(() => useBookCoverViewer(book));
    await act(() => result.current.openCoverViewer());
    expect(result.current.coverSrc).toBe(null);
  });
});
