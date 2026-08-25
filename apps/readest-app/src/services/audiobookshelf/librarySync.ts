import { ABSClient } from '@/services/audiobookshelf/client';
import { createAbsClient } from '@/services/audiobookshelf/createClient';
import {
  isLocalProgressFresher,
  readLocalLastPlayedAt,
} from '@/services/audiobookshelf/progressSync';
import type { EnvConfigType } from '@/services/environment';
import { downloadFile } from '@/libs/storage';
import type { ABSLibraryItem, ABSMediaProgress, ABSServer } from '@/types/audiobookshelf';
import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';
import { buildAbsBookMetadata, makeAbsFilePath, parseAbsFilePath } from '@/utils/audiobook';
import { getCoverFilename } from '@/utils/book';
import { md5 } from '@/utils/md5';
import { stubTranslation as _, uniqueId } from '@/utils/misc';
import { findABSServerById, useABSServerStore } from '@/store/absServerStore';
import { useLibraryStore } from '@/store/libraryStore';

/** Number of audio tracks a library item carries, from whichever field the server populated. */
const audioTrackCount = (item: ABSLibraryItem): number =>
  item.media.numAudioFiles ?? item.media.numTracks ?? item.media.tracks?.length ?? 0;

/** True for book-type items that actually have audio (excludes ebook-only entries and podcasts). */
const isAudiobookItem = (item: ABSLibraryItem): boolean =>
  item.mediaType === 'book' && audioTrackCount(item) > 0;

/** True for podcast show items. */
const isPodcastItem = (item: ABSLibraryItem): boolean => item.mediaType === 'podcast';

/**
 * Episode count from whichever field the server populated: the library list
 * endpoint gives `numEpisodes` on minified podcast items; an expanded item
 * without it falls back to `episodes.length`.
 */
const episodeCount = (item: ABSLibraryItem): number =>
  item.media.numEpisodes ?? item.media.episodes?.length ?? 0;

const progressEqual = (a: Book['progress'], b: Book['progress']): boolean => {
  if (!a || !b) return !a && !b;
  return a[0] === b[0] && a[1] === b[1];
};

