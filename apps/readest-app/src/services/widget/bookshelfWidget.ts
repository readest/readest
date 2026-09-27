import type { Book, BooksGroup } from '@/types/book';
import type { AppService } from '@/types/system';
import type { BookshelfDefinition } from '@/types/bookshelf';
import { useLibraryStore } from '@/store/libraryStore';
import { LibraryGroupByType } from '@/types/settings';
import { getCoverFilename, isCurrentlyReadingBook } from '@/utils/book';
import { getBookshelfWidgetInstances, updateBookshelfWidget } from '@/utils/bridge';
import { joinScannedPath } from '@/utils/path';
import type {
  BookshelfWidgetInstance,
  BookshelfWidgetTts,
  UpdateBookshelfWidgetRequest,
} from '@/utils/bridge';
import {
  bookshelfSchema,
  createBookshelf,
  defaultBookshelves,
  RECENT_BOOKSHELF_ID,
} from '@/services/bookshelves/definitions';
import { evaluateBookshelves, type BookshelfResult } from '@/services/bookshelves/evaluate';
import { presentBookshelf } from '@/services/bookshelves/presentation';

/** What one instance publishes: everything but the widget id. */
export type BookshelfWidgetSnapshot = Omit<UpdateBookshelfWidgetRequest, 'appWidgetId'>;

export const MIN_GRID_SIZE = 1;
export const MAX_GRID_SIZE = 5;

/** The widget-only settings an instance keeps next to its shelf. */
export type BookshelfWidgetGridSettings = Pick<
  BookshelfWidgetInstance,
  'gridRows' | 'gridColumns' | 'showTitles' | 'groupMosaic'
>;

/** A single row of up to 3 covers, no titles. */
export const DEFAULT_BOOKSHELF_WIDGET_GRID: BookshelfWidgetGridSettings = {
  gridRows: 1,
  gridColumns: 3,
  showTitles: false,
  groupMosaic: true,
};

const ensureGridDimension = (value: number): number => {
  if (!Number.isFinite(value)) return MIN_GRID_SIZE;
  return Math.min(MAX_GRID_SIZE, Math.max(MIN_GRID_SIZE, Math.round(value)));
};

/** A widget-owned shelf never inherits the app's View-menu sort/grouping. Its
 * name is the widget's heading, and blank means no heading. */
export const normalizeWidgetShelf = (shelf: BookshelfDefinition): BookshelfDefinition => ({
  ...shelf,
  name: shelf.name.trim(),
  enabled: true,
  useGlobalSort: false,
  useGlobalGrouping: false,
  groupBy: shelf.groupBy ?? LibraryGroupByType.None,
});

/** Books being read now, newest first, ungrouped, with no heading (the Recent shelf's filter). */
export const defaultWidgetShelf = (): BookshelfDefinition => {
  const recent = defaultBookshelves({}).find((shelf) => shelf.id === RECENT_BOOKSHELF_ID)!;
  return {
    ...createBookshelf(''),
    filters: recent.filters,
    useGlobalSort: false,
    useGlobalGrouping: false,
    groupBy: LibraryGroupByType.None,
  };
};

// The shelf schema rejects a blank name for a custom shelf, but a blank name is
// how a widget hides its heading. Validate and evaluate with a stand-in name.
const withSchemaName = (shelf: BookshelfDefinition): BookshelfDefinition =>
  shelf.name.trim() ? shelf : { ...shelf, name: 'Widget' };

/** Whether a widget shelf is complete enough to save and show (a new filter
 * condition is invalid until its value is filled in). */
export const checkWidgetShelf = (shelf: BookshelfDefinition) =>
  bookshelfSchema.safeParse(withSchemaName(shelf));

/** Parses an instance's stored shelf JSON, falling back to the default shelf
 * when it is empty, malformed or no longer valid. */
export const parseWidgetShelf = (json: string): BookshelfDefinition => {
  try {
    const raw = JSON.parse(json) as BookshelfDefinition;
    const parsed = bookshelfSchema.safeParse(withSchemaName(raw));
    if (parsed.success) return normalizeWidgetShelf({ ...parsed.data, name: raw.name });
  } catch {
    // Empty, malformed or not an object: use the default below.
  }
  return defaultWidgetShelf();
};

/**
 * Evaluates every widget's shelf together, so exclusive widgets claim their
 * books from the others exactly as exclusive shelves do in the app. The older
 * widget (lower id) wins a book two exclusive widgets both match; ids are
 * sorted because the platform lists them in no defined order.
 */
export const evaluateWidgetShelves = (
  library: Book[],
  entries: { appWidgetId: number; shelf: BookshelfDefinition }[],
): Map<number, BookshelfResult> => {
  const sorted = [...entries].sort((a, b) => a.appWidgetId - b.appWidgetId);
  // Ownership needs unique ids, but parsed shelves carry random ones and the
  // schema only accepts UUIDs, so derive a valid one from the widget id.
  const definitions = sorted.map(({ appWidgetId, shelf }) => ({
    ...withSchemaName(shelf),
    id: `00000000-0000-4000-8000-${appWidgetId.toString(16).padStart(12, '0')}`,
  }));
  // No React context here for the user's UI language, so uiLanguage stays ''.
  const results = evaluateBookshelves(library, definitions);
  return new Map(sorted.map(({ appWidgetId }, i) => [appWidgetId, results[i]!]));
};

