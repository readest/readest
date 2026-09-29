import type { Book, BooksGroup } from '@/types/book';
import type { AppService } from '@/types/system';
import type { BookshelfDefinition } from '@/types/bookshelf';
import { LibraryGroupByType, type SystemSettings } from '@/types/settings';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { getCoverFilename, isCurrentlyReadingBook } from '@/utils/book';
import {
  getBookshelfWidgetInstances,
  setBookshelfWidgetCatalog,
  updateBookshelfWidget,
} from '@/utils/bridge';
import { joinScannedPath } from '@/utils/path';
import type {
  BookshelfWidgetCatalog,
  BookshelfWidgetInstance,
  BookshelfWidgetTts,
  UpdateBookshelfWidgetRequest,
} from '@/utils/bridge';
import { bookshelfName, RECENT_BOOKSHELF_ID } from '@/services/bookshelves/definitions';
import { evaluateBookshelves, type BookshelfResult } from '@/services/bookshelves/evaluate';
import { resolveBookshelfGroupBy } from '@/services/bookshelves/grouping';
import { presentBookshelf } from '@/services/bookshelves/presentation';
import { getGlobalBookshelfSort, resolveBookshelfSort } from '@/services/bookshelves/sorting';
import { readBookshelves } from '@/services/bookshelves/state';

type Translate = (key: string) => string;

/** What one widget publishes: everything but its id. */
export type BookshelfWidgetSnapshot = Omit<UpdateBookshelfWidgetRequest, 'appWidgetId'>;

type BookshelfWidgetGrid = Pick<BookshelfWidgetInstance, 'gridRows' | 'gridColumns'>;

const MAX_GRID_SIZE = 5;
const clampGrid = (value: number) => Math.min(MAX_GRID_SIZE, Math.max(1, Math.round(value) || 1));

/** The old "currently reading" widget; iOS always shows this. */
const DEFAULT_WIDGET: Omit<BookshelfWidgetInstance, 'appWidgetId'> = {
  shelfId: RECENT_BOOKSHELF_ID,
  gridRows: 1,
  gridColumns: 3,
};

const shelfTitle = (shelf: BookshelfDefinition, _: Translate) =>
  shelf.name || _(bookshelfName(shelf));

/**
 * Evaluates the Library's shelves (same sort and exclusivity) and returns a
 * lookup from a widget's shelf id to its books. A shelf shown on a widget is
 * evaluated even while hidden in the Library, and a deleted one falls back to
 * Recently read.
 */
export const evaluateWidgetShelves = (
  library: Book[],
  settings: Partial<SystemSettings>,
  shelfIds: string[],
): ((shelfId: string) => BookshelfResult) => {
  const shelves = readBookshelves(settings);
  const resolve = (id: string) => (shelves.some((s) => s.id === id) ? id : RECENT_BOOKSHELF_ID);
  const shown = new Set(shelfIds.map(resolve));
  const globalSort = getGlobalBookshelfSort(settings);
  const definitions = shelves.map((shelf) => ({
    ...shelf,
    enabled: shelf.enabled || shown.has(shelf.id),
    sort: resolveBookshelfSort(shelf, globalSort),
  }));
  const results = new Map(
    evaluateBookshelves(library, definitions).map((result) => [result.definition.id, result]),
  );
  return (shelfId) => results.get(resolve(shelfId))!;
};

// Pass `resolvedBooksDir` when it is already resolved.
const resolveBooksDir = async (
  appService: AppService,
  resolvedBooksDir?: string,
): Promise<string> => resolvedBooksDir ?? (await appService.resolveFilePath('', 'Books'));

/** Resolves each tile to what native renders: books get their cover file and
 * progress, groups up to 4 member covers, which native composites into a
 * mosaic like the Library's group tile. */
export const buildBookshelfWidgetItems = async (
  items: (Book | BooksGroup)[],
  groupBy: string,
  appService: AppService,
  resolvedBooksDir?: string,
): Promise<BookshelfWidgetSnapshot['items']> => {
  const booksDir = await resolveBooksDir(appService, resolvedBooksDir);
  const coverPath = (book: Book) => joinScannedPath(booksDir, getCoverFilename(book));
  return items.map((item) => {
    if ('books' in item) {
      return {
        type: 'group',
        id: item.id,
        groupBy,
        value: item.displayName || item.name,
        coverPaths: item.books.slice(0, 4).map(coverPath),
      };
    }
    const [current, total] = item.progress ?? [];
    return {
      type: 'book',
      hash: item.hash,
      title: item.title ?? '',
      author: item.author ?? '',
      percent:
        total && total > 0
          ? Math.min(100, Math.max(0, Math.round(((current ?? 0) / total) * 100)))
          : 0,
      // Only a book being read now shows the progress bar/percent badge.
      showProgress: isCurrentlyReadingBook(item),
      coverPath: coverPath(item),
    };
  });
};

/** A playing TTS session plus the book it is reading, which decides which
 * widgets get the transport bar. */
export type BookshelfWidgetPlayback = BookshelfWidgetTts & { bookHash: string };

/** One widget's snapshot: its shelf as the Library presents it, cut to the
 * grid, with the transport bar only when the playing book is one of the tiles
 * shown (a loose book or a member of a shown group). `shelfId` is the one the
 * widget asked for, so native can tell a snapshot of its current shelf. */