/** Pure: compute the library delta for one server. Exported for tests. */
export const reconcileAbsBooks = (input: {
  server: ABSServer;
  items: ABSLibraryItem[]; // all items from all selected libraries
  progress: ABSMediaProgress[]; // from GET /api/me
  library: Book[]; // current full library
  /**
   * Per-book-hash ms stamp of this device's last local progress write, read
   * out of localStorage by the caller so this function stays pure. Drives the
   * same newest-wins rule the resume path uses (isLocalProgressFresher).
   */
  lastPlayedAtByHash: Map<string, number>;
  now: number;
}): { upserts: Book[]; tombstoneHashes: string[] } => {
  const { server, items, progress, library, lastPlayedAtByHash, now } = input;

  const progressByItemId = new Map(progress.map((p) => [p.libraryItemId, p]));

  // Only books that belong to this server participate in tombstoning /
  // matching; other servers' books and local books are never touched.
  const existingByFilePath = new Map<string, Book>();
  for (const book of library) {
    const parsed = parseAbsFilePath(book.filePath);
    if (parsed && parsed.serverId === server.id) {
      existingByFilePath.set(book.filePath!, book);
    }
  }

  const upserts: Book[] = [];
  const seenFilePaths = new Set<string>();

  for (const item of items) {
    const podcast = isPodcastItem(item);
    if (!podcast && !isAudiobookItem(item)) continue;

    const filePath = makeAbsFilePath(server.id, item.id);
    seenFilePaths.add(filePath);

    const serverTitle = item.media.metadata.title || _('Untitled');
    const serverAuthor = podcast
      ? (item.media.metadata.author ?? '')
      : (item.media.metadata.authorName ?? '');
    const duration = podcast ? undefined : item.media.duration;
    const primaryLanguage = item.media.metadata.language ?? undefined;
    const numEpisodes = podcast ? episodeCount(item) : undefined;
    // A show's own progress is never mapped — per-episode progress is a
    // later task, so a podcast item never looks up or applies server progress.
    const itemProgress = podcast ? undefined : progressByItemId.get(item.id);
    const serverProgress: Book['progress'] = itemProgress
      ? [Math.round(itemProgress.currentTime), Math.round(itemProgress.duration)]
      : undefined;

    const existing = existingByFilePath.get(filePath);
    if (existing) {
      // Newest wins, exactly as on the resume path. Without this a paused
      // book whose close-session failed had its fresher local position
      // re-clobbered and re-persisted by every 5-minute pass, while the
      // local `abs-last-played-<hash>` stamp stayed fresh — so the resume
      // rule then trusted the poisoned cache. Server absent = keep local.
      // Podcast shows always keep local: show-level progress mirrors the
      // last-played episode via the progress syncer (AbsProgressSyncer
      // #cacheLocally writes it into Book.progress on every episode's
      // pause/tick/seek/end) - reconcile never overwrites it, since a
      // podcast's own itemProgress lookup above is unconditionally undefined.
      const keepLocalProgress =
        podcast ||
        !itemProgress ||
        isLocalProgressFresher(lastPlayedAtByHash.get(existing.hash) ?? 0, itemProgress.lastUpdate);
      const bookProgress = keepLocalProgress ? existing.progress : serverProgress;

      // A user-edited title/author (metadataUpdatedAt set) wins over the
      // server's copy — mirrors pickFresherMetadata's field-level LWW for the
      // metadata group (src/app/library/utils/libraryUtils.ts): a routine
      // resync must not clobber a local edit just because progress moved.
      const keepMetadata = !!existing.metadataUpdatedAt;
      const title = keepMetadata ? existing.title : serverTitle;
      const author = keepMetadata ? existing.author : serverAuthor;

      const changed =
        existing.title !== title ||
        existing.author !== author ||
        existing.duration !== duration ||
        existing.episodeCount !== numEpisodes ||
        !progressEqual(existing.progress, bookProgress) ||
        (existing.deletedAt ?? null) !== null ||
        // The cloud sync mirror is missing (a row created before it existed)
        // or was dropped by a metadata edit, which rewrites `metadata`
        // wholesale. Without it the row syncs to peers with no identity.
        existing.metadata?.absSource !== filePath;
      if (!changed) continue;

      const updated: Book = {
        ...existing,
        title,
        author,
        sourceTitle: title,
        duration,
        episodeCount: numEpisodes,
        primaryLanguage,
        progress: bookProgress,
        deletedAt: null,
        updatedAt: now,
      };
      updated.metadata = buildAbsBookMetadata(updated);
      upserts.push(updated);
    } else {
      const stub: Book = {
        hash: md5(filePath),
        format: 'ABS',
        filePath,
        title: serverTitle,
        author: serverAuthor,
        sourceTitle: serverTitle,
        duration,
        absMediaType: podcast ? 'podcast' : undefined,
        episodeCount: numEpisodes,
        primaryLanguage,
        progress: podcast ? undefined : serverProgress,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      // The identity and badge fields have no cloud columns, so they ride to
      // peers inside `metadata` — see buildAbsBookMetadata.
      stub.metadata = buildAbsBookMetadata(stub);
      upserts.push(stub);
    }
  }

  const tombstoneHashes: string[] = [];
  for (const [filePath, book] of existingByFilePath) {
    if (!seenFilePaths.has(filePath) && !book.deletedAt) {
      tombstoneHashes.push(book.hash);
    }
  }

  return { upserts, tombstoneHashes };
};

const toEnvConfig = (appService: AppService): EnvConfigType => ({
  getAppService: async () => appService,
});

/**
 * Download and write an upserted book's cover. Best effort: any failure
 * (offline, 404, empty body) is logged and skipped, never fails the sync.
 * Mirrors applyOPDSCover (src/services/opds/cover.ts), minus probeAuth —
 * ABS cover URLs are unauthenticated. Returns true when the cover was
 * written and the book's cover fields were updated.
 */
const downloadAbsCover = async (
  appService: AppService,
  client: ABSClient,
  book: Book,
  itemId: string,
): Promise<boolean> => {
  const tmpPath = await appService.resolveFilePath(`abs_cover_${uniqueId()}`, 'Cache');
  try {
    await downloadFile({
      appService,
      dst: tmpPath,
      cfp: '',
      url: client.buildCoverUrl(itemId),
      headers: { Accept: 'image/*' },
      singleThreaded: true,
      skipSslVerification: true,
    });
    const bytes = (await appService.readFile(tmpPath, 'None', 'binary')) as ArrayBuffer;
    if (!bytes?.byteLength) return false;
    await appService.writeFile(getCoverFilename(book), 'Books', bytes);
    book.coverHash = await appService.computeCoverHash(book);
    book.coverImageUrl = await appService.generateCoverImageUrl(book);
    return true;
  } catch (error) {
    console.warn(`[ABS] failed to download cover for "${book.title}":`, error);
    return false;
  } finally {
    try {
      await appService.deleteFile(tmpPath, 'None');
    } catch {
      // best effort cache cleanup
    }
  }
};

/**
 * Fetch missing covers for ABS books whose server row is present, without
 * requiring authentication — ABS cover endpoints are public. Covers the
 * books-adopted-via-cloud case: a device that received the book rows and the
 * server row but has no (valid) login yet would otherwise show placeholder
 * tiles until its first authenticated library sync. Cloned books replace
 * their store entries only on success; originals are never mutated in place.
 */
export const backfillAbsCovers = async (appService: AppService): Promise<void> => {
  const { library } = useLibraryStore.getState();
  const clients = new Map<string, ABSClient>();
  const replaced = new Map<string, Book>();
  for (const book of library) {
    if (book.deletedAt) continue;
    const parsed = parseAbsFilePath(book.filePath);
    if (!parsed) continue;
    const server = findABSServerById(parsed.serverId);
    if (!server || server.deletedAt) continue;
    if (await appService.exists(getCoverFilename(book), 'Books')) continue;
    let client = clients.get(server.id);
    if (!client) {
      // Cover downloads never touch token endpoints, so no refresh callback.
      client = new ABSClient(server, { onTokensUpdated: () => {} });
      clients.set(server.id, client);
    }
    const clone = { ...book };
    if (await downloadAbsCover(appService, client, clone, parsed.itemId)) {
      replaced.set(book.hash, clone);
    }
  }
  if (replaced.size === 0) return;
  // Re-read the store: the downloads above are async and a concurrent sync
  // may have swapped the library array since the first read.
  const current = useLibraryStore.getState().library;
  const newLibrary = current.map((book) => replaced.get(book.hash) ?? book);
  useLibraryStore.getState().setLibrary(newLibrary);
  await appService.saveLibraryBooks(newLibrary);
};

/** Orchestrates: fetch, reconcile, apply to the library store, download missing covers. */
export const syncAbsServer = async (appService: AppService, server: ABSServer): Promise<void> => {
  const client = createAbsClient(appService, server);

  const libraries = (await client.getLibraries()).filter(
    (lib) => lib.mediaType === 'book' || lib.mediaType === 'podcast',
  );
  const selectedLibraries = server.libraryIds
    ? libraries.filter((lib) => server.libraryIds!.includes(lib.id))
    : libraries;

  const itemLists = await Promise.all(
    selectedLibraries.map((lib) => client.getLibraryItems(lib.id)),
  );
  const items = itemLists.flat();
  const { mediaProgress } = await client.getMe();

  const now = Date.now();
  const { library } = useLibraryStore.getState();
  // Read the local play stamps here so reconcileAbsBooks stays pure.
  const lastPlayedAtByHash = new Map<string, number>();
  for (const book of library) {
    if (parseAbsFilePath(book.filePath)) {
      lastPlayedAtByHash.set(book.hash, readLocalLastPlayedAt(book.hash));
    }
  }
  const { upserts, tombstoneHashes } = reconcileAbsBooks({
    server,
    items,
    progress: mediaProgress,
    library,
    lastPlayedAtByHash,
    now,
  });

  // Download covers before the upserts reach the store: applyOPDSCover's own
  // docstring calls out in-place field mutation as only safe before the
  // library is saved. These Book objects aren't referenced anywhere yet, so
  // mutating book.coverHash/coverImageUrl here is safe, and the merge below
  // picks up the fully-populated objects in one shot instead of needing a
  // second setLibrary/saveLibraryBooks pass.
  for (const book of upserts) {
    const parsed = parseAbsFilePath(book.filePath);
    if (!parsed) continue;
    if (await appService.exists(getCoverFilename(book), 'Books')) continue;
    await downloadAbsCover(appService, client, book, parsed.itemId);
  }

  const merged = new Map(library.map((book) => [book.hash, book]));
  for (const book of upserts) merged.set(book.hash, book);
  for (const hash of tombstoneHashes) {
    const existing = merged.get(hash);
    if (existing) merged.set(hash, { ...existing, deletedAt: now });
  }
  const newLibrary = Array.from(merged.values());

  useLibraryStore.getState().setLibrary(newLibrary);
  await appService.saveLibraryBooks(newLibrary);

  useABSServerStore.getState().updateServer(server.id, { lastSyncedAt: now });
  await useABSServerStore.getState().saveABSServers(toEnvConfig(appService));
};

export const syncAllAbsServers = async (appService: AppService): Promise<void> => {
  const servers = useABSServerStore
    .getState()
    .getAvailableServers()
    .filter((s) => !s.disabled);
  for (const server of servers) {
    try {
      await syncAbsServer(appService, server);
    } catch (error) {
      console.error(`[ABS] sync failed for server "${server.name}":`, error);
    }
  }
};

/** Tombstone all books belonging to a removed server. */
export const removeAbsServerBooks = async (
  appService: AppService,
  serverId: string,
): Promise<void> => {
  const now = Date.now();
  const { library } = useLibraryStore.getState();
  const newLibrary = library.map((book) => {
    const parsed = parseAbsFilePath(book.filePath);
    if (parsed && parsed.serverId === serverId && !book.deletedAt) {
      return { ...book, deletedAt: now };
    }
    return book;
  });
  useLibraryStore.getState().setLibrary(newLibrary);
  await appService.saveLibraryBooks(newLibrary);
};
