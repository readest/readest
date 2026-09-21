import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Book, BooksGroup } from '@/types/book';
import type { ShelfSection } from '@/app/library/components/BookshelfStream';
import type { BookshelfDefinition } from '@/types/bookshelf';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { DEFAULT_SYSTEM_SETTINGS as partialSettings } from '@/services/constants';
import type { SystemSettings } from '@/types/settings';
const DEFAULT_SYSTEM_SETTINGS = partialSettings as SystemSettings;
import { HlcGenerator } from '@/libs/crdt';
import {
  bookshelfSchema,
  createBookshelf,
  defaultBookshelves,
} from '@/services/bookshelves/definitions';
import { applyBookshelfDraft } from '@/services/bookshelves/state';
import { createBookGroups } from '@/app/library/utils/libraryUtils';
import { LibraryGroupByType } from '@/types/settings';
import Bookshelf from '@/app/library/components/Bookshelf';
const mocks = vi.hoisted(() => ({
  params: new URLSearchParams(),
  env: {},
  durations: {},
  servers: [],
  translate: (s: string) => s,
  open: vi.fn(),
  router: { push: vi.fn(), replace: vi.fn() },
  initialize: () => {},
  instance: () => undefined,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.params,
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: mocks.env, appService: null }),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => mocks.translate }));
vi.mock('@/hooks/useMedianPageDurationSecs', () => ({
  useMedianPageDurationsSecs: () => mocks.durations,
}));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (n: number) => n }));
vi.mock('@/app/library/hooks/useSpatialNavigation', () => ({ useSpatialNavigation: () => {} }));
vi.mock('@/app/library/hooks/useOpenBook', () => ({
  useOpenBook: () => ({ openBook: mocks.open }),
}));
vi.mock('@/store/absServerStore', () => ({
  useABSServerStore: () => mocks.servers,
  isAbsBookOrphaned: () => false,
}));
vi.mock('overlayscrollbars-react', () => ({
  useOverlayScrollbars: () => [mocks.initialize, mocks.instance],
}));
vi.mock('@/app/library/components/ShareBookDialog', () => ({ default: () => null }));
vi.mock('@/app/library/components/BookshelfItem', () => ({
  default: ({
    item,
    toggleSelection,
    itemSelected,
    coverFit,
    skeuomorphicCovers,
    isSelectMode,
    handleLibraryNavigation,
  }: {
    item: Book | BooksGroup;
    toggleSelection: (id: string) => void;
    itemSelected: boolean;
    coverFit: string;
    skeuomorphicCovers: boolean;
    isSelectMode: boolean;
    handleLibraryNavigation: (group: string) => void;
  }) => {
    // Keep the mode-entry callback here to verify selection reads the live
    // store even when a child retains an older callback. The real card also
    // refreshes its handler when group membership or callbacks change.
    const onClick = React.useCallback(
      () =>
        isSelectMode
          ? toggleSelection('hash' in item ? item.hash : item.id)
          : 'books' in item && handleLibraryNavigation(item.id),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [isSelectMode],
    );
    return (
      <button
        data-cover-fit={coverFit}
        data-skeuomorphic-covers={skeuomorphicCovers}
        aria-pressed={itemSelected}
        onClick={onClick}
      >
        {'hash' in item ? item.title : item.name}
      </button>
    );
  },
}));
vi.mock('@/app/library/components/SelectModeActions', () => ({ default: () => null }));
vi.mock('@/app/library/components/BookshelfStream', () => ({
  default: ({
    sections,
    renderItem,
    importAction,
  }: {
    sections: ShelfSection[];
    renderItem: (
      item: Book | BooksGroup,
      layout: 'list' | 'grid',
      shelf: BookshelfDefinition,
    ) => React.ReactNode;
    importAction: React.ReactNode;
  }) => (
    <>
      {sections.map((s) => (
        <section
          key={s.definition.id}
          data-testid={s.definition.id}
          data-layout={s.definition.layout}
        >
          {s.items.map((item) => (
            <div key={'hash' in item ? item.hash : item.id}>
              {renderItem(item, s.definition.layout === 'list' ? 'list' : 'grid', s.definition)}
            </div>
          ))}
        </section>
      ))}
      {importAction}
    </>
  ),
}));
const books: Book[] = Array.from({ length: 20 }, (_, index) => ({
  hash: `${index}`,
  title: `Book ${index}`,
  author: 'Writer',
  format: 'EPUB',
  createdAt: index,
  updatedAt: index,
  progress: [1, 100],
}));
const noop = () => {};
const props = {
  libraryBooks: books,
  isSelectMode: true,
  isSelectAll: false,
  isSelectNone: false,
  onScrollerRef: noop,
  handleImportBooks: noop,
  handleBookDownload: async () => true,
  handleBookUpload: async () => true,
  handleBookDelete: async () => true,
  handleBookPurge: async () => true,
  handleSetSelectMode: noop,
  handleShowDetailsBook: noop,
  handleLibraryNavigation: noop,
  handlePushLibrary: async () => {},
  booksTransferProgress: {},
  contentSearch: null,
  onSearchContents: noop,
};
const clock = new HlcGenerator('library');
const configure = (draft: BookshelfDefinition[]) => {
  const state = applyBookshelfDraft(
    { rows: {} },
    defaultBookshelves({ ...DEFAULT_SYSTEM_SETTINGS, libraryRecentShelfEnabled: true }),
    draft,
    { userId: '', deviceId: 'library', next: () => clock.next() },
  ).state;
  useSettingsStore.setState({
    settings: {
      ...DEFAULT_SYSTEM_SETTINGS,
      libraryGroupBy: 'none',
      libraryRecentShelfEnabled: true,
      bookshelves: state,
    },
  });
};
beforeEach(() => {
  mocks.params = new URLSearchParams();
  mocks.router.replace.mockClear();
  window.history.replaceState(null, '', '/library');
  useSettingsStore.setState({
    settings: {
      ...DEFAULT_SYSTEM_SETTINGS,
      libraryGroupBy: 'none',
      libraryRecentShelfEnabled: true,
    },
  });
  useLibraryStore.setState({ library: books, selectedBooks: new Set() });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe('library bookshelf integration', () => {
  it('hides enabled shelves without matching books from the library', () => {
    const emptyShelf = bookshelfSchema.parse({
      ...createBookshelf('Empty shelf'),
      filters: {
        type: 'group',
        match: 'all',
        children: [
          { type: 'rule', field: 'title', kind: 'text', operator: 'equals', value: 'Absent' },
        ],
      },
    });
    configure([emptyShelf, ...defaultBookshelves(DEFAULT_SYSTEM_SETTINGS)]);
    render(<Bookshelf {...props} />);
    expect(screen.queryByTestId(emptyShelf.id)).toBeNull();
    expect(screen.getByTestId('default')).toBeTruthy();
  });
  it('moves a newly finished audiobook out of an earlier exclusive shelf and back when reopened', () => {
    const audio = bookshelfSchema.parse({
      ...createBookshelf('Audiobooks'),
      exclusive: true,
      filters: {
        type: 'group',
        match: 'all',
        children: [
          { type: 'rule', field: 'audio', kind: 'boolean', operator: 'equals', value: true },
        ],
      },
    });
    configure([
      audio,
      ...defaultBookshelves(DEFAULT_SYSTEM_SETTINGS).map((s) =>
        s.id === 'finished' ? { ...s, enabled: true, exclusive: true } : s,
      ),
    ]);
    const audioBooks: Book[] = [{ ...books[0]!, format: 'ABS', readingStatus: 'reading' }];
    useLibraryStore.setState({ library: audioBooks });
    const { rerender } = render(<Bookshelf {...props} libraryBooks={audioBooks} />);
    expect(screen.getByTestId(audio.id).textContent).toBe('Book 0');
    expect(screen.queryByTestId('finished')).toBeNull();
    const finishedBooks: Book[] = [{ ...audioBooks[0]!, readingStatus: 'finished' }];
    act(() => useLibraryStore.setState({ library: finishedBooks }));
    rerender(<Bookshelf {...props} libraryBooks={finishedBooks} />);
    expect(screen.queryByTestId(audio.id)).toBeNull();
    expect(screen.getByTestId('finished').textContent).toBe('Book 0');
    act(() => useLibraryStore.setState({ library: audioBooks }));
    rerender(<Bookshelf {...props} libraryBooks={audioBooks} />);
    expect(screen.getByTestId(audio.id).textContent).toBe('Book 0');
    expect(screen.queryByTestId('finished')).toBeNull();
  });
  it('refreshes relative filters at midnight and after returning from sleep', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T23:59:59Z'));
    const custom = bookshelfSchema.parse({
      ...createBookshelf('Last day'),
      filters: {
        type: 'group',
        match: 'all',
        children: [
          {
            type: 'rule',
            field: 'created',
            kind: 'date',
            operator: 'withinLast',
            value: 1,
            unit: 'days',
          },
        ],
      },
    });
    const datedBooks = [
      { ...books[0]!, createdAt: Date.parse('2025-06-14') },
      { ...books[1]!, createdAt: Date.parse('2025-06-15') },
    ];
    configure([custom, ...defaultBookshelves(DEFAULT_SYSTEM_SETTINGS)]);
    useLibraryStore.setState({ library: datedBooks });
    render(<Bookshelf {...props} libraryBooks={datedBooks} />);
    expect(screen.getByTestId(custom.id).querySelectorAll('button')).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(1001);
    });
    expect(screen.getByTestId(custom.id).querySelectorAll('button')).toHaveLength(1);
    vi.setSystemTime(new Date('2025-06-18T12:00:00Z'));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(screen.queryByTestId(custom.id)).toBeNull();
  });
  it('selects only the clicked shelf’s group when names overlap across shelves', () => {
    const custom = {
      ...createBookshelf('Filtered'),
      useGlobalGrouping: false,
      groupBy: 'author' as const,
      filters: {
        type: 'group' as const,
        match: 'all' as const,
        children: [
          {
            type: 'rule' as const,
            field: 'title',
            kind: 'text' as const,
            operator: 'contains' as const,
            value: 'Book 1',
          },
        ],
      },
    };
    configure([...defaultBookshelves(DEFAULT_SYSTEM_SETTINGS), custom]);
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, libraryGroupBy: 'author' },
    });
    render(<Bookshelf {...props} />);
    fireEvent.click(screen.getByTestId(custom.id).querySelector('button')!);
    expect(useLibraryStore.getState().selectedBooks).toEqual(
      new Set(books.filter((b) => b.title.startsWith('Book 1')).map((b) => b.hash)),
    );
    expect(
      screen.getByTestId('default').querySelector('button')?.getAttribute('aria-pressed'),
    ).toBe('false');
  });
  it('keeps group navigation inside the originating shelf and its filters', () => {
    const custom = {
      ...createBookshelf('Authors'),
      useGlobalGrouping: false,
      groupBy: 'author' as const,
      filters: {
        type: 'group' as const,
        match: 'all' as const,
        children: [
          {
            type: 'rule' as const,
            field: 'title',
            kind: 'text' as const,
            operator: 'contains' as const,
            value: 'Book 1',
          },
        ],
      },
    };
    configure([custom, ...defaultBookshelves(DEFAULT_SYSTEM_SETTINGS)]);
    const navigate = vi.fn();
    const { rerender } = render(
      <Bookshelf {...props} isSelectMode={false} handleLibraryNavigation={navigate} />,
    );
    const group = screen.getByTestId(custom.id).querySelector('button')!;
    expect(group.textContent).toBe('Writer');
    fireEvent.click(group);
    expect(navigate).toHaveBeenCalledWith(expect.any(String), custom.id);
    mocks.params = new URLSearchParams({ group: navigate.mock.calls[0]![0], shelf: custom.id });
    rerender(<Bookshelf {...props} isSelectMode={false} handleLibraryNavigation={navigate} />);
    expect(screen.queryByTestId('default')).toBeNull();
    const members = screen.getByTestId(custom.id).querySelectorAll('button');
    expect(members).toHaveLength(11);
    expect(Array.from(members).every((b) => b.textContent?.startsWith('Book 1'))).toBe(true);
  });
  it('updates inherited grouping while independent shelves keep their choice', () => {
    const custom = {
      ...createBookshelf('Ungrouped'),
      useGlobalGrouping: false,
      groupBy: 'none' as const,
    };
    configure([custom, ...defaultBookshelves(DEFAULT_SYSTEM_SETTINGS)]);
    render(<Bookshelf {...props} />);
    act(() =>
      useSettingsStore.setState({
        settings: { ...useSettingsStore.getState().settings, libraryGroupBy: 'author' },
      }),
    );
    expect(screen.getByTestId('default').querySelectorAll('button')).toHaveLength(1);
    expect(screen.getByTestId('default').textContent).toBe('Writer');
    expect(screen.getByTestId(custom.id).querySelectorAll('button')).toHaveLength(20);
  });
  it('renders each shelf with its own cover sizing, including legacy fallback', () => {
    const custom = { ...createBookshelf('Fitted'), coverFit: 'fit' as const };
    configure([custom, ...defaultBookshelves(DEFAULT_SYSTEM_SETTINGS)]);
    render(<Bookshelf {...props} />);
    expect(
      screen.getByTestId(custom.id).querySelector('button')?.getAttribute('data-cover-fit'),
    ).toBe('fit');
    expect(
      screen.getByTestId('default').querySelector('button')?.getAttribute('data-cover-fit'),
    ).toBe('crop');
  });
  it('renders skeuomorphic covers independently for each shelf', () => {
    const custom = { ...createBookshelf('With spines'), skeuomorphicCovers: true };
    configure([custom, ...defaultBookshelves(DEFAULT_SYSTEM_SETTINGS)]);
    render(<Bookshelf {...props} />);
    expect(
      screen
        .getByTestId(custom.id)
        .querySelector('button')
        ?.getAttribute('data-skeuomorphic-covers'),
    ).toBe('true');
    expect(
      screen
        .getByTestId('default')
        .querySelector('button')
        ?.getAttribute('data-skeuomorphic-covers'),
    ).toBe('false');
  });
  it('updates inheriting shelves from global sorting while Default can sort independently', () => {
    const custom = createBookshelf('Following global sorting');
    configure([
      custom,
      ...defaultBookshelves({ ...DEFAULT_SYSTEM_SETTINGS, libraryRecentShelfEnabled: true }).map(
        (s) =>
          s.id === 'default'
            ? {
                ...s,
                useGlobalSort: false,
                sort: { ...s.sort, by: 'created' as const, ascending: false },
              }
            : s,
      ),
    ]);
    render(<Bookshelf {...props} />);
    act(() =>
      useSettingsStore.setState({
        settings: {
          ...useSettingsStore.getState().settings,
          librarySortBy: 'created',
          librarySortAscending: true,
        },
      }),
    );
    for (const id of [custom.id, 'recent'])
      expect(screen.getByTestId(id).querySelector('button')?.textContent).toBe('Book 0');
    expect(screen.getByTestId('default').querySelector('button')?.textContent).toBe('Book 19');
  });
  it('uses the global view for non-carousel shelves and keeps all carousel results', () => {
    const carousel = { ...createBookshelf('Carousel'), limit: 4 };
    const custom = { ...createBookshelf('Following view mode'), layout: 'grid' as const };
    configure([
      carousel,
      custom,
      ...defaultBookshelves(DEFAULT_SYSTEM_SETTINGS).map((s) => ({
        ...s,
        enabled: true,
        layout: 'list' as const,
      })),
    ]);
    render(<Bookshelf {...props} />);
    for (const mode of ['grid', 'list'] as const) {
      act(() =>
        useSettingsStore.setState({
          settings: { ...useSettingsStore.getState().settings, libraryViewMode: mode },
        }),
      );
      for (const id of [custom.id, 'default', 'recent']) {
        expect(screen.getByTestId(id).getAttribute('data-layout')).toBe(mode);
        expect(screen.getByTestId(id).querySelectorAll('button')).toHaveLength(20);
      }
      expect(screen.getByTestId(carousel.id).getAttribute('data-layout')).toBe('carousel');
      expect(screen.getByTestId(carousel.id).querySelectorAll('button')).toHaveLength(20);
    }
  });
  it('uses the global search layout even when Default remains a carousel', () => {
    configure(
      defaultBookshelves(DEFAULT_SYSTEM_SETTINGS).map((s) => ({ ...s, layout: 'carousel' })),
    );
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, libraryViewMode: 'list' },
    });
    mocks.params = new URLSearchParams('q=Book');
    render(<Bookshelf {...props} />);
    expect(screen.getByTestId('default').getAttribute('data-layout')).toBe('list');
    expect(screen.getAllByRole('button', { name: /^Book \d+$/ })).toHaveLength(20);
  });
  it('deduplicates Select all across displayed sections and shares selection by book hash', async () => {
    render(<Bookshelf {...props} isSelectAll />);
    await waitFor(() => expect(useLibraryStore.getState().selectedBooks.size).toBe(20));
    expect(screen.getAllByRole('button', { name: 'Book 19' })).toHaveLength(2);
    expect(
      screen
        .getAllByRole('button', { name: 'Book 19' })
        .every((b) => b.getAttribute('aria-pressed') === 'true'),
    ).toBe(true);
  });
  it('includes every group member in selection and toggles overlapping cards together', async () => {
    const grouped = books.map((b) => ({ ...b, groupName: 'Fiction/Stories' }));
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SYSTEM_SETTINGS,
        libraryGroupBy: 'group',
        libraryRecentShelfEnabled: true,
      },
    });
    render(<Bookshelf {...props} libraryBooks={grouped} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Fiction' })[0]!);
    await waitFor(() => expect(useLibraryStore.getState().selectedBooks.size).toBe(20));
    expect(
      screen
        .getAllByRole('button', { name: 'Fiction' })
        .every((group) => group.getAttribute('aria-pressed') === 'true'),
    ).toBe(true);
  });
  it('adds each tapped group to the selection and removes only its books on a second tap', async () => {
    const grouped = books.map((book, index) => ({
      ...book,
      groupName: index < 5 ? 'A' : index < 10 ? 'B' : undefined,
    }));
    configure(
      defaultBookshelves(DEFAULT_SYSTEM_SETTINGS).map((s) => ({
        ...s,
        enabled: s.id === 'default',
      })),
    );
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, libraryGroupBy: 'group' },
    });
    useLibraryStore.setState({ library: grouped, selectedBooks: new Set() });
    render(<Bookshelf {...props} libraryBooks={grouped} />);
    fireEvent.click(screen.getByRole('button', { name: 'Book 10' }));
    fireEvent.click(screen.getByRole('button', { name: 'A' }));
    fireEvent.click(screen.getByRole('button', { name: 'B' }));
    await waitFor(() =>
      expect(useLibraryStore.getState().selectedBooks).toEqual(
        new Set(['10', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'B' }));
    await waitFor(() =>
      expect(useLibraryStore.getState().selectedBooks).toEqual(
        new Set(['10', '0', '1', '2', '3', '4']),
      ),
    );
  });
  it('keeps books unticked after Select all while the shelves recompute', async () => {
    const { rerender } = render(<Bookshelf {...props} isSelectAll />);
    await waitFor(() => expect(useLibraryStore.getState().selectedBooks.size).toBe(20));
    fireEvent.click(screen.getAllByRole('button', { name: 'Book 19' })[0]!);
    expect(useLibraryStore.getState().selectedBooks.size).toBe(19);
    rerender(<Bookshelf {...props} isSelectAll libraryBooks={[...books]} />);
    expect(useLibraryStore.getState().selectedBooks.size).toBe(19);
    rerender(<Bookshelf {...props} isSelectAll={false} isSelectNone />);
    rerender(<Bookshelf {...props} isSelectAll />);
    await waitFor(() => expect(useLibraryStore.getState().selectedBooks.size).toBe(20));
  });
  it('keeps an opened group while a search matches nothing', () => {
    window.history.replaceState(null, '', '/library?q=nope&group=g&shelf=default');
    mocks.params = new URLSearchParams('q=nope&group=g&shelf=default');
    render(<Bookshelf {...props} isSelectMode={false} />);
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });
  it('spans the whole library for a group opened without a shelf', () => {
    const audio = bookshelfSchema.parse({
      ...createBookshelf('Audiobooks'),
      exclusive: true,
      filters: {
        type: 'group',
        match: 'all',
        children: [
          { type: 'rule', field: 'audio', kind: 'boolean', operator: 'equals', value: true },
        ],
      },
    });
    configure([audio, ...defaultBookshelves(DEFAULT_SYSTEM_SETTINGS)]);
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, libraryGroupBy: 'author' },
    });
    const mixed: Book[] = [
      ...books,
      { ...books[0]!, hash: 'abs', title: 'Audio book', format: 'ABS' },
    ];
    useLibraryStore.setState({ library: mixed });
    const group = createBookGroups(mixed, LibraryGroupByType.Author).find(
      (item): item is BooksGroup => 'books' in item,
    )!;
    mocks.params = new URLSearchParams({ groupBy: 'author', group: group.id });
    const { rerender } = render(<Bookshelf {...props} isSelectMode={false} libraryBooks={mixed} />);
    expect(screen.getByRole('button', { name: 'Audio book' })).toBeTruthy();
    mocks.params = new URLSearchParams({ groupBy: 'author', group: group.id, shelf: 'default' });
    rerender(<Bookshelf {...props} isSelectMode={false} libraryBooks={mixed} />);
    expect(screen.queryByRole('button', { name: 'Audio book' })).toBeNull();
  });
  it('keeps global search complete when Default is disabled and an exclusive carousel has a legacy limit', () => {
    const base = defaultBookshelves(DEFAULT_SYSTEM_SETTINGS);
    configure([
      {
        ...createBookshelf('Owner'),
        exclusive: true,
        limit: 2,
        filters: {
          type: 'group',
          match: 'all',
          children: [
            { type: 'rule', field: 'title', kind: 'text', operator: 'contains', value: 'Book' },
          ],
        },
      },
      ...base.map((s) => ({ ...s, enabled: false })),
    ]);
    mocks.params = new URLSearchParams('q=Book&group=old-group');
    render(<Bookshelf {...props} />);
    expect(screen.getAllByRole('button', { name: /^Book \d+$/ })).toHaveLength(20);
  });
  it('selects all carousel results and keeps import access with Default disabled', async () => {
    configure([
      { ...createBookshelf('Custom'), limit: 3 },
      ...defaultBookshelves(DEFAULT_SYSTEM_SETTINGS).map((s) => ({ ...s, enabled: false })),
    ]);
    render(<Bookshelf {...props} isSelectAll />);
    await waitFor(() => expect(useLibraryStore.getState().selectedBooks.size).toBe(20));
    expect(screen.getByRole('button', { name: 'Import Books' })).toBeTruthy();
  });
});
