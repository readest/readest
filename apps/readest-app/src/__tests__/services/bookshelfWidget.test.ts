import { beforeEach, describe, it, expect, vi } from 'vitest';
import {
  buildBookshelfWidgetItems,
  checkWidgetShelf,
  buildBookshelfWidgetSnapshot,
  defaultWidgetShelf,
  DEFAULT_BOOKSHELF_WIDGET_GRID,
  evaluateWidgetShelves,
  normalizeWidgetShelf,
  parseWidgetShelf,
  refreshBookshelfWidget,
} from '@/services/widget/bookshelfWidget';
import type { Book, BooksGroup } from '@/types/book';
import type { BookshelfDefinition } from '@/types/bookshelf';
import type { BookshelfWidgetInstance } from '@/utils/bridge';

vi.mock('@/utils/bridge', () => ({
  updateBookshelfWidget: vi.fn().mockResolvedValue({ failed: 0 }),
  getBookshelfWidgetInstances: vi.fn().mockResolvedValue({ instances: [] }),
}));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: {
    getState: () => ({
      library: [
        {
          hash: 'a',
          title: 'Ta',
          author: 'Aa',
          format: 'EPUB',
          updatedAt: 2,
          progress: [1, 2],
          readingStatus: 'reading',
        },
        {
          hash: 'b',
          title: 'Tb',
          author: 'Ab',
          format: 'EPUB',
          updatedAt: 5,
          readingStatus: 'finished',
        },
      ],
    }),
  },
}));

const mk = (over: Partial<Book>): Book =>
  ({ hash: 'h', title: 'T', author: 'A', format: 'EPUB', updatedAt: 0, ...over }) as Book;

const mkMeta = (over: Partial<NonNullable<Book['metadata']>>): Book['metadata'] =>
  over as Book['metadata'];

/** The default shelf with overrides, e.g. a different filter or grouping. */
const shelfWith = (over: Partial<BookshelfDefinition>) =>
  normalizeWidgetShelf({ ...defaultWidgetShelf(), ...over });

const noFilter: BookshelfDefinition['filters'] = { type: 'group', match: 'all', children: [] };
const statusIs = (value: string): BookshelfDefinition['filters'] => ({
  type: 'group',
  match: 'all',
  children: [{ type: 'rule', field: 'status', kind: 'text', operator: 'equals', value }],
});

const grid = { ...DEFAULT_BOOKSHELF_WIDGET_GRID, gridRows: 2, gridColumns: 3 };
const hashes = (books: Book[]) => books.map((b) => b.hash);
/** One shelf evaluated on its own, as a lone widget would be. */
const evaluateAlone = (library: Book[], shelf: BookshelfDefinition) =>
  evaluateWidgetShelves(library, [{ appWidgetId: 0, shelf }]).get(0)!;
const tiles = async (library: Book[], shelf: BookshelfDefinition, gridSettings = grid) =>
  (
    await buildBookshelfWidgetSnapshot(
      evaluateAlone(library, shelf),
      shelf,
      gridSettings,
      appServiceForBuild,
      '',
    )
  ).items;
const bookHashes = (items: Awaited<ReturnType<typeof tiles>>) =>
  items.flatMap((tile) => (tile.type === 'book' ? [tile.hash] : []));
const coverHashes = (paths: string[]) => paths.map((path) => path.split('/').at(-2));

