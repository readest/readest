// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { applyBookshelfDraft, readBookshelves } from '@/services/bookshelves/state';
import { saveBookshelfDraft } from '@/services/bookshelves/persistence';
import { presentBookshelf } from '@/services/bookshelves/presentation';
import { createBookGroups } from '@/app/library/utils/libraryUtils';
import { LibraryGroupByType } from '@/types/settings';
import Bookshelf from '@/app/library/components/Bookshelf';
import type { BookshelfDrop } from '@/app/library/components/BookshelfDragDrop';
import { md5Fingerprint } from '@/utils/md5';
import { eventDispatcher } from '@/utils/event';
const mocks = vi.hoisted(() => ({
  params: new URLSearchParams(),
  env: {},
  saveLibrary: vi.fn(async (_books: Book[]) => {}),
  durations: {},
  servers: [],
  translate: (s: string) => s,
  open: vi.fn(),
  router: { push: vi.fn(), replace: vi.fn() },
  initialize: () => {},
  instance: () => undefined,
  appService: null as object | null,
  drop: null as ((drop: BookshelfDrop) => void | Promise<void>) | null,
}));
vi.mock('@/app/library/components/BookshelfDragDrop', () => ({
  BookshelfDragDrop: ({
    onDrop,
    children,
  }: {
    onDrop: (drop: BookshelfDrop) => void | Promise<void>;
    children: React.ReactNode;
  }) => {
    mocks.drop = onDrop;
    return children;
  },
  BookshelfDragItem: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.params,
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: mocks.env, appService: mocks.appService }),
}));
vi.mock('@/app/library/components/LibrarySearchResults', () => ({
  default: ({ books }: { books: Book[] }) => (
    <div data-testid='content-search-results' data-books={books.map((b) => b.hash).join(',')} />
  ),
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
    showPageCount,
    isSelectMode,
    handleLibraryNavigation,
    showSeriesIndex,
    showTimeRemaining,
  }: {
    item: Book | BooksGroup;
    toggleSelection: (id: string) => void;
    itemSelected: boolean;
    coverFit: string;
    skeuomorphicCovers: boolean;
    showPageCount?: boolean;
    isSelectMode: boolean;
    handleLibraryNavigation: (group: string) => void;
    showSeriesIndex?: boolean;
    showTimeRemaining: boolean;
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
        data-show-page-count={showPageCount}
        data-show-series-index={showSeriesIndex}
        data-show-time-remaining={showTimeRemaining}
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
  handleBookDeleteLocalCopy: async () => true,
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
  mocks.saveLibrary.mockReset().mockResolvedValue(undefined);
  mocks.env = { getAppService: async () => ({ saveLibraryBooks: mocks.saveLibrary }) };
  mocks.params = new URLSearchParams();
  mocks.appService = null;
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
  it.each([
    'primary',
    'secondary',
  ] as const)('retains remaining-time labels after dragging a shelf with a %s time sort', async (key) => {
    localStorage.clear();
    mocks.appService = {};
    const originalSave = useSettingsStore.getState().saveSettings;
    const definitions = defaultBookshelves(DEFAULT_SYSTEM_SETTINGS).map((shelf) =>
      shelf.id === 'default'
        ? {
            ...shelf,
            useGlobalSort: false,
            sort: {
              by: key === 'primary' ? ('timeRemaining' as const) : ('title' as const),
              ascending: true,
              thenBy: key === 'secondary' ? ('timeRemaining' as const) : ('none' as const),
              thenAscending: true,
            },
          }
        : shelf,
    );
    configure(definitions);
    useSettingsStore.setState({ saveSettings: vi.fn(async () => {}) });
    try {
      render(<Bookshelf {...props} isSelectMode={false} />);
      const cards = () => within(screen.getByTestId('default')).getAllByRole('button');
      expect(
        cards().every((card) => card.getAttribute('data-show-time-remaining') === 'true'),
      ).toBe(true);
      const shelf = readBookshelves(useSettingsStore.getState().settings).find(
        (s) => s.id === 'default',
      )!;
      await act(async () =>
        mocks.drop!({ source: books[0]!, target: books[1]!, shelf, mode: 'before' }),
      );
      expect(
        cards().every((card) => card.getAttribute('data-show-time-remaining') === 'true'),
      ).toBe(true);
    } finally {
      useSettingsStore.setState({ saveSettings: originalSave });
      localStorage.clear();
    }
  });

  it('retains date-read sorting after grouping so later reading still moves the group first', async () => {
    localStorage.clear();
    mocks.appService = {};
    useLibraryStore.getState().setLibrary(books.slice(0, 3));
    const originalSave = useSettingsStore.getState().saveSettings;
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SYSTEM_SETTINGS,
        libraryGroupBy: 'group',
        libraryRecentShelfEnabled: false,
      },
      saveSettings: vi.fn(async () => {}),
    });
    const LiveBookshelf = () => (
      <Bookshelf {...props} libraryBooks={useLibraryStore((s) => s.library)} isSelectMode={false} />
    );
    try {
      render(<LiveBookshelf />);
      const shelf = readBookshelves(useSettingsStore.getState().settings).find(
        (s) => s.id === 'default',
      )!;
      await act(async () =>
        mocks.drop!({ source: books[0]!, target: books[1]!, shelf, mode: 'group' }),
      );
      expect(
        readBookshelves(useSettingsStore.getState().settings).find((s) => s.id === 'default')?.sort
          .by,
      ).toBe('updated');
      expect(within(screen.getByTestId('default')).getAllByRole('button')[0]?.textContent).toBe(
        'Book 2',
      );
      act(() => useLibraryStore.getState().updateBookProgress('0', [2, 100], undefined));
      expect(within(screen.getByTestId('default')).getAllByRole('button')[0]?.textContent).toBe(
        'Untitled Group 1',
      );
    } finally {
      useSettingsStore.setState({ saveSettings: originalSave });
      localStorage.clear();
    }
  });

  it('moves recently read books ahead of a saved drag order and retains the other positions after another drag', async () => {
    localStorage.clear();
    vi.useFakeTimers({ now: new Date('2026-11-08T12:00:00'), toFake: ['Date'] });
    mocks.appService = {};
    const input = books.slice(0, 3);
    useLibraryStore.getState().setLibrary(input);
    const originalSave = useSettingsStore.getState().saveSettings;
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SYSTEM_SETTINGS,
        libraryGroupBy: 'none',
        libraryRecentShelfEnabled: false,
      },
      saveSettings: vi.fn(async () => {}),
    });
    const LiveBookshelf = () => (
      <Bookshelf {...props} libraryBooks={useLibraryStore((s) => s.library)} isSelectMode={false} />
    );
    const shown = () =>
      within(screen.getByTestId('default'))
        .getAllByRole('button')
        .map((button) => button.textContent);
    const currentShelf = () =>
      readBookshelves(useSettingsStore.getState().settings).find((s) => s.id === 'default')!;
    try {
      const view = render(<LiveBookshelf />);
      expect(shown()).toEqual(['Book 2', 'Book 1', 'Book 0']);
      await act(async () =>
        mocks.drop!({
          source: input[0]!,
          target: input[2]!,
          shelf: currentShelf(),
          mode: 'before',
        }),
      );
      expect(shown()).toEqual(['Book 0', 'Book 2', 'Book 1']);
      vi.setSystemTime(Date.now() + 1000);
      act(() => useLibraryStore.getState().updateBookProgress('1', [2, 100], undefined));
      expect(shown()).toEqual(['Book 1', 'Book 0', 'Book 2']);
      vi.setSystemTime(Date.now() + 1000);
      act(() => useLibraryStore.getState().updateBookProgress('2', [2, 100], undefined));
      expect(shown()).toEqual(['Book 2', 'Book 1', 'Book 0']);
      vi.setSystemTime(Date.now() + 1000);
      await act(async () =>
        mocks.drop!({
          source: input[0]!,
          target: input[1]!,
          shelf: currentShelf(),
          mode: 'before',
        }),
      );
      expect(shown()).toEqual(['Book 2', 'Book 0', 'Book 1']);
      const saved = JSON.parse(
        JSON.stringify(useSettingsStore.getState().settings),
      ) as SystemSettings;
      view.unmount();
      useSettingsStore.setState({ settings: saved });
      render(<LiveBookshelf />);
      expect(shown()).toEqual(['Book 2', 'Book 0', 'Book 1']);
      vi.setSystemTime(Date.now() + 1000);
      act(() => useLibraryStore.getState().updateBookProgress('0', [2, 100], undefined));
      expect(shown()).toEqual(['Book 0', 'Book 2', 'Book 1']);
    } finally {
      useSettingsStore.setState({ saveSettings: originalSave });
      localStorage.clear();
    }
  });

  it('keeps the visible metadata order when moving up after leaving custom sorting', async () => {
    localStorage.clear();
    mocks.appService = {};
    const grouped = [
      { ...books[0]!, title: 'C', groupName: 'A', groupId: md5Fingerprint('A') },
      { ...books[1]!, title: 'B', groupName: 'A', groupId: md5Fingerprint('A') },
      { ...books[2]!, title: 'A', groupName: 'A', groupId: md5Fingerprint('A') },
      { ...books[3]!, title: 'D' },
      { ...books[4]!, title: 'E' },
    ];
    useLibraryStore.getState().setLibrary(grouped);
    useLibraryStore.getState().refreshGroups();
    mocks.params = new URLSearchParams({ group: md5Fingerprint('A'), shelf: 'default' });
    const originalUpdate = useLibraryStore.getState().updateBooks;
    const originalSave = useSettingsStore.getState().saveSettings;
    useLibraryStore.setState({
      updateBooks: async (_env, updates) => {
        const changed = new Map(updates.map((book) => [book.hash, book]));
        useLibraryStore
          .getState()
          .setLibrary(
            useLibraryStore.getState().library.map((book) => changed.get(book.hash) ?? book),
          );
      },
    });
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SYSTEM_SETTINGS,
        libraryGroupBy: 'group',
        librarySortBy: 'title',
        librarySortAscending: true,
        librarySortByAuto: false,
      },
      saveSettings: vi.fn(async () => {}),
    });
    try {
      const base = readBookshelves(useSettingsStore.getState().settings);
      await saveBookshelfDraft(
        mocks.env as Parameters<typeof saveBookshelfDraft>[0],
        base,
        base.map((s) =>
          s.id === 'default'
            ? {
                ...s,
                manualOrder: {
                  'group:A': ['b:1', 'b:2', 'b:0'],
                  'group:': ['b:4', 'b:3', `g:${md5Fingerprint('A')}`],
                },
              }
            : s,
        ),
      );
      render(<Bookshelf {...props} libraryBooks={grouped} isSelectMode={false} />);
      const stored = readBookshelves(useSettingsStore.getState().settings).find(
        (s) => s.id === 'default',
      )!;
      await act(async () => {
        await mocks.drop!({
          source: grouped[0]!,
          shelf: {
            ...stored,
            sort: { by: 'title', ascending: true, thenBy: 'none', thenAscending: true },
          },
          mode: 'parent',
        });
      });
      const after = readBookshelves(useSettingsStore.getState().settings).find(
        (s) => s.id === 'default',
      )!;
      expect(after.sort.by).toBe('title');
      const result = {
        definition: after,
        books: useLibraryStore.getState().library,
        matching: 5,
        excluded: 0,
      };
      expect(
        presentBookshelf(
          result,
          { libraryGroupBy: 'group' },
          'en',
          undefined,
          md5Fingerprint('A'),
          'A',
        ).map((item) => ('hash' in item ? item.hash : item.id)),
      ).toEqual(['2', '1']);
      expect(
        presentBookshelf(result, { libraryGroupBy: 'group' }, 'en')
          .filter((item) => 'hash' in item)
          .map((book) => book.hash),
      ).toEqual(['0', '3', '4']);
    } finally {
      useLibraryStore.setState({ updateBooks: originalUpdate });
      useSettingsStore.setState({ saveSettings: originalSave });
      localStorage.clear();
    }
  });

  it('restores group membership and existing orders when the library save rejects a subgroup move', async () => {
    localStorage.clear();
    mocks.appService = {};
    const childName = 'A/B';
    const grouped = books
      .slice(0, 2)
      .map((book) => ({ ...book, groupName: childName, groupId: md5Fingerprint(childName) }));
    useLibraryStore.getState().setLibrary(grouped);
    useLibraryStore.getState().refreshGroups();
    mocks.params = new URLSearchParams({ group: md5Fingerprint('A'), shelf: 'default' });
    const originalUpdate = useLibraryStore.getState().updateBooks;
    const originalSave = useSettingsStore.getState().saveSettings;
    mocks.saveLibrary.mockRejectedValueOnce(new Error('Library storage unavailable'));
    useSettingsStore.setState({
      settings: { ...DEFAULT_SYSTEM_SETTINGS, libraryGroupBy: 'group' },
      saveSettings: vi.fn(async () => {}),
    });
    try {
      const base = readBookshelves(useSettingsStore.getState().settings);
      await saveBookshelfDraft(
        mocks.env as Parameters<typeof saveBookshelfDraft>[0],
        base,
        base.map((s) =>
          s.id === 'default'
            ? {
                ...s,
                manualOrder: { 'group:A/B': ['b:1', 'b:0'] },
              }
            : s,
        ),
      );
      render(<Bookshelf {...props} libraryBooks={grouped} isSelectMode={false} />);
      const shelf = readBookshelves(useSettingsStore.getState().settings).find(
        (s) => s.id === 'default',
      )!;
      await act(async () => {
        await mocks.drop!({
          source: {
            id: md5Fingerprint(childName),
            name: childName,
            displayName: 'B',
            books: grouped,
            updatedAt: 1,
          },
          shelf,
          mode: 'parent',
        });
      });
      expect(useLibraryStore.getState().library.map((book) => book.groupName)).toEqual([
        'A/B',
        'A/B',
      ]);
      expect(
        readBookshelves(useSettingsStore.getState().settings).find((s) => s.id === 'default')
          ?.manualOrder?.['group:A/B'],
      ).toEqual(['b:1', 'b:0']);
    } finally {
      useLibraryStore.setState({ updateBooks: originalUpdate });
      useSettingsStore.setState({ saveSettings: originalSave });
      localStorage.clear();
    }
  });

  it('retains subgroup orders in every shelf when moving the subgroup to its parent', async () => {
    localStorage.clear();
    mocks.appService = {};
    const currentName = 'Fiction';
    const childName = 'Fiction/History';
    const grouped = books.slice(0, 2).map((book) => ({
      ...book,
      groupName: childName,
      groupId: md5Fingerprint(childName),
    }));
    useLibraryStore.getState().setLibrary(grouped);
    useLibraryStore.getState().refreshGroups();
    mocks.params = new URLSearchParams({ group: md5Fingerprint(currentName), shelf: 'default' });
    const originalUpdate = useLibraryStore.getState().updateBooks;
    const originalSave = useSettingsStore.getState().saveSettings;
    useLibraryStore.setState({ updateBooks: vi.fn(async () => {}) });
    useSettingsStore.setState({
      settings: { ...DEFAULT_SYSTEM_SETTINGS, libraryGroupBy: 'group' },
      saveSettings: vi.fn(async () => {}),
    });
    try {
      const base = readBookshelves(useSettingsStore.getState().settings);
      const other = {
        ...createBookshelf('Other'),
        manualOrder: {
          'group:Fiction/History': ['b:1', 'b:0'],
          'group:Fiction': [`g:${md5Fingerprint(childName)}`],
        },
      };
      await saveBookshelfDraft(mocks.env as Parameters<typeof saveBookshelfDraft>[0], base, [
        ...base,
        other,
      ]);
      render(<Bookshelf {...props} libraryBooks={grouped} isSelectMode={false} />);
      const shelf = readBookshelves(useSettingsStore.getState().settings).find(
        (s) => s.id === 'default',
      )!;
      await act(async () => {
        await mocks.drop!({
          source: {
            id: md5Fingerprint(childName),
            name: childName,
            displayName: 'History',
            books: grouped,
            updatedAt: 1,
          },
          shelf,
          mode: 'parent',
        });
      });
      const orders = readBookshelves(useSettingsStore.getState().settings).find(
        (s) => s.id === other.id,
      )?.manualOrder;
      expect(orders?.['group:History']).toEqual(['b:1', 'b:0']);
      expect(orders?.['group:Fiction/History'] ?? []).toEqual([]);
      expect(orders?.['group:Fiction']).toEqual([`g:${md5Fingerprint('History')}`]);
    } finally {
      useLibraryStore.setState({ updateBooks: originalUpdate });
      useSettingsStore.setState({ saveSettings: originalSave });
      localStorage.clear();
    }
  });

  it.each([
    'Fiction/Nested',
    'Fiction',
  ])('returns to the parent after moving the last book out of %s', async (currentName) => {
    localStorage.clear();
    mocks.appService = {};
    const groupId = md5Fingerprint(currentName);
    mocks.params = new URLSearchParams({ group: groupId, shelf: 'default' });
    window.history.replaceState(null, '', `/library?${mocks.params}`);
    const grouped = [{ ...books[0]!, groupName: currentName, groupId }];
    useLibraryStore.getState().setLibrary(grouped);
    useLibraryStore.getState().refreshGroups();
    const originalUpdate = useLibraryStore.getState().updateBooks;
    const originalSave = useSettingsStore.getState().saveSettings;
    useLibraryStore.setState({
      updateBooks: async (_env, updates) => {
        useLibraryStore.getState().setLibrary(updates);
        useLibraryStore.getState().refreshGroups();
      },
    });
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SYSTEM_SETTINGS,
        libraryGroupBy: 'group',
        libraryRecentShelfEnabled: false,
      },
      saveSettings: vi.fn(async () => {}),
    });
    const LiveBookshelf = () => (
      <Bookshelf {...props} libraryBooks={useLibraryStore((s) => s.library)} isSelectMode={false} />
    );
    try {
      render(<LiveBookshelf />);
      const shelf = defaultBookshelves(DEFAULT_SYSTEM_SETTINGS).find((s) => s.id === 'default')!;
      await act(async () => {
        await mocks.drop!({ source: grouped[0]!, shelf, mode: 'parent' });
      });
      const parent = currentName.includes('/') ? md5Fingerprint('Fiction') : '';
      await waitFor(() => expect(mocks.router.replace).toHaveBeenCalled());
      const url = String(mocks.router.replace.mock.lastCall?.[0]);
      expect(new URL(url, 'http://localhost').searchParams.get('group')).toBe(parent);
      expect(useLibraryStore.getState().library[0]?.groupName).toBe(parent ? 'Fiction' : undefined);
    } finally {
      useLibraryStore.setState({ updateBooks: originalUpdate });
      useSettingsStore.setState({ saveSettings: originalSave });
      localStorage.clear();
    }
  });

  it('moves a grouped book up one level without clearing its reading progress', async () => {
    localStorage.clear();
    mocks.appService = {};
    const currentName = 'Fiction/Nested';
    mocks.params = new URLSearchParams(`group=${md5Fingerprint(currentName)}&shelf=default`);
    const grouped = books
      .slice(0, 2)
      .map((book) => ({ ...book, groupName: currentName, groupId: md5Fingerprint(currentName) }));
    useLibraryStore.getState().setLibrary(grouped);
    useLibraryStore.getState().refreshGroups();
    const originalUpdate = useLibraryStore.getState().updateBooks;
    const originalSave = useSettingsStore.getState().saveSettings;
    const update = vi.fn<typeof originalUpdate>(async () => {});
    useLibraryStore.setState({ updateBooks: update });
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SYSTEM_SETTINGS,
        libraryGroupBy: 'group',
        libraryRecentShelfEnabled: false,
      },
      saveSettings: vi.fn(async () => {}),
    });
    try {
      render(<Bookshelf {...props} libraryBooks={grouped} isSelectMode={false} />);
      const shelf = defaultBookshelves(DEFAULT_SYSTEM_SETTINGS).find(
        (shelf) => shelf.id === 'default',
      )!;
      await act(async () => {
        await mocks.drop!({ source: grouped[0]!, shelf, mode: 'parent' } as BookshelfDrop);
      });
      expect(update).toHaveBeenCalledWith(
        mocks.env,
        [
          expect.objectContaining({
            hash: '0',
            groupName: 'Fiction',
            groupId: md5Fingerprint('Fiction'),
            progress: [1, 100],
          }),
        ],
        { skipSave: true },
      );
    } finally {
      useLibraryStore.setState({ updateBooks: originalUpdate });
      useSettingsStore.setState({ saveSettings: originalSave });
      localStorage.clear();
    }
  });

  it('preserves book changes arriving while a grouping drop waits for settings to save', async () => {
    localStorage.clear();
    mocks.appService = {};
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, libraryGroupBy: 'group' },
    });
    const started = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const store = useLibraryStore.getState();
    const originalUpdate = store.updateBooks;
    const originalSave = useSettingsStore.getState().saveSettings;
    useSettingsStore.setState({ saveSettings: vi.fn(async () => {}) });
    const initial = readBookshelves(useSettingsStore.getState().settings);
    await saveBookshelfDraft(
      mocks.env as Parameters<typeof saveBookshelfDraft>[0],
      initial,
      initial.map((s) =>
        s.id === 'default'
          ? {
              ...s,
              useGlobalSort: false,
              sort: { by: 'custom', ascending: true, thenBy: 'none', thenAscending: true },
              manualOrder: { 'group:': books.map((book) => `b:${book.hash}`) },
            }
          : s,
      ),
    );
    const update = vi.fn<typeof originalUpdate>(async () => {});
    useLibraryStore.setState({ updateBooks: update });
    useSettingsStore.setState({
      saveSettings: async () => {
        started.resolve();
        await resume.promise;
      },
    });
    try {
      render(<Bookshelf {...props} isSelectMode={false} />);
      const shelf = readBookshelves(useSettingsStore.getState().settings).find(
        (shelf) => shelf.id === 'default',
      )!;
      let running!: Promise<void>;
      act(() => {
        running = Promise.resolve(
          mocks.drop!({ source: books[0]!, target: books[1]!, shelf, mode: 'group' }),
        );
      });
      await started.promise;
      act(() =>
        useLibraryStore.setState({
          library: books.map((book, i) =>
            i === 0
              ? { ...book, title: 'New title', progress: [42, 100] }
              : i === 1
                ? { ...book, deletedAt: Date.now() }
                : book,
          ),
        }),
      );
      await act(async () => {
        resume.resolve();
        await running;
      });
      expect(update).toHaveBeenCalledWith(
        mocks.env,
        [
          expect.objectContaining({
            hash: '0',
            title: 'New title',
            progress: [42, 100],
            groupName: 'Untitled Group 1',
          }),
          expect.objectContaining({ hash: '1', deletedAt: expect.any(Number) }),
        ],
        { skipSave: true },
      );
    } finally {
      resume.resolve();
      useLibraryStore.setState({ updateBooks: originalUpdate });
      useSettingsStore.setState({ saveSettings: originalSave });
      localStorage.clear();
    }
  });

  it('shows the empty library state over a lingering content search', () => {
    mocks.appService = {};
    useLibraryStore.setState({ library: [] });
    render(
      <Bookshelf
        {...props}
        libraryBooks={[]}
        contentSearch={{
          query: 'whale',
          config: { scope: 'book', mode: 'contains', matchCase: false, matchDiacritics: false },
        }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Start your library' })).toBeTruthy();
    expect(screen.queryByTestId('content-search-results')).toBeNull();
  });
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
  it('shows page counts only on the shelf that turns them on (#6909)', () => {
    const custom = { ...createBookshelf('With page counts'), showPageCount: true };
    configure([custom, ...defaultBookshelves(DEFAULT_SYSTEM_SETTINGS)]);
    render(<Bookshelf {...props} />);
    const showPageCount = (shelfId: string) =>
      screen.getByTestId(shelfId).querySelector('button')?.getAttribute('data-show-page-count');
    expect(showPageCount(custom.id)).toBe('true');
    expect(showPageCount('default')).toBeNull();
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
  it.each(['', 'q=story'])('ignores articles in library and search title sorting (%s)', (query) => {
    const articleBooks = ['The Gatsby Story', 'Dune Story', 'A Tale Story'].map((title, index) => ({
      ...books[index]!,
      title,
    }));
    mocks.params = new URLSearchParams(query);
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SYSTEM_SETTINGS,
        libraryGroupBy: 'none',
        librarySortBy: 'title',
        librarySortByAuto: false,
        librarySortAscending: true,
      },
    });
    render(<Bookshelf {...props} libraryBooks={articleBooks} />);
    const displayedTitles = () =>
      Array.from(screen.getByTestId('default').querySelectorAll('button')).map(
        (b) => b.textContent,
      );
    expect(displayedTitles()).toEqual(['Dune Story', 'The Gatsby Story', 'A Tale Story']);
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
  it('deletes the books after an earlier delete confirmation was cancelled', async () => {
    const handleBookDelete = vi.fn(async () => true);
    render(<Bookshelf {...props} handleBookDelete={handleBookDelete} />);
    const openDelete = async () => {
      await act(() => eventDispatcher.dispatch('delete-books', { ids: ['1', '2'] }));
      return within(document.querySelector('.delete-alert') as HTMLElement);
    };
    fireEvent.click((await openDelete()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.querySelector('.delete-alert')).toBeNull());
    fireEvent.click((await openDelete()).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(document.querySelector('.delete-alert')).toBeNull());
    expect(handleBookDelete).toHaveBeenCalledTimes(2);
  });
  it('stops a cancelled deletion even when another one starts before its batch ends', async () => {
    const many = Array.from({ length: 41 }, (_, i) => ({
      ...books[0]!,
      hash: `m${i}`,
      title: `M ${i}`,
    }));
    useLibraryStore.setState({ library: many });
    const pending: (() => void)[] = [];
    const handleBookDelete = vi.fn(
      () => new Promise<boolean>((resolve) => pending.push(() => resolve(true))),
    );
    render(<Bookshelf {...props} libraryBooks={many} handleBookDelete={handleBookDelete} />);
    const confirmDelete = async (ids: string[]) => {
      await act(() => eventDispatcher.dispatch('delete-books', { ids }));
      const alert = within(document.querySelector('.delete-alert') as HTMLElement);
      fireEvent.click(alert.getByRole('button', { name: 'Delete' }));
      return alert;
    };
    // Two batches of 20; cancel while the first is still running.
    const first = await confirmDelete(many.slice(0, 40).map((b) => b.hash));
    await waitFor(() => expect(handleBookDelete).toHaveBeenCalledTimes(20));
    fireEvent.click(first.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.querySelector('.delete-alert')).toBeNull());
    await confirmDelete(['m40']);
    await waitFor(() => expect(handleBookDelete).toHaveBeenCalledTimes(21));
    await act(async () => pending.splice(0).forEach((resolve) => resolve()));
    await act(async () => pending.splice(0).forEach((resolve) => resolve()));
    expect(handleBookDelete).toHaveBeenCalledTimes(21);
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
  it('badges series indexes only on books inside an opened series group (#6347)', () => {
    const seriesBooks = books.map((book, index) => ({
      ...book,
      metadata: {
        title: book.title,
        author: 'Writer',
        language: 'en',
        series: 'Saga',
        seriesIndex: index + 1,
      },
    }));
    useLibraryStore.setState({ library: seriesBooks });
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, libraryGroupBy: 'series' },
    });
    const group = createBookGroups(seriesBooks, LibraryGroupByType.Series).find(
      (item): item is BooksGroup => 'books' in item,
    )!;
    const flags = () =>
      Array.from(screen.getByTestId('default').querySelectorAll('button')).map(
        (b) => b.dataset['showSeriesIndex'],
      );
    const { rerender } = render(
      <Bookshelf {...props} isSelectMode={false} libraryBooks={seriesBooks} />,
    );
    expect(flags()).toEqual(['false']);
    mocks.params = new URLSearchParams({ group: group.id, shelf: 'default' });
    rerender(<Bookshelf {...props} isSelectMode={false} libraryBooks={seriesBooks} />);
    expect(flags()).toHaveLength(20);
    expect(flags().every((flag) => flag === 'true')).toBe(true);
    // An author group names the author, not the series, so its covers stay plain.
    const author = createBookGroups(seriesBooks, LibraryGroupByType.Author).find(
      (item): item is BooksGroup => 'books' in item,
    )!;
    mocks.params = new URLSearchParams({ groupBy: 'author', group: author.id, shelf: 'default' });
    rerender(<Bookshelf {...props} isSelectMode={false} libraryBooks={seriesBooks} />);
    expect(flags().every((flag) => flag === 'false')).toBe(true);
  });
  it('searches book contents only within the opened group', () => {
    mocks.appService = {};
    const grouped = books.map((book, index) => ({
      ...book,
      groupName: index < 3 ? 'Philosophy' : index < 5 ? 'Philosophy/Ethics' : 'Fiction',
    }));
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, libraryGroupBy: 'group' },
    });
    useLibraryStore.setState({ library: grouped, groups: { philosophy: 'Philosophy' } });
    mocks.params = new URLSearchParams('q=Book&search=text&group=philosophy&shelf=default');
    render(
      <Bookshelf
        {...props}
        isSelectMode={false}
        libraryBooks={grouped}
        contentSearch={{
          query: 'Book',
          config: { scope: 'book', mode: 'contains', matchCase: false, matchDiacritics: false },
        }}
      />,
    );
    const searched = screen.getByTestId('content-search-results').dataset['books']!.split(',');
    expect(searched.sort()).toEqual(['0', '1', '2', '3', '4']);
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