export const buildBookshelfWidgetSnapshot = async (
  result: BookshelfResult,
  shelfId: string,
  grid: BookshelfWidgetGrid,
  options: {
    settings: Partial<SystemSettings>;
    appService: AppService;
    _: Translate;
    emptyTitle: string;
    playback?: BookshelfWidgetPlayback;
    booksDir?: string;
  },
): Promise<BookshelfWidgetSnapshot> => {
  const { settings, appService, _, emptyTitle, playback, booksDir } = options;
  const capacity = clampGrid(grid.gridRows) * clampGrid(grid.gridColumns);
  const items = presentBookshelf(result, settings, '').slice(0, capacity);
  const isShown = (hash: string) =>
    items.some((item) =>
      'books' in item ? item.books.some((b) => b.hash === hash) : item.hash === hash,
    );
  const tts =
    playback && isShown(playback.bookHash)
      ? { active: playback.active, playing: playback.playing }
      : undefined;
  const { definition } = result;
  const groupBy = resolveBookshelfGroupBy(
    definition,
    settings.libraryGroupBy || LibraryGroupByType.Group,
  );
  return {
    shelfId,
    items: await buildBookshelfWidgetItems(items, groupBy, appService, booksDir),
    // Heading visibility is the native-only showShelfName setting; the name is always sent.
    sectionTitle: shelfTitle(definition, _),
    emptyTitle,
    ...(tts ? { tts } : {}),
  };
};

/** The shelves and translated labels the native configure screen offers. */
export const buildBookshelfWidgetCatalog = (
  settings: Partial<SystemSettings>,
  _: Translate,
): BookshelfWidgetCatalog => ({
  shelves: readBookshelves(settings).map((shelf) => ({
    id: shelf.id,
    name: shelfTitle(shelf, _),
  })),
  labels: {
    title: _('Bookshelf'),
    rows: _('Rows'),
    columns: _('Columns'),
    showTitles: _('Book title'),
    showShelfName: _('Shelf name'),
    cancel: _('Cancel'),
    save: _('Save'),
    edit: _('Edit'),
    openApp: _('Open Readest to show this bookshelf'),
  },
});

// What was last pushed, when it fully succeeded. Native re-encodes every
// thumbnail on a push, so an unchanged snapshot is not sent again. Per JS
// session: a fresh launch always pushes.
const lastPublished = new Map<number, string>();
let lastCatalog = '';

// Serializes overlapping calls (debounce/throttle/TTS triggers can land close
// together) so they don't race the caches above. A call mid-run is queued
// (coalesced to the latest) and its promise settles once that rerun finishes.
let running = false;
let pending: {
  args: Parameters<typeof refreshBookshelfWidget>;
  promise: Promise<void>;
  resolve: () => void;
} | null = null;

export const refreshBookshelfWidget = async (
  appService: AppService,
  _: Translate,
  playback?: BookshelfWidgetPlayback,
): Promise<void> => {
  if (running) {
    const args: Parameters<typeof refreshBookshelfWidget> = [appService, _, playback];
    if (pending) {
      pending.args = args;
    } else {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => (resolve = r));
      pending = { args, promise, resolve };
    }
    return pending.promise;
  }
  running = true;
  try {
    if (!appService.isMobileApp) return;
    const library = useLibraryStore.getState().library;
    const { settings } = useSettingsStore.getState();

    let targets: BookshelfWidgetInstance[];
    if (appService.isAndroidApp) {
      // Published even with no widget placed: the configure screen reads it.
      const catalog = buildBookshelfWidgetCatalog(settings, _);
      const catalogJson = JSON.stringify(catalog);
      if (catalogJson !== lastCatalog) {
        try {
          await setBookshelfWidgetCatalog(catalog);
          lastCatalog = catalogJson;
        } catch (err) {
          console.warn('Failed to publish bookshelf widget catalog', err);
        }
      }
      try {
        ({ instances: targets } = await getBookshelfWidgetInstances());
      } catch (err) {
        console.warn('Failed to read bookshelf widget instances', err);
        return;
      }
    } else {
      // iOS has no configurable widget yet: one default snapshot.
      targets = [{ appWidgetId: 0, ...DEFAULT_WIDGET }];
    }
    for (const id of lastPublished.keys()) {
      if (!targets.some((target) => target.appWidgetId === id)) lastPublished.delete(id);
    }
    if (targets.length === 0) return;

    const booksDir = await resolveBooksDir(appService);
    const shelfFor = evaluateWidgetShelves(
      library,
      settings,
      targets.map((target) => target.shelfId),
    );
    const emptyTitle = _('Your books will appear here');

    await Promise.all(
      targets.map(async (target) => {
        const snapshot = await buildBookshelfWidgetSnapshot(
          shelfFor(target.shelfId),
          target.shelfId,
          target,
          { settings, appService, _, emptyTitle, playback, booksDir },
        );
        const request = { ...snapshot, appWidgetId: target.appWidgetId };
        const fingerprint = JSON.stringify(request);
        if (lastPublished.get(target.appWidgetId) === fingerprint) return;
        try {
          const { failed } = await updateBookshelfWidget(request);
          // A tile that failed (e.g. its cover isn't downloaded yet) is retried next time.
          if (failed === 0) lastPublished.set(target.appWidgetId, fingerprint);
          else lastPublished.delete(target.appWidgetId);
        } catch (err) {
          lastPublished.delete(target.appWidgetId);
          console.warn('Failed to update bookshelf widget', target.appWidgetId, err);
        }
      }),
    );
  } finally {
    running = false;
    const next = pending;
    pending = null;
    if (next) {
      try {
        await refreshBookshelfWidget(...next.args);
      } finally {
        next.resolve();
      }
    }
  }
};
