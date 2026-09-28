import { beforeEach, describe, it, expect, vi } from 'vitest';
import { HlcGenerator } from '@/libs/crdt';
import {
  buildBookshelfWidgetCatalog,
  buildBookshelfWidgetItems,
  buildBookshelfWidgetSnapshot,
  evaluateWidgetShelves,
  refreshBookshelfWidget,
} from '@/services/widget/bookshelfWidget';
import {
  createBookshelf,
  defaultBookshelves,
  FINISHED_BOOKSHELF_ID,
  RECENT_BOOKSHELF_ID,
} from '@/services/bookshelves/definitions';
import { applyBookshelfDraft } from '@/services/bookshelves/state';
import type { Book, BooksGroup } from '@/types/book';
import type { BookshelfDefinition } from '@/types/bookshelf';
import type { SystemSettings } from '@/types/settings';
import type { AppService } from '@/types/system';
import type { BookshelfWidgetInstance } from '@/utils/bridge';

const state = vi.hoisted(() => ({
  library: [] as Book[],
  settings: {} as Partial<SystemSettings>,
}));

vi.mock('@/utils/bridge', () => ({
  updateBookshelfWidget: vi.fn().mockResolvedValue({ failed: 0 }),
  getBookshelfWidgetInstances: vi.fn().mockResolvedValue({ instances: [] }),
  setBookshelfWidgetCatalog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: { getState: () => ({ library: state.library }) },
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ settings: state.settings }) },
}));

const _ = (key: string) => `t:${key}`;

const mk = (over: Partial<Book>): Book =>
  ({ hash: 'h', title: 'T', author: 'A', format: 'EPUB', updatedAt: 0, ...over }) as Book;

const reading = (hash: string, updatedAt: number) =>
  mk({ hash, updatedAt, progress: [1, 2], readingStatus: 'reading' });

const clock = new HlcGenerator('test', () => 100);
/** Settings holding the default shelves plus `extra`, as saved by the Bookshelves editor. */
const settingsWith = (...extra: BookshelfDefinition[]): Partial<SystemSettings> => {
  const base = defaultBookshelves({});
  const { state: bookshelves } = applyBookshelfDraft({ rows: {} }, base, [...base, ...extra], {
    userId: 'u',
    deviceId: 'test',
    next: () => clock.next(),
  });
  return { bookshelves };
};

const sciFi: BookshelfDefinition = {
  ...createBookshelf('Sci-fi', '11111111-1111-4111-8111-111111111111'),
  exclusive: true,
  filters: {
    type: 'group',
    match: 'all',
    children: [
      { type: 'rule', field: 'tags', kind: 'collection', operator: 'contains', value: 'sf' },
    ],
  },
};

const appService = {
  isMobileApp: true,
  isAndroidApp: true,
  resolveFilePath: vi.fn().mockResolvedValue('/data/Books'),
} as unknown as AppService;

const hashesOf = (items: Awaited<ReturnType<typeof buildBookshelfWidgetItems>>) =>
  items.map((item) => (item.type === 'book' ? item.hash : `group:${item.value}`));

describe('evaluateWidgetShelves', () => {
  const library = [
    reading('r1', 3),
    mk({ hash: 's1', updatedAt: 2, tags: ['sf'] }),
    mk({ hash: 'f1', updatedAt: 1, readingStatus: 'finished' }),
  ];

  it('evaluates a shelf with the Library exclusivity rules', () => {
    const shelfFor = evaluateWidgetShelves(library, settingsWith(sciFi), [sciFi.id, 'default']);
    expect(shelfFor(sciFi.id).books.map((b) => b.hash)).toEqual(['s1']);
    // The exclusive Sci-fi shelf owns s1, so Default no longer shows it.
    expect(shelfFor('default').books.map((b) => b.hash)).not.toContain('s1');
  });

  it('falls back to Recently read for a shelf that no longer exists', () => {
    const shelfFor = evaluateWidgetShelves(library, settingsWith(), [sciFi.id]);
    expect(shelfFor(sciFi.id).definition.id).toBe(RECENT_BOOKSHELF_ID);
    expect(shelfFor(sciFi.id).books.map((b) => b.hash)).toEqual(['r1']);
  });

  it('still shows a shelf that is hidden in the Library', () => {
    // Finished books is disabled by default.
    const shelfFor = evaluateWidgetShelves(library, settingsWith(), [FINISHED_BOOKSHELF_ID]);
    expect(shelfFor(FINISHED_BOOKSHELF_ID).books.map((b) => b.hash)).toEqual(['f1']);
  });
});