describe('parseWidgetShelf / normalizeWidgetShelf', () => {
  it('falls back to the default shelf for empty, malformed or schema-invalid input', () => {
    const fallback = defaultWidgetShelf();
    const parse = (json: string) => ({ ...parseWidgetShelf(json), id: fallback.id });
    expect(parse('')).toEqual(fallback);
    expect(parse('{not json')).toEqual(fallback);
    expect(parse(JSON.stringify({ id: 'nope' }))).toEqual(fallback);
  });

  it('round-trips a valid shelf, forcing the widget-only flags but keeping exclusivity', () => {
    const stored = {
      ...defaultWidgetShelf(),
      name: 'Sci-fi',
      filters: statusIs('finished'),
      exclusive: true,
    };
    const parsed = parseWidgetShelf(JSON.stringify({ ...stored, useGlobalSort: true }));
    expect(parsed).toMatchObject({ name: 'Sci-fi', filters: stored.filters, exclusive: true });
    expect(parsed).toMatchObject({
      enabled: true,
      useGlobalSort: false,
      useGlobalGrouping: false,
    });
  });

  it('keeps a blank name (no heading) and still treats the shelf as valid', () => {
    const blank = { ...defaultWidgetShelf(), name: '  ' };
    expect(normalizeWidgetShelf(blank).name).toBe('');
    expect(checkWidgetShelf(normalizeWidgetShelf(blank)).success).toBe(true);
    // Stored blank, read back blank - not swapped for the default name.
    expect(parseWidgetShelf(JSON.stringify(normalizeWidgetShelf(blank))).name).toBe('');
  });

  it('defaults to currently-reading books, newest first, ungrouped, with no name', () => {
    expect(defaultWidgetShelf()).toMatchObject({
      name: '',
      groupBy: 'none',
      sort: { by: 'updated', ascending: false },
    });
  });
});

describe('evaluateWidgetShelves', () => {
  const library = [
    mk({ hash: 'r1', updatedAt: 2, readingStatus: 'reading' }),
    mk({ hash: 'r2', updatedAt: 1, readingStatus: 'reading' }),
    mk({ hash: 'f', readingStatus: 'finished' }),
  ];
  const entry = (appWidgetId: number, over: Partial<BookshelfDefinition>) => ({
    appWidgetId,
    shelf: shelfWith(over),
  });
  const shown = (entries: ReturnType<typeof entry>[]) => {
    const results = evaluateWidgetShelves(library, entries);
    return Object.fromEntries(
      entries.map((e) => [e.appWidgetId, hashes(results.get(e.appWidgetId)!.books)]),
    );
  };
  const reading = statusIs('reading');

  it('an exclusive widget claims its books; others hide them unless they include exclusive books', () => {
    expect(
      shown([
        entry(1, { filters: reading, exclusive: true }),
        entry(2, { filters: noFilter }),
        entry(3, { filters: noFilter, includeExclusiveBooks: true }),
      ]),
    ).toEqual({ 1: ['r1', 'r2'], 2: ['f'], 3: ['r1', 'r2', 'f'] });
  });

  it('the older exclusive widget wins a shared book, whatever order the instances arrive in', () => {
    const older = entry(3, { filters: reading, exclusive: true });
    const newer = entry(7, { filters: reading, exclusive: true });
    const expected = { 3: ['r1', 'r2'], 7: [] };
    expect(shown([older, newer])).toEqual(expected);
    expect(shown([newer, older])).toEqual(expected);
  });
});

describe('widget tiles', () => {
  const library = [
    mk({ hash: 'old', updatedAt: 1, progress: [1, 2] }),
    mk({ hash: 'new', updatedAt: 9, progress: [1, 2] }),
    mk({ hash: 'done', updatedAt: 5, readingStatus: 'finished' }),
    mk({ hash: 'gone', updatedAt: 7, progress: [1, 2], deletedAt: 1 }),
  ];

  it('the default shelf (blank name) shows currently-reading books, newest first, ungrouped', async () => {
    const items = await tiles(library, defaultWidgetShelf());
    expect(bookHashes(items)).toEqual(['new', 'old']);
    expect(items).toHaveLength(2);
  });

  it("applies the shelf's own filter and sort direction", async () => {
    const shelf = shelfWith({
      filters: noFilter,
      sort: { ...defaultWidgetShelf().sort, ascending: true },
    });
    expect(bookHashes(await tiles(library, shelf))).toEqual(['old', 'done', 'new']);
    expect(bookHashes(await tiles(library, shelfWith({ filters: statusIs('finished') })))).toEqual([
      'done',
    ]);
  });

  it('truncates to the grid capacity', async () => {
    const many = Array.from({ length: 8 }, (_, i) => mk({ hash: `b${i}`, updatedAt: i }));
    const items = await tiles(many, shelfWith({ filters: noFilter }), {
      ...grid,
      gridRows: 1,
      gridColumns: 2,
    });
    expect(items).toHaveLength(2);
  });

  describe('grouped shelf', () => {
    const books = [
      mk({ hash: 's1', updatedAt: 3, metadata: mkMeta({ series: 'Foundation' }) }),
      mk({ hash: 's2', updatedAt: 4, metadata: mkMeta({ series: 'Foundation' }) }),
      mk({ hash: 'd1', updatedAt: 2, metadata: mkMeta({ series: 'Dune' }) }),
      mk({ hash: 'solo', updatedAt: 1 }),
    ];
    const bySeries = shelfWith({ filters: noFilter, groupBy: 'series' });

    it('shows a group tile per axis value, newest member first, with loose books in Library order', async () => {
      const items = await tiles(books, bySeries);
      // Newest first: Foundation (4), Dune (2), then the series-less book (1).
      expect(items.map((tile) => tile.type)).toEqual(['group', 'group', 'book']);
      expect(
        items.flatMap((tile) =>
          tile.type === 'group' ? [[tile.value, coverHashes(tile.coverPaths)]] : [],
        ),
      ).toEqual([
        ['Foundation', ['s2', 's1']],
        ['Dune', ['d1']],
      ]);
      expect(bookHashes(items)).toEqual(['solo']);
    });

    it('shows just the books when the axis produces no groups', async () => {
      const noSeries = books.filter((b) => !b.metadata?.series);
      expect((await tiles(noSeries, bySeries)).map((tile) => tile.type)).toEqual(['book']);
    });
  });
});

