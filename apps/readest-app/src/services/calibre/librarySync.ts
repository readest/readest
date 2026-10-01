import type { CalibreBookJson, CalibreServer } from '@/types/calibre';
import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';
import { createCalibreClient } from '@/services/calibre/client';
import {
  buildCalibreBookMetadata,
  hydrateCalibreBookFields,
  makeCalibreFilePath,
  parseCalibreFilePath,
  pickPreferredFormat,
} from '@/utils/calibre';
import { getCoverFilename } from '@/utils/book';
import { md5 } from '@/utils/md5';
import { stubTranslation as _ } from '@/utils/misc';
import { eventDispatcher } from '@/utils/event';
import { useCalibreServerStore } from '@/store/calibreServerStore';
import { useCalibreSyncProgressStore } from '@/store/calibreSyncStore';
import { useLibraryStore } from '@/store/libraryStore';

/** Parallel cover downloads during a sync pass. */
const COVER_CONCURRENCY = 4;

/** Source identity of one server book inside the reconcile input. */
export interface CalibreServerBook {
  id: string;
  json: CalibreBookJson;
}

const sourceKey = (libraryId: string, bookId: string): string => `${libraryId}/${bookId}`;

/**
 * Pure: compute the library delta for one server. Exported for tests.
 *
 * Matching is by `metadata.calibreSource` identity (downloaded copies) and by
 * the synthetic `calibre://` filePath (stubs). A book whose sync stub was
 * already downloaded is a normal local book now — reconcile leaves it alone
 * forever (local wins), and tombstones only ever hit undownloaded stubs.
 */