describe('buildBookshelfWidgetItems', () => {
  const covers = (hash: string) => `/data/Books/${hash}/cover.png`;

  it('percent is current/total rounded and clamped to 0-100, and 0 without progress', async () => {
    const books = [
      mk({ hash: 'a', progress: [72, 100] }),
      mk({ hash: 'b', progress: [1, 3] }),
      mk({ hash: 'c', progress: [120, 100] }),
      mk({ hash: 'd' }),
      mk({ hash: 'e', progress: [1, 0] }),
    ];
    const items = await buildBookshelfWidgetItems(books, 'series', appService);
    expect(items.map((i) => i.type === 'book' && i.percent)).toEqual([72, 33, 100, 0, 0]);
  });

  it('a group tile shows its translated name and up to 4 member covers', async () => {
    const group = {
      id: 'g1',
      name: 'reading',
      displayName: 'Reading',
      books: ['a', 'b', 'c', 'd', 'e'].map((hash) => mk({ hash })),
    } as BooksGroup;
    expect(await buildBookshelfWidgetItems([group], 'status', appService)).toEqual([
      {
        type: 'group',
        id: 'g1',
        groupBy: 'status',
        value: 'Reading',
        coverPaths: ['a', 'b', 'c', 'd'].map(covers),
      },
    ]);
  });

  it('showProgress is true only for a book being read now', async () => {
    const items = await buildBookshelfWidgetItems(
      [reading('r', 1), mk({ hash: 'f', progress: [1, 2], readingStatus: 'finished' })],
      'none',
      appService,
    );
    expect(items.map((i) => i.type === 'book' && i.showProgress)).toEqual([true, false]);
  });
});

describe('buildBookshelfWidgetSnapshot', () => {
  const library = [reading('r1', 1), reading('r2', 2), reading('r3', 3), reading('r4', 4)];
  const grid = { gridRows: 1, gridColumns: 3 };

  it('shows the newest currently-read books, cut to the grid, with no heading for Recently read', async () => {
    const settings = settingsWith();
    const result = evaluateWidgetShelves(library, settings, [RECENT_BOOKSHELF_ID])(
      RECENT_BOOKSHELF_ID,
    );
    const snapshot = await buildBookshelfWidgetSnapshot(result, RECENT_BOOKSHELF_ID, grid, {
      settings,
      appService,
      _,
      emptyTitle: 'Empty',
    });
    expect(hashesOf(snapshot.items)).toEqual(['r4', 'r3', 'r2']);
    expect(snapshot.sectionTitle).toBe('');
    expect(snapshot.shelfId).toBe(RECENT_BOOKSHELF_ID);
    expect(snapshot.emptyTitle).toBe('Empty');
  });

  it('names any other shelf, translating a built-in one', async () => {
    const settings = settingsWith(sciFi);
    const shelfFor = evaluateWidgetShelves(library, settings, [sciFi.id, 'default']);
    const build = (id: string) =>
      buildBookshelfWidgetSnapshot(shelfFor(id), id, grid, {
        settings,
        appService,
        _,
        emptyTitle: '',
      });
    expect((await build(sciFi.id)).sectionTitle).toBe('Sci-fi');
    expect((await build('default')).sectionTitle).toBe('t:Default');
  });

  it('echoes the requested shelf id even when it fell back to Recently read', async () => {
    const settings = settingsWith();
    const result = evaluateWidgetShelves(library, settings, [sciFi.id])(sciFi.id);
    const snapshot = await buildBookshelfWidgetSnapshot(result, sciFi.id, grid, {
      settings,
      appService,
      _,
      emptyTitle: '',
    });
    expect(snapshot.shelfId).toBe(sciFi.id);
  });

  it('includes tts only when the playing book is one of the tiles shown', async () => {
    const settings = settingsWith();
    const result = evaluateWidgetShelves(library, settings, [RECENT_BOOKSHELF_ID])(
      RECENT_BOOKSHELF_ID,
    );
    const build = (bookHash: string) =>
      buildBookshelfWidgetSnapshot(result, RECENT_BOOKSHELF_ID, grid, {
        settings,
        appService,
        _,
        emptyTitle: '',
        playback: { active: true, playing: false, bookHash },
      });
    expect((await build('r4')).tts).toEqual({ active: true, playing: false });
    // r1 matches the shelf but falls outside the 1x3 grid.
    expect((await build('r1')).tts).toBeUndefined();
  });
});

describe('buildBookshelfWidgetCatalog', () => {
  it('lists every shelf in Library order, naming built-ins in the UI language', () => {
    const catalog = buildBookshelfWidgetCatalog(settingsWith(sciFi), _);
    expect(catalog.shelves[0]).toEqual({ id: RECENT_BOOKSHELF_ID, name: 't:Recently read' });
    expect(catalog.shelves).toContainEqual({ id: sciFi.id, name: 'Sci-fi' });
    expect(catalog.shelves).toContainEqual({ id: FINISHED_BOOKSHELF_ID, name: 't:Finished books' });
    expect(catalog.labels.save).toBe('t:Save');
  });
});