describe('buildBookshelfWidgetSnapshot', () => {
  const appService = {
    resolveFilePath: vi.fn().mockResolvedValue('/data/Books'),
  } as unknown as import('@/types/system').AppService;
  const emptyTitle = 'Empty';
  const library = [mk({ hash: 'a', progress: [1, 2], metadata: mkMeta({ series: 'Foundation' }) })];
  const build = (shelf: BookshelfDefinition, playback?: { bookHash: string }) =>
    buildBookshelfWidgetSnapshot(
      evaluateAlone(library, shelf),
      shelf,
      grid,
      appService,
      emptyTitle,
      playback && { active: true, playing: true, ...playback },
    );

  it("books only: the heading is the shelf's name", async () => {
    const snapshot = await build({ ...defaultWidgetShelf(), name: 'Widget name' });
    expect(snapshot.sectionTitle).toBe('Widget name');
    expect(snapshot.items).toEqual([expect.objectContaining({ type: 'book', hash: 'a' })]);
  });

  it('grouped: group tiles and loose books share one ordered list', async () => {
    const shelf = shelfWith({ filters: noFilter, groupBy: 'series' });
    const snapshot = await buildBookshelfWidgetSnapshot(
      evaluateAlone(
        [
          mk({ hash: 'a', updatedAt: 3, metadata: mkMeta({ series: 'Foundation' }) }),
          mk({ hash: 'solo', updatedAt: 1 }),
        ],
        shelf,
      ),
      shelf,
      grid,
      appService,
      emptyTitle,
    );
    expect(snapshot.items).toEqual([
      expect.objectContaining({ type: 'group', groupBy: 'series', value: 'Foundation' }),
      expect.objectContaining({ type: 'book', hash: 'solo' }),
    ]);
  });

  it('includes tts only when the playing book is one of the tiles actually shown', async () => {
    const inShelf = await build(defaultWidgetShelf(), { bookHash: 'a' });
    expect(inShelf.tts).toEqual({ active: true, playing: true });
    const elsewhere = await build(defaultWidgetShelf(), { bookHash: 'other' });
    expect('tts' in elsewhere).toBe(false);

    // Matches the shelf, but the grid is too small to show it.
    const many = Array.from({ length: 4 }, (_, i) => mk({ hash: `b${i}`, updatedAt: i }));
    const shelf = shelfWith({ filters: noFilter });
    const offScreen = await buildBookshelfWidgetSnapshot(
      evaluateAlone(many, shelf),
      shelf,
      { ...grid, gridRows: 1, gridColumns: 1 },
      appService,
      emptyTitle,
      { active: true, playing: true, bookHash: 'b0' },
    );
    expect(offScreen.items).toHaveLength(1);
    expect('tts' in offScreen).toBe(false);

    // A member of a shown group tile counts as shown too, even though the
    // group's own cover mosaic may not include that member's cover.
    const grouped = shelfWith({ filters: noFilter, groupBy: 'series' });
    const inGroup = await buildBookshelfWidgetSnapshot(
      evaluateAlone(
        [
          mk({ hash: 's1', updatedAt: 2, metadata: mkMeta({ series: 'Foundation' }) }),
          mk({ hash: 's2', updatedAt: 1, metadata: mkMeta({ series: 'Foundation' }) }),
        ],
        grouped,
      ),
      grouped,
      grid,
      appService,
      emptyTitle,
      { active: true, playing: true, bookHash: 's2' },
    );
    expect(inGroup.tts).toEqual({ active: true, playing: true });
  });
});