// Pass `resolvedBooksDir` when it is already resolved.
const resolveBooksDir = async (
  appService: AppService,
  resolvedBooksDir?: string,
): Promise<string> => resolvedBooksDir ?? (await appService.resolveFilePath('', 'Books'));

/** Resolves each tile to what native renders: books get their cover file and
 * progress, groups up to 4 member covers (1 without mosaic), which native
 * composites into a mosaic like the Library's group tile. */
export const buildBookshelfWidgetItems = async (
  items: (Book | BooksGroup)[],
  shelf: BookshelfDefinition,
  grid: BookshelfWidgetGridSettings,
  appService: AppService,
  resolvedBooksDir?: string,
): Promise<BookshelfWidgetSnapshot['items']> => {
  const booksDir = await resolveBooksDir(appService, resolvedBooksDir);
  const coverPath = (book: Book) => joinScannedPath(booksDir, getCoverFilename(book));
  const memberLimit = grid.groupMosaic ? 4 : 1;
  return items.map((item) => {
    if ('books' in item) {
      return {
        type: 'group',
        id: item.id,
        groupBy: shelf.groupBy ?? LibraryGroupByType.None,
        value: item.name,
        coverPaths: item.books.slice(0, memberLimit).map(coverPath),
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
 * instances get the transport bar. */
export type BookshelfWidgetPlayback = BookshelfWidgetTts & { bookHash: string };

/** One widget's snapshot: its tiles in display order, with the transport bar
 * (`tts`) only when the playing book is one of the shown tiles - a loose book,
 * or a member of a shown group - not just anywhere in the shelf's matches. */
export const buildBookshelfWidgetSnapshot = async (
  result: BookshelfResult,
  shelf: BookshelfDefinition,
  grid: BookshelfWidgetGridSettings,
  appService: AppService,
  emptyTitle: string,
  playback?: BookshelfWidgetPlayback,
  resolvedBooksDir?: string,
): Promise<BookshelfWidgetSnapshot> => {
  // The Library's presentation cut to the grid (rows x columns, each clamped to
  // the allowed size).
  const capacity = ensureGridDimension(grid.gridRows) * ensureGridDimension(grid.gridColumns);
  const items = presentBookshelf(result, {}, '').slice(0, capacity);
  const isShown = (hash: string) =>
    items.some((item) =>
      'books' in item ? item.books.some((b) => b.hash === hash) : item.hash === hash,
    );
  const tts =
    playback && isShown(playback.bookHash)
      ? { active: playback.active, playing: playback.playing }
      : undefined;
  return {
    items: await buildBookshelfWidgetItems(items, shelf, grid, appService, resolvedBooksDir),
    sectionTitle: shelf.name,
    emptyTitle,
    ...(tts ? { tts } : {}),
  };
};

// The snapshot last pushed for each widget, when every tile made it. Native
// re-encodes every thumbnail on a push, so an unchanged snapshot is not sent
// again. Per JS session: a fresh launch always pushes.
const lastPublished = new Map<number, string>();

// Serializes overlapping calls (debounce/throttle/TTS triggers can land close
// together) so they don't race the lastPublished cache below. A call mid-run
// is queued (coalesced to the latest) and its promise settles only once that
// rerun finishes, so Save - which backgrounds the app right after awaiting
// this, with no other trigger to retry - isn't dropped or resolved early.
let running = false;
// Args overwrite to the latest queued call; promise/resolve are shared so
// every queued caller settles together after the one rerun below.
let pending: {
  args: Parameters<typeof refreshBookshelfWidget>;
  promise: Promise<void>;
  resolve: () => void;
} | null = null;

export const refreshBookshelfWidget = async (
  appService: AppService,
  emptyTitle: string,
  playback?: BookshelfWidgetPlayback,
): Promise<void> => {
  if (running) {
    const args: Parameters<typeof refreshBookshelfWidget> = [appService, emptyTitle, playback];
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

    let targets: {
      appWidgetId: number;
      shelf: BookshelfDefinition;
      grid: BookshelfWidgetGridSettings;
    }[];
    if (appService.isAndroidApp) {
      let instances: BookshelfWidgetInstance[];
      try {
        ({ instances } = await getBookshelfWidgetInstances());
      } catch (err) {
        console.warn('Failed to read bookshelf widget instances', err);
        return;
      }
      targets = instances.map((instance) => ({
        appWidgetId: instance.appWidgetId,
        shelf: parseWidgetShelf(instance.shelf),
        grid: instance,
      }));
    } else {
      // iOS has no per-instance configurable widget yet: one default snapshot.
      targets = [
        { appWidgetId: 0, shelf: defaultWidgetShelf(), grid: DEFAULT_BOOKSHELF_WIDGET_GRID },
      ];
    }
    for (const id of lastPublished.keys()) {
      if (!targets.some((target) => target.appWidgetId === id)) lastPublished.delete(id);
    }
    if (targets.length === 0) return;

    const booksDir = await resolveBooksDir(appService);
    const results = evaluateWidgetShelves(library, targets);

    await Promise.all(
      targets.map(async (target) => {
        const snapshot = await buildBookshelfWidgetSnapshot(
          results.get(target.appWidgetId)!,
          target.shelf,
          target.grid,
          appService,
          emptyTitle,
          playback,
          booksDir,
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
    if (next) await refreshBookshelfWidget(...next.args);
    next?.resolve();
  }
};