export const reconcileCalibreBooks = (input: {
  server: Pick<CalibreServer, 'id'>;
  libraryId: string;
  serverBooks: CalibreServerBook[];
  library: Book[];
  now: number;
  /**
   * Calibre-Web shelves, as bookId → shelf name. Backfill-only: a book's
   * groupName is set once and never overwritten, so the user's own manual
   * folder grouping always wins over server shelves.
   */
  getGroupName?: (bookId: string) => string | undefined;
}): { upserts: Book[]; tombstoneHashes: string[] } => {
  const { server, libraryId, serverBooks, library, now, getGroupName } = input;

  // Books of THIS server only: stubs by filePath, downloaded by metadata.
  const stubsBySource = new Map<string, Book>();
  const downloadedBySource = new Set<string>();
  for (const book of library) {
    const parsed = parseCalibreFilePath(book.filePath);
    if (parsed && parsed.serverId === server.id) {
      stubsBySource.set(sourceKey(parsed.libraryId, parsed.bookId), book);
      continue;
    }
    const source = book.metadata?.calibreSource;
    if (source && source.serverId === server.id) {
      downloadedBySource.add(sourceKey(source.libraryId, source.bookId));
    }
  }

  const upserts: Book[] = [];
  const seenSources = new Set<string>();

  for (const { id, json } of serverBooks) {
    const key = sourceKey(libraryId, id);
    seenSources.add(key);
    if (downloadedBySource.has(key)) continue;

    const format = pickPreferredFormat(json.formats);
    if (!format) continue; // nothing Readest can open; don't clutter the shelf
    const formats = Array.from(new Set((json.formats ?? []).map((f) => f.toLowerCase())));
    const source = {
      serverId: server.id,
      libraryId,
      bookId: id,
      format,
      formats,
      lastModified: json.last_modified ?? undefined,
    };

    const existing = stubsBySource.get(key);
    if (existing) {
      // A user-edited stub (metadataUpdatedAt set) wins over the server's
      // copy — mirrors reconcileAbsBooks' rule: a routine resync must not
      // silently revert a rename the user made on this device. The sync
      // bookkeeping (format, calibreSource stamp) still refreshes.
      const keepMetadata = !!existing.metadataUpdatedAt;
      const title = keepMetadata ? existing.title : json.title || existing.title;
      const author = keepMetadata ? existing.author : json.authors?.join(', ') || existing.author;
      const tags = json.tags ?? [];
      // Shelves are backfill-only (see the input doc); a manually chosen
      // groupName is never replaced by a server shelf.
      const nextGroupName = existing.groupName || getGroupName?.(id) || '';
      const changed =
        existing.format !== format.toUpperCase() ||
        existing.metadata?.calibreSource?.lastModified !== source.lastModified ||
        // Rows synced before calibreSource.formats existed get a one-time
        // refresh so their download ladder has the fallback list.
        (existing.metadata?.calibreSource?.formats?.join(',') ?? '') !== formats.join(',') ||
        // Top-level tags feed the shelf's Tag grouping; backfill rows that
        // predate it the same way.
        (existing.tags?.join(',') ?? '') !== tags.join(',') ||
        (existing.groupName ?? '') !== nextGroupName ||
        (!keepMetadata && (existing.title !== title || existing.author !== author)) ||
        (existing.deletedAt ?? null) !== null;
      if (!changed) continue;
      const updated: Book = {
        ...existing,
        format: format.toUpperCase() as Book['format'],
        title,
        author,
        tags,
        groupName: nextGroupName,
        sourceTitle: keepMetadata ? existing.sourceTitle : title,
        deletedAt: null,
        updatedAt: now,
      };
      if (keepMetadata) {
        // Refresh only the sync stamp; the user's edited metadata stays.
        updated.metadata = { ...existing.metadata!, calibreSource: source };
      } else {
        // Rebuild metadata wholesale so a server-side metadata edit
        // propagates to the still-unedited stub.
        updated.metadata = buildCalibreBookMetadata(json, source);
        hydrateCalibreBookFields(updated);
      }
      upserts.push(updated);
    } else {
      const filePath = makeCalibreFilePath(server.id, libraryId, id);
      const stub: Book = {
        hash: md5(filePath),
        format: format.toUpperCase() as Book['format'],
        filePath,
        title: json.title || _('Untitled'),
        author: json.authors?.join(', ') || '',
        tags: json.tags ?? [],
        groupName: getGroupName?.(id),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      stub.sourceTitle = stub.title;
      stub.metadata = buildCalibreBookMetadata(json, source);
      hydrateCalibreBookFields(stub);
      upserts.push(stub);
    }
  }

  const tombstoneHashes: string[] = [];
  for (const [key, book] of stubsBySource) {
    if (!seenSources.has(key) && !book.deletedAt) {
      tombstoneHashes.push(book.hash);
    }
  }

  return { upserts, tombstoneHashes };
};

const toEnvConfig = (appService: AppService): { getAppService: () => Promise<AppService> } => ({
  getAppService: async () => appService,
});

/**
 * Download a stub's cover via the client's authenticated fetch (covers are
 * small enough to skip the transfer manager, and the auth header then just
 * works for digest servers too). Best effort: any failure is logged and the
 * book keeps its placeholder tile. Mutates `book` in place — callers must run
 * this before the upserts reach the library store (see syncAbsServer).
 */
const downloadCalibreCover = async (
  appService: AppService,
  client: ReturnType<typeof createCalibreClient>,
  book: Book,
  libraryId: string,
  bookId: string,
): Promise<boolean> => {
  try {
    const res = await client.authedFetch(client.buildThumbUrl(libraryId, bookId, '600x900'), {
      headers: { Accept: 'image/*' },
    });
    if (!res.ok) return false;
    const bytes = await res.arrayBuffer();
    if (!bytes?.byteLength) return false;
    await appService.writeFile(getCoverFilename(book), 'Books', bytes);
    book.coverHash = await appService.computeCoverHash(book);
    book.coverImageUrl = await appService.generateCoverImageUrl(book);
    return true;
  } catch (error) {
    console.warn(`[Calibre] failed to download cover for "${book.title}":`, error);
    return false;
  }
};

/**
 * Orchestrates: fetch, reconcile, apply to the library store, download
 * missing covers. `force` (manual Sync Now / connect) always walks the full
 * feed; the periodic auto pass may short-circuit on an unchanged book count
 * — a full walk at a 15k-book library is hundreds of requests plus a
 * whole-shelf reconcile, and doing that every five minutes for no change
 * was visible as periodic jank.
 */
export const syncCalibreServer = async (
  appService: AppService,
  server: CalibreServer,
  options: { force?: boolean } = {},
): Promise<void> => {
  const client = createCalibreClient(server);
  const progress = useCalibreSyncProgressStore.getState();
  progress.begin(server.id);

  try {
    await syncCalibreServerInner(appService, server, client, progress, options.force === true);
    progress.finish(server.id);
  } catch (error) {
    progress.finish(server.id);
    throw error;
  }
};

const syncCalibreServerInner = async (
  appService: AppService,
  server: CalibreServer,
  client: ReturnType<typeof createCalibreClient>,
  progress: ReturnType<typeof useCalibreSyncProgressStore.getState>,
  force: boolean,
): Promise<void> => {
  const info = await client.getLibraryInfo();
  // Persist a newly-detected flavor (rows from before detection have none).
  if (info.flavor !== server.flavor) {
    useCalibreServerStore.getState().updateServer(server.id, { flavor: info.flavor });
    server = { ...server, flavor: info.flavor };
  }
  let libraryId: string;
  if (info.flavor === 'calibre-web') {
    // Calibre-Web exposes a single pseudo-library; per-user visibility is
    // configured in the Calibre-Web UI, not here.
    libraryId = 'calibre-web';
  } else {
    const availableIds = new Set(info.libraries.map((l) => l.id));
    libraryId =
      server.libraryId && availableIds.has(server.libraryId)
        ? server.libraryId
        : info.defaultLibraryId;
  }
  const libraryName = info.libraries.find((l) => l.id === libraryId)?.name ?? libraryId;
  if (libraryId !== server.libraryId || libraryName !== server.libraryName) {
    // A library switch invalidates the stored count probe.
    useCalibreServerStore.getState().updateServer(server.id, {
      libraryId,
      libraryName,
      lastSyncedBookCount: undefined,
    });
    server = { ...server, libraryId, libraryName, lastSyncedBookCount: undefined };
  }

  // Auto-pass change probe: when the server reports the same book count as
  // the last completed sync, skip the full walk entirely. Metadata edits
  // without add/remove are only picked up by a manual "Sync Now" (always
  // force) — the documented trade-off for keeping a 15k-library auto pass
  // at two requests.
  if (!force && server.lastSyncedBookCount !== undefined) {
    const count = await client.getBookCount(libraryId).catch(() => undefined);
    if (count !== undefined && count === server.lastSyncedBookCount) {
      useCalibreServerStore.getState().updateServer(server.id, { lastSyncedAt: Date.now() });
      await useCalibreServerStore
        .getState()
        .saveCalibreServers({ getAppService: async () => appService });
      return;
    }
  }

  const serverBooks = await client.listAllBooks(libraryId, (fetched, total) =>
    progress.update(server.id, { fetched, total }),
  );

  // Calibre-Web shelves → folder grouping. Fetched on every full pass (they
  // now only run when the book count changed or the user asked); a failure
  // must not fail the whole sync.
  let getGroupName: ((bookId: string) => string | undefined) | undefined;
  if (info.flavor === 'calibre-web') {
    try {
      const shelves = await client.getShelves();
      const shelfOf = new Map<string, string>();
      for (const shelf of shelves) {
        for (const bookId of shelf.bookIds) {
          if (!shelfOf.has(bookId)) shelfOf.set(bookId, shelf.name);
        }
      }
      if (shelfOf.size > 0) getGroupName = (bookId) => shelfOf.get(bookId);
    } catch (error) {
      console.warn('[Calibre] shelf sync failed:', error);
    }
  }

  const now = Date.now();
  const { library } = useLibraryStore.getState();
  const { upserts, tombstoneHashes } = reconcileCalibreBooks({
    server,
    libraryId,
    serverBooks,
    library,
    now,
    getGroupName,
  });

  // Covers before the upserts reach the store. New/changed stubs are not
  // referenced anywhere yet, so their cover fields mutate in place; EXISTING
  // stubs still missing a cover (a failed download on an earlier pass) are
  // cloned first and swapped back in at merge time — the store owns those
  // objects and in-place edits would never be observed.
  const upsertHashes = new Set(upserts.map((b) => b.hash));
  const replaced = new Map<string, Book>();
  const coverTasks: { book: Book; libraryId: string; bookId: string }[] = [];
  for (const book of upserts) {
    const parsed = parseCalibreFilePath(book.filePath);
    if (!parsed) continue;
    if (await appService.exists(getCoverFilename(book), 'Books')) continue;
    coverTasks.push({ book, libraryId: parsed.libraryId, bookId: parsed.bookId });
  }
  for (const book of library) {
    const parsed = parseCalibreFilePath(book.filePath);
    if (!parsed || parsed.serverId !== server.id || upsertHashes.has(book.hash)) continue;
    if (await appService.exists(getCoverFilename(book), 'Books')) continue;
    const clone = { ...book };
    replaced.set(clone.hash, clone);
    coverTasks.push({ book: clone, libraryId: parsed.libraryId, bookId: parsed.bookId });
  }
  for (let i = 0; i < coverTasks.length; i += COVER_CONCURRENCY) {
    const group = coverTasks.slice(i, i + COVER_CONCURRENCY);
    progress.update(server.id, {
      phase: 'covers',
      fetched: Math.min(i + group.length, coverTasks.length),
      total: coverTasks.length,
    });
    await Promise.all(
      group.map(({ book, libraryId: libId, bookId }) =>
        downloadCalibreCover(appService, client, book, libId, bookId),
      ),
    );
  }

  // Re-read the library right before merging: the cover downloads above
  // crossed many awaits, and importing/deleting/progress updates that
  // happened meanwhile must survive this sync — merging into the stale
  // snapshot from line ~304 would overwrite them.
  const currentLibrary = useLibraryStore.getState().library;
  const merged = new Map(currentLibrary.map((book) => [book.hash, book]));
  for (const [hash, clone] of replaced) {
    // The clone carries freshly downloaded cover fields but is based on the
    // pre-download snapshot; rebase them onto the current row instead of
    // reverting concurrent changes to that row.
    const live = merged.get(hash);
    merged.set(
      hash,
      live ? { ...live, coverImageUrl: clone.coverImageUrl, coverHash: clone.coverHash } : clone,
    );
  }
  for (const book of upserts) merged.set(book.hash, book);
  for (const hash of tombstoneHashes) {
    const existing = merged.get(hash);
    if (existing) merged.set(hash, { ...existing, deletedAt: now });
  }
  const newLibrary = Array.from(merged.values());

  // Nothing changed (the common case for the periodic pass): leave the
  // library untouched — at a 15k-book library a redundant setLibrary +
  // whole-file rewrite re-sorted the entire shelf every five minutes.
  const unchanged = upserts.length === 0 && replaced.size === 0 && tombstoneHashes.length === 0;
  if (!unchanged) {
    useLibraryStore.getState().setLibrary(newLibrary);
    await appService.saveLibraryBooks(newLibrary);
  }

  useCalibreServerStore.getState().updateServer(server.id, {
    lastSyncedAt: now,
    lastSyncedBookCount: serverBooks.length,
  });
  await useCalibreServerStore.getState().saveCalibreServers(toEnvConfig(appService));
};

/**
 * Sync every enabled server. Fails silently by design (console only): the
 * periodic 5-minute pass runs while the user reads, and an offline Docker
 * box must not toast every interval — mirrors syncAllAbsServers. The
 * settings form's explicit "Sync now" opts into failure toasts via
 * `notifyOnFailure` and always walks the full feed via `force` (the auto
 * pass may short-circuit on an unchanged book count).
 */
export const syncAllCalibreServers = async (
  appService: AppService,
  options: { notifyOnFailure?: boolean; force?: boolean } = {},
): Promise<void> => {
  const servers = useCalibreServerStore
    .getState()
    .getAvailableServers()
    .filter((s) => !s.disabled);
  for (const server of servers) {
    try {
      await syncCalibreServer(appService, server, { force: options.force === true });
    } catch (error) {
      console.error(`[Calibre] sync failed for server "${server.name}":`, error);
      if (options.notifyOnFailure) {
        eventDispatcher.dispatch('toast', {
          message: `Calibre sync failed for "${server.name}": ${
            error instanceof Error ? error.message : String(error)
          }`,
          type: 'error',
        });
      }
    }
  }
};

/** Tombstone all sync stubs belonging to a removed server; downloaded copies stay. */
export const removeCalibreServerBooks = async (
  appService: AppService,
  serverId: string,
): Promise<void> => {
  const now = Date.now();
  const { library } = useLibraryStore.getState();
  const newLibrary = library.map((book) => {
    const parsed = parseCalibreFilePath(book.filePath);
    if (parsed && parsed.serverId === serverId && !book.deletedAt) {
      return { ...book, deletedAt: now };
    }
    return book;
  });
  useLibraryStore.getState().setLibrary(newLibrary);
  await appService.saveLibraryBooks(newLibrary);
};