const appServiceForBuild = {
  isMobileApp: true,
  resolveFilePath: vi.fn().mockResolvedValue('/data/Books'),
} as unknown as import('@/types/system').AppService;

describe('buildBookshelfWidgetItems', () => {
  const group = (bookHashes: string[]) =>
    ({
      id: 'abc123',
      name: 'Foundation',
      displayName: 'Foundation',
      books: bookHashes.map((hash) => mk({ hash })),
    }) as BooksGroup;
  const bySeries = shelfWith({ groupBy: 'series' });
  const covers = (hash: string) => `/data/Books/${hash}/cover.png`;

  it('percent is current/total rounded and clamped to 0-100, and 0 without progress', async () => {
    const books = [
      mk({ hash: 'a', progress: [72, 100] }),
      mk({ hash: 'b', progress: [1, 3] }),
      mk({ hash: 'c', progress: [120, 100] }),
      mk({ hash: 'd' }),
      mk({ hash: 'e', progress: [1, 0] }),
    ];
    const items = await buildBookshelfWidgetItems(books, bySeries, grid, appServiceForBuild);
    expect(items.map((i) => i.type === 'book' && i.percent)).toEqual([72, 33, 100, 0, 0]);
  });

  it('resolves a group tile to the cover files of up to 4 members, or 1 without mosaic', async () => {
    const tile = group(['a', 'b', 'c', 'd', 'e']);
    const build = (groupMosaic: boolean) =>
      buildBookshelfWidgetItems([tile], bySeries, { ...grid, groupMosaic }, appServiceForBuild);
    expect(await build(true)).toEqual([
      {
        type: 'group',
        id: 'abc123',
        groupBy: 'series',
        value: 'Foundation',
        coverPaths: ['a', 'b', 'c', 'd'].map(covers),
      },
    ]);
    expect(await build(false)).toEqual([expect.objectContaining({ coverPaths: [covers('a')] })]);
  });

  it('showProgress is true for a currently-reading book and false for unread/finished/abandoned', async () => {
    const books = [
      mk({ hash: 'reading', progress: [1, 2], readingStatus: 'reading' }),
      mk({ hash: 'unread', progress: [1, 2], readingStatus: 'unread' }),
      mk({ hash: 'finished', progress: [1, 2], readingStatus: 'finished' }),
      mk({ hash: 'abandoned', progress: [1, 2], readingStatus: 'abandoned' }),
      mk({ hash: 'noStatusButOpen', progress: [1, 2] }),
      mk({ hash: 'noStatusUnopened' }),
    ];
    const items = await buildBookshelfWidgetItems(
      books,
      defaultWidgetShelf(),
      grid,
      appServiceForBuild,
    );
    expect(
      Object.fromEntries(
        items.map((i) => [i.type === 'book' && i.hash, i.type === 'book' && i.showProgress]),
      ),
    ).toEqual({
      reading: true,
      unread: false,
      finished: false,
      abandoned: false,
      noStatusButOpen: true,
      noStatusUnopened: false,
    });
  });
});