describe('refreshBookshelfWidget', () => {
  // A fresh id range per test, so the module's last-published cache never carries over.
  let base = 0;
  beforeEach(async () => {
    base += 10;
    state.library = [reading('r1', 1), reading('r2', 2)];
    state.settings = settingsWith(sciFi);
    const bridge = await import('@/utils/bridge');
    vi.mocked(bridge.updateBookshelfWidget).mockClear();
    vi.mocked(bridge.getBookshelfWidgetInstances).mockClear();
    vi.mocked(bridge.setBookshelfWidgetCatalog).mockClear();
  });

  const instance = (n: number, shelfId = RECENT_BOOKSHELF_ID): BookshelfWidgetInstance => ({
    appWidgetId: base + n,
    shelfId,
    gridRows: 1,
    gridColumns: 3,
  });

  it('skips when not a mobile app', async () => {
    const { updateBookshelfWidget } = await import('@/utils/bridge');
    await refreshBookshelfWidget({ ...appService, isMobileApp: false } as AppService, _);
    expect(updateBookshelfWidget).not.toHaveBeenCalled();
  });

  it('iOS: publishes Recently read once as appWidgetId 0, never reading instances', async () => {
    const bridge = await import('@/utils/bridge');
    await refreshBookshelfWidget({ ...appService, isAndroidApp: false } as AppService, _);
    expect(bridge.getBookshelfWidgetInstances).not.toHaveBeenCalled();
    expect(bridge.setBookshelfWidgetCatalog).not.toHaveBeenCalled();
    const request = vi.mocked(bridge.updateBookshelfWidget).mock.lastCall![0];
    expect(request.appWidgetId).toBe(0);
    expect(hashesOf(request.items)).toEqual(['r2', 'r1']);
  });

  it('Android: publishes the shelf catalog even before any widget is placed', async () => {
    const bridge = await import('@/utils/bridge');
    state.settings = settingsWith({ ...sciFi, name: `Sci-fi ${base}` });
    await refreshBookshelfWidget(appService, _);
    expect(bridge.setBookshelfWidgetCatalog).toHaveBeenCalledTimes(1);
    expect(bridge.updateBookshelfWidget).not.toHaveBeenCalled();

    // Unchanged: not written again.
    await refreshBookshelfWidget(appService, _);
    expect(bridge.setBookshelfWidgetCatalog).toHaveBeenCalledTimes(1);
  });

  it('Android: publishes each widget with its own shelf', async () => {
    const bridge = await import('@/utils/bridge');
    state.library = [reading('r1', 1), mk({ hash: 's1', tags: ['sf'] })];
    vi.mocked(bridge.getBookshelfWidgetInstances).mockResolvedValueOnce({
      instances: [instance(1), instance(2, sciFi.id)],
    });
    await refreshBookshelfWidget(appService, _);
    const requests = vi.mocked(bridge.updateBookshelfWidget).mock.calls.map(([r]) => r);
    expect(requests.map((r) => [r.appWidgetId, r.shelfId, hashesOf(r.items)])).toEqual([
      [base + 1, RECENT_BOOKSHELF_ID, ['r1']],
      [base + 2, sciFi.id, ['s1']],
    ]);
  });

  it('Android: skips an unchanged snapshot, but retries one that had failed tiles', async () => {
    const bridge = await import('@/utils/bridge');
    vi.mocked(bridge.getBookshelfWidgetInstances).mockResolvedValue({ instances: [instance(1)] });
    vi.mocked(bridge.updateBookshelfWidget).mockResolvedValueOnce({ failed: 1 });
    await refreshBookshelfWidget(appService, _);
    await refreshBookshelfWidget(appService, _);
    await refreshBookshelfWidget(appService, _);
    expect(bridge.updateBookshelfWidget).toHaveBeenCalledTimes(2);
    vi.mocked(bridge.getBookshelfWidgetInstances).mockResolvedValue({ instances: [] });
  });

  it("Android: one widget's update rejecting does not stop the other", async () => {
    const bridge = await import('@/utils/bridge');
    vi.mocked(bridge.getBookshelfWidgetInstances).mockResolvedValueOnce({
      instances: [instance(1), instance(2)],
    });
    vi.mocked(bridge.updateBookshelfWidget)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ failed: 0 });
    await refreshBookshelfWidget(appService, _);
    expect(bridge.updateBookshelfWidget).toHaveBeenCalledTimes(2);
  });

  it('coalesces calls made while a refresh runs, and settles them after the rerun', async () => {
    const bridge = await import('@/utils/bridge');
    let release: (() => void) | undefined;
    vi.mocked(bridge.getBookshelfWidgetInstances)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ instances: [instance(1)] });
          }),
      )
      .mockResolvedValueOnce({ instances: [instance(1)] });
    const first = refreshBookshelfWidget(appService, _);
    await vi.waitFor(() => expect(release).toBeDefined());
    state.library = [reading('r3', 3)];
    const second = refreshBookshelfWidget(appService, _);
    const third = refreshBookshelfWidget(appService, _);
    release!();
    await Promise.all([first, second, third]);
    expect(bridge.getBookshelfWidgetInstances).toHaveBeenCalledTimes(2);
    expect(hashesOf(vi.mocked(bridge.updateBookshelfWidget).mock.lastCall![0].items)).toEqual([
      'r3',
    ]);
  });
});