describe('refreshBookshelfWidget', () => {
  // A fresh id range per test, so the module's last-published cache never carries over.
  let base = 0;
  beforeEach(() => {
    base += 10;
  });

  const iosAppService = {
    isMobileApp: true,
    isAndroidApp: false,
    resolveFilePath: vi.fn().mockResolvedValue('/data/Books'),
  } as unknown as import('@/types/system').AppService;
  const androidAppService = { ...iosAppService, isAndroidApp: true } as typeof iosAppService;
  const emptyTitle = 'Empty';

  const instance = (n: number, shelf?: Partial<BookshelfDefinition>): BookshelfWidgetInstance => ({
    appWidgetId: base + n,
    ...DEFAULT_BOOKSHELF_WIDGET_GRID,
    shelf: shelf ? JSON.stringify({ ...defaultWidgetShelf(), ...shelf }) : '',
  });
  const bridge = async () => {
    const { updateBookshelfWidget, getBookshelfWidgetInstances } = await import('@/utils/bridge');
    vi.mocked(updateBookshelfWidget).mockClear();
    return { updateBookshelfWidget, getBookshelfWidgetInstances };
  };

  it('skips when not a mobile app', async () => {
    const { updateBookshelfWidget } = await bridge();
    await refreshBookshelfWidget({ ...iosAppService, isMobileApp: false } as never, emptyTitle);
    expect(updateBookshelfWidget).not.toHaveBeenCalled();
  });

  it('iOS: publishes the default shelf once as appWidgetId 0, never reading instances', async () => {
    const { updateBookshelfWidget, getBookshelfWidgetInstances } = await bridge();
    vi.mocked(getBookshelfWidgetInstances).mockClear();
    await refreshBookshelfWidget(iosAppService, emptyTitle);
    expect(getBookshelfWidgetInstances).not.toHaveBeenCalled();
    expect(updateBookshelfWidget).toHaveBeenCalledWith({
      appWidgetId: 0,
      items: [
        {
          type: 'book',
          hash: 'a',
          title: 'Ta',
          author: 'Aa',
          percent: 50,
          showProgress: true,
          coverPath: '/data/Books/a/cover.png',
        },
      ],
      sectionTitle: '',
      emptyTitle: 'Empty',
    });
  });

  it('Android: is a no-op with zero instances or when reading them fails', async () => {
    const { updateBookshelfWidget, getBookshelfWidgetInstances } = await bridge();
    vi.mocked(getBookshelfWidgetInstances).mockResolvedValueOnce({ instances: [] });
    await refreshBookshelfWidget(androidAppService, emptyTitle);
    vi.mocked(getBookshelfWidgetInstances).mockRejectedValueOnce(new Error('boom'));
    await refreshBookshelfWidget(androidAppService, emptyTitle);
    expect(updateBookshelfWidget).not.toHaveBeenCalled();
  });

  it('Android: publishes each instance with its own shelf, named after the shelf', async () => {
    const { updateBookshelfWidget, getBookshelfWidgetInstances } = await bridge();
    vi.mocked(getBookshelfWidgetInstances).mockResolvedValueOnce({
      instances: [instance(1), instance(2, { name: 'All books', filters: noFilter })],
    });
    await refreshBookshelfWidget(androidAppService, emptyTitle);
    expect(updateBookshelfWidget).toHaveBeenCalledTimes(2);
    expect(updateBookshelfWidget).toHaveBeenCalledWith(
      expect.objectContaining({
        appWidgetId: base + 1,
        sectionTitle: defaultWidgetShelf().name,
        items: [expect.objectContaining({ type: 'book', hash: 'a' })],
      }),
    );
    expect(updateBookshelfWidget).toHaveBeenCalledWith(
      expect.objectContaining({
        appWidgetId: base + 2,
        sectionTitle: 'All books',
        // Default sort is newest first: b (updatedAt 5) before a (updatedAt 2).
        items: [expect.objectContaining({ hash: 'b' }), expect.objectContaining({ hash: 'a' })],
      }),
    );
  });

  it('Android: an exclusive widget takes its books from the others in the same pass', async () => {
    const { updateBookshelfWidget, getBookshelfWidgetInstances } = await bridge();
    vi.mocked(getBookshelfWidgetInstances).mockResolvedValueOnce({
      instances: [instance(2, { filters: noFilter }), instance(1, { exclusive: true })],
    });
    await refreshBookshelfWidget(androidAppService, emptyTitle);
    // Widget 1 claims the currently-reading book 'a'; widget 2 keeps only 'b'.
    const items = (id: number) =>
      vi
        .mocked(updateBookshelfWidget)
        .mock.calls.find(([r]) => r.appWidgetId === id)![0]
        .items.map((i) => i.type === 'book' && i.hash);
    expect(items(base + 1)).toEqual(['a']);
    expect(items(base + 2)).toEqual(['b']);
  });

  it('Android: skips a widget whose snapshot is unchanged, and republishes when it changes', async () => {
    const { updateBookshelfWidget, getBookshelfWidgetInstances } = await bridge();
    const refreshWith = async (...instances: BookshelfWidgetInstance[]) => {
      vi.mocked(getBookshelfWidgetInstances).mockResolvedValueOnce({ instances });
      await refreshBookshelfWidget(androidAppService, emptyTitle);
    };
    await refreshWith(instance(1), instance(2));
    expect(updateBookshelfWidget).toHaveBeenCalledTimes(2);

    await refreshWith(instance(1), instance(2));
    expect(updateBookshelfWidget).toHaveBeenCalledTimes(2);

    await refreshWith(instance(1), instance(2, { filters: noFilter }));
    expect(updateBookshelfWidget).toHaveBeenCalledTimes(3);
    expect(vi.mocked(updateBookshelfWidget).mock.lastCall![0].appWidgetId).toBe(base + 2);
  });

  it.each([
    ['the update rejects', () => new Error('boom')],
    ['native reports a failed tile', undefined],
  ])('Android: retries on the next refresh when %s', async (_name, error) => {
    const { updateBookshelfWidget, getBookshelfWidgetInstances } = await bridge();
    vi.mocked(getBookshelfWidgetInstances).mockResolvedValue({ instances: [instance(1)] });
    if (error) vi.mocked(updateBookshelfWidget).mockRejectedValueOnce(error);
    else vi.mocked(updateBookshelfWidget).mockResolvedValueOnce({ failed: 1 });
    await refreshBookshelfWidget(androidAppService, emptyTitle);
    await refreshBookshelfWidget(androidAppService, emptyTitle);
    expect(updateBookshelfWidget).toHaveBeenCalledTimes(2);
    await refreshBookshelfWidget(androidAppService, emptyTitle);
    expect(updateBookshelfWidget).toHaveBeenCalledTimes(2);
  });

  it('drops a call that arrives while one is already running, instead of racing the unchanged-snapshot cache', async () => {
    const { getBookshelfWidgetInstances } = await bridge();
    vi.mocked(getBookshelfWidgetInstances).mockClear();
    let active = 0;
    let maxActive = 0;
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    vi.mocked(getBookshelfWidgetInstances).mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      if (active === 1) await firstBlocked;
      active--;
      return { instances: [instance(1)] };
    });

    // Two more calls while the first is still reading instances: the trigger
    // that caused this (a debounce, a throttle and an immediate TTS-state
    // publish firing close together) is fine losing them - the next one runs.
    const call1 = refreshBookshelfWidget(androidAppService, emptyTitle);
    await Promise.resolve();
    const call2 = refreshBookshelfWidget(androidAppService, emptyTitle);
    const call3 = refreshBookshelfWidget(androidAppService, emptyTitle);
    releaseFirst();
    await Promise.all([call1, call2, call3]);

    expect(maxActive).toBe(1);
    expect(getBookshelfWidgetInstances).toHaveBeenCalledTimes(1);

    // The guard releases once the run finishes, so a later call still works.
    await refreshBookshelfWidget(androidAppService, emptyTitle);
    expect(getBookshelfWidgetInstances).toHaveBeenCalledTimes(2);
  });

  it("Android: one instance's update rejecting does not stop the other", async () => {
    const { updateBookshelfWidget, getBookshelfWidgetInstances } = await bridge();
    vi.mocked(getBookshelfWidgetInstances).mockResolvedValueOnce({
      instances: [instance(1), instance(2)],
    });
    vi.mocked(updateBookshelfWidget)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ failed: 0 });
    await expect(refreshBookshelfWidget(androidAppService, emptyTitle)).resolves.toBeUndefined();
    expect(updateBookshelfWidget).toHaveBeenCalledTimes(2);
  });
});
