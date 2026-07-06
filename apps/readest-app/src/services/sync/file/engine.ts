import { Book, BookConfig, BookNote } from '@/types/book';
import { FileHead, FileSyncError, FileSyncProvider } from './provider';
import { LocalStore } from './localStore';
import {
  ancestorsOf,
  buildBasePath,
  buildBookConfigPath,
  buildBookCoverPath,
  buildBookDirPath,
  buildBookFilePath,
  buildLibraryPath,
  SYNC_BOOKS_DIR,
  SYNC_BOOK_CONFIG_FILE,
  SYNC_BOOK_COVER_FILE,
} from './layout';
import {
  buildRemotePayload,
  parseRemotePayload,
  parseRemoteLibraryIndex,
  RemoteLibraryIndex,
} from './wire';
import { mergeBookConfig, mergeBookMetadata, shouldApplyRemoteBookMetadata } from './merge';

export type SyncStrategy = 'silent' | 'send' | 'receive';

export interface PullResult {
  /** True when the remote had a config and we merged something into local. */
  applied: boolean;
  /** The merged config to be written back into the local store. */
  mergedConfig?: BookConfig;
  /** When non-empty, these are the notes after merge — use them to update the live view. */
  mergedNotes?: BookNote[];
  /** The remote's writerDeviceId, useful for diagnostics. */
  remoteDeviceId?: string;
}

export interface PushBookFileResult {
  /** True when bytes were uploaded; false when the upload was skipped. */
  uploaded: boolean;
  /** Reason for the skip, when applicable — surfaced for diagnostics. */
  reason?: 'remote-matches' | 'no-source' | 'disabled';
}

export interface DeleteRemoteBookDirResult {
  /** True when the server confirmed deletion (or the dir was already gone). */
  ok: boolean;
  /** Compact reason string when `ok === false`, for the failure toast. */
  reason?: string;
}

export interface SyncFailureEntry {
  hash: string;
  title: string;
  reason: string;
  /** Which phase of the per-book pipeline failed; helps users self-triage. */
  phase: 'download' | 'upload-config' | 'upload-file' | 'upload-cover';
}

/**
 * Aggregate result of a library-wide sync. Counters are kept granular so the
 * UI can render an honest "X uploaded, Y already in sync, Z failed" toast.
 */
export interface SyncLibraryResult {
  totalBooks: number;
  configsUploaded: number;
  configsDownloaded: number;
  filesUploaded: number;
  filesAlreadyInSync: number;
  coversUploaded: number;
  booksDownloaded: number;
  /** Local books removed because a peer's tombstone propagated to this device (#4860). */
  booksDeleted: number;
  /** Already-local books whose metadata was refreshed from a newer index copy (#4756). */
  metadataUpdated: number;
  /** Distinct books that had any sync activity (pushed, downloaded, or reconciled). */
  booksSynced: number;
  failures: number;
  /** Per-book failure breakdown for the diagnostic log in the Settings UI. */
  failedBooks: SyncFailureEntry[];
}

export interface SyncLibraryOptions {
  syncBooks: boolean;
  strategy?: SyncStrategy;
  /** Stable per-device id; written into every config envelope. */
  deviceId: string;
  /**
   * When false (default), only books whose local copy differs from the shared
   * library.json index are processed — `book.updatedAt` bumps on every
   * progress / notes / metadata save, so the index is a reliable per-book
   * change marker. When true, every book is re-checked (the original full
   * walk), an escape hatch for drift or a first sync to a fresh remote.
   */
  fullSync?: boolean;
  /**
   * Max books processed concurrently per phase (download / reconcile / push).
   * Defaults to 4. A bounded pool keeps shared WebDAV servers happy while
   * still hiding per-request latency.
   */
  concurrency?: number;
  /**
   * Optional progress callback fired before each book is processed,
   * suitable for driving a UI like "Syncing 3 / 42 — Project Hail Mary".
   */
  onProgress?: (info: { book: Book; index: number; total: number; action?: string }) => void;
}

/**
 * Reduce an arbitrary error to a short, single-line description for the
 * per-book failure breakdown in {@link SyncLibraryResult}. Preserves the
 * semantically useful bits (HTTP status, the `code` enum), strips stack
 * traces / server XML, and caps at 200 chars.
 */
const formatFailureReason = (e: unknown): string => {
  let message: string;
  if (e instanceof FileSyncError) {
    const parts: string[] = [];
    if (e.code) parts.push(e.code);
    if (typeof e.status === 'number') parts.push(`HTTP ${e.status}`);
    parts.push(e.message || 'Request failed');
    message = parts.join(' · ');
  } else if (e instanceof Error) {
    message = e.message || e.name || 'Unknown error';
  } else {
    message = String(e);
  }
  message = message.replace(/\s+/g, ' ').trim();
  return message.length > 200 ? `${message.slice(0, 197)}...` : message;
};

/**
 * Delete the per-book directory `<rootPath>/Readest/books/<hash>/` — file,
 * cover and config.json — in one round-trip. Used by the remote-browser
 * cleanup mode to evict orphans. AUTH failures rethrow (a global condition
 * the caller surfaces as a single re-auth toast); every other failure is
 * folded into `{ ok: false, reason }` so a batch loop can aggregate.
 *
 * Standalone (not a method) because it needs no {@link LocalStore} — the
 * WebDAV-specific browse UI builds a provider and calls it directly.
 */
export const deleteRemoteBookDir = async (
  provider: FileSyncProvider,
  bookHash: string,
): Promise<DeleteRemoteBookDirResult> => {
  const path = buildBookDirPath(provider.rootPath, bookHash);
  try {
    await provider.deleteDir(path);
    return { ok: true };
  } catch (e) {
    if (e instanceof FileSyncError && e.code === 'AUTH_FAILED') throw e;
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
};

/**
 * Run `worker` over `items` with at most `limit` in flight at once. A bounded
 * pool: `limit` runner loops each pull the next index off a shared cursor until
 * the list drains. JS's single-threaded event loop makes the cursor increment
 * and the per-book result mutations race-free between await points.
 */
const runPool = async <T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
  stopped?: () => boolean,
): Promise<void> => {
  if (items.length === 0) return;
  let cursor = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (cursor < items.length && !stopped?.()) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]!, index);
    }
  });
  await Promise.all(runners);
};

/**
 * Provider-agnostic file-sync orchestration: progress + booknote merge per
 * book, library-wide push/pull with last-writer-wins metadata reconciliation,
 * and HEAD-short-circuited binary upload. All remote I/O goes through a
 * {@link FileSyncProvider}; all local I/O goes through a {@link LocalStore}.
 */
export class FileSyncEngine {
  constructor(
    private readonly provider: FileSyncProvider,
    private readonly store: LocalStore,
  ) {}

  /**
   * Pull `<rootPath>/Readest/books/<hash>/config.json`, merge into the
   * provided local config, and return the merged result. The caller writes
   * the merged config back (so the engine stays free of store-write side
   * effects here). `applied: false` when the remote file is absent/malformed.
   */
  async pullBookConfig(book: Book, localConfig: BookConfig): Promise<PullResult> {
    const path = buildBookConfigPath(this.provider.rootPath, book.hash);
    const remote = parseRemotePayload(await this.provider.readText(path));
    if (!remote) return { applied: false };
    const { config, notes } = mergeBookConfig(localConfig, remote);
    return {
      applied: true,
      mergedConfig: config,
      mergedNotes: notes,
      remoteDeviceId: remote.writerDeviceId,
    };
  }

  /**
   * Push the local BookConfig to the remote, creating parent dirs as needed.
   * A 409 (parent vanished between MKCOL and PUT) triggers one re-ensure +
   * retry. Deciding *whether* to push is the caller's job; this is the dumb
   * mechanism.
   */
  async pushBookConfig(book: Book, config: BookConfig, deviceId: string): Promise<void> {
    const dirPath = buildBookDirPath(this.provider.rootPath, book.hash);
    const path = buildBookConfigPath(this.provider.rootPath, book.hash);
    const dirs = [...ancestorsOf(`${dirPath}/.placeholder`), dirPath];
    await this.provider.ensureDir(dirs);
    const body = JSON.stringify(buildRemotePayload(book, config, deviceId));
    try {
      await this.provider.writeText(path, body);
    } catch (e) {
      if (e instanceof FileSyncError && e.status === 409) {
        await this.provider.ensureDir(dirs);
        await this.provider.writeText(path, body);
        return;
      }
      throw e;
    }
  }

  /**
   * Upload the book binary to `<rootPath>/Readest/books/<hash>/<title>.<ext>`.
   * HEAD-probe + size compare skips re-uploading an already-mirrored book.
   * Streaming (provider.uploadStream, Tauri only) is preferred — constant JS
   * heap regardless of book size; web falls back to buffered writeBinary.
   */
  async pushBookFile(book: Book): Promise<PushBookFileResult> {
    const dirPath = buildBookDirPath(this.provider.rootPath, book.hash);
    const path = buildBookFilePath(this.provider.rootPath, book);
    const dirs = [...ancestorsOf(`${dirPath}/.placeholder`), dirPath];

    let remoteHead: FileHead | null = null;
    try {
      remoteHead = await this.provider.head(path);
    } catch (e) {
      if (!(e instanceof FileSyncError) || e.code !== 'NETWORK') throw e;
    }

    // Streaming path: resolve the on-disk path + size only, then stream the
    // bytes straight from disk. The metadata fetch never reads the body, so
    // heap stays flat even for gigabyte-scale PDFs.
    if (this.provider.uploadStream) {
      const src = await this.store.resolveLocalBookPath(book);
      if (src) {
        if (remoteHead && remoteHead.size === src.size) {
          return { uploaded: false, reason: 'remote-matches' };
        }
        await this.provider.ensureDir(dirs);
        let ok = await this.provider.uploadStream(path, src.path);
        if (!ok) {
          // Mirror the buffered path's one-shot retry: a parent may have been
          // recreated mid-PUT (409). Re-ensure directories and try once more.
          await this.provider.ensureDir(dirs);
          ok = await this.provider.uploadStream(path, src.path);
          if (!ok) throw new FileSyncError('Streaming upload failed', 'NETWORK');
        }
        return { uploaded: true };
      }
      // src null — book isn't on this device via the streaming resolver; fall
      // through to the buffered loader as a last resort.
    }

    const local = await this.store.loadBookFile(book);
    if (!local) return { uploaded: false, reason: 'no-source' };
    if (remoteHead && remoteHead.size === local.size) {
      return { uploaded: false, reason: 'remote-matches' };
    }
    await this.provider.ensureDir(dirs);
    try {
      await this.provider.writeBinary(path, local.bytes);
    } catch (e) {
      if (e instanceof FileSyncError && e.status === 409) {
        await this.provider.ensureDir(dirs);
        await this.provider.writeBinary(path, local.bytes);
      } else {
        throw e;
      }
    }
    return { uploaded: true };
  }

  /**
   * Upload the book's cover image to `<rootPath>/Readest/books/<hash>/cover.png`.
   * Same HEAD-probe + size-compare idempotency as {@link pushBookFile}. Covers
   * are best-effort: a book without a local cover resolves to `no-source`.
   */
  async pushBookCover(book: Book): Promise<PushBookFileResult> {
    const dirPath = buildBookDirPath(this.provider.rootPath, book.hash);
    const path = buildBookCoverPath(this.provider.rootPath, book.hash);
    const dirs = [...ancestorsOf(`${dirPath}/.placeholder`), dirPath];

    let remoteHead: FileHead | null = null;
    try {
      remoteHead = await this.provider.head(path);
    } catch (e) {
      if (!(e instanceof FileSyncError) || e.code !== 'NETWORK') throw e;
    }

    const local = await this.store.loadBookCover(book);
    if (!local) return { uploaded: false, reason: 'no-source' };
    if (remoteHead && remoteHead.size === local.size) {
      return { uploaded: false, reason: 'remote-matches' };
    }
    await this.provider.ensureDir(dirs);
    try {
      await this.provider.writeBinary(path, local.bytes, 'image/png');
    } catch (e) {
      if (e instanceof FileSyncError && e.status === 409) {
        await this.provider.ensureDir(dirs);
        await this.provider.writeBinary(path, local.bytes, 'image/png');
      } else {
        throw e;
      }
    }
    return { uploaded: true };
  }

  /** GET the remote cover.png bytes for a hash, or null when absent. */
  async pullBookCover(bookHash: string): Promise<ArrayBuffer | null> {
    return this.provider.readBinary(buildBookCoverPath(this.provider.rootPath, bookHash));
  }

  /** GET + parse the shared library.json index, or null when absent/malformed. */
  async pullLibraryIndex(): Promise<RemoteLibraryIndex | null> {
    const path = buildLibraryPath(this.provider.rootPath);
    return parseRemoteLibraryIndex(await this.provider.readText(path));
  }

  /** PUT the shared library.json index, creating its parent dirs. */
  async pushLibraryIndex(index: RemoteLibraryIndex): Promise<void> {
    const path = buildLibraryPath(this.provider.rootPath);
    await this.provider.ensureDir(ancestorsOf(path));
    await this.provider.writeText(path, JSON.stringify(index));
  }

  /**
   * Sync every book in `books` against the remote in sequence (predictable
   * progress bar; no parallel PUTs that upset shared servers). Per book:
   * pull index → reconcile metadata (LWW) → discover remote-only books and
   * download them → pull-merge-push each local config + cover + (optionally)
   * file → re-push the merged index.
   *
   * Strategy gating: 'silent' two-way, 'send' push-only (blind, local
   * authoritative), 'receive' pull-only. Single-book failures are caught and
   * counted so one bad apple never aborts the rest of the library.
   */
  async syncLibrary(books: Book[], options: SyncLibraryOptions): Promise<SyncLibraryResult> {
    const result: SyncLibraryResult = {
      totalBooks: books.length,
      configsUploaded: 0,
      configsDownloaded: 0,
      filesUploaded: 0,
      filesAlreadyInSync: 0,
      coversUploaded: 0,
      booksDownloaded: 0,
      booksDeleted: 0,
      metadataUpdated: 0,
      booksSynced: 0,
      failures: 0,
      failedBooks: [],
    };

    // Distinct books touched in any direction — the single "N book(s) synced"
    // number the UI surfaces. Tracked as a set because the per-action counters
    // overlap (a Full-Sync re-check both reconciles and re-pushes the same
    // book, and one book can push a config + cover + file).
    const syncedHashes = new Set<string>();

    const strategy = options.strategy || 'silent';
    const canPull = strategy !== 'send';
    const canPush = strategy !== 'receive';

    let remoteIndex: RemoteLibraryIndex | null = null;
    if (canPull) {
      // An UNREADABLE index (throw — expired session, network) is NOT the
      // same as an ABSENT one (404 → null, first-sync semantics). Proceeding
      // with a null index here would treat every local book as unpushed (an
      // attempted mass re-upload against a dead session) and the final index
      // re-push would drop the peers' tombstones it failed to read (#4860),
      // resurrecting deleted books. Abort the run instead; callers surface
      // one error.
      remoteIndex = await this.pullLibraryIndex();
    }

    // Terminal-failure latch: once any remote call fails with AUTH_FAILED the
    // session is gone for every subsequent call too. Stop scheduling work
    // instead of marching the whole library through identical failures, skip
    // the index re-push (a partial run must not rewrite library.json), and
    // rethrow so the caller shows a single re-auth error. Mirrors the
    // deleteRemoteBookDir contract (AUTH failures rethrow; the rest aggregate).
    let abort: FileSyncError | null = null;
    const noteAbort = (e: unknown): void => {
      if (!abort && e instanceof FileSyncError && e.code === 'AUTH_FAILED') abort = e;
    };
    const aborted = (): boolean => abort !== null;

    const allBooksMap = new Map<string, Book>();
    for (const b of books) {
      allBooksMap.set(b.hash, b);
    }

    const fullSync = options.fullSync ?? false;
    const concurrency = Math.max(1, options.concurrency ?? 4);

    // Incremental cursor: a book needs a push only when its local copy is newer
    // than (or absent from) the shared library.json index. `book.updatedAt`
    // bumps on every progress / notes / metadata save, so the index is a
    // reliable per-book change marker. When no index is available (send mode,
    // or a failed pull) every local book counts as new and is pushed.
    const remoteByHash = new Map<string, Book>();
    if (remoteIndex?.books) {
      for (const rb of remoteIndex.books) {
        if (!rb.deletedAt) remoteByHash.set(rb.hash, rb);
      }
    }
    const isLocalNewer = (book: Book): boolean => {
      const remote = remoteByHash.get(book.hash);
      if (!remote) return true;
      return (book.updatedAt ?? 0) > (remote.updatedAt ?? 0);
    };

    // File-upload cursor (#4856): the index records which book FILES already
    // live on the remote. A book's file is immutable per hash, so once recorded
    // it never needs re-checking — this keeps an incremental sync O(changed)
    // by skipping the per-book HEAD probe for already-mirrored files instead of
    // probing every book each run. Seeded from the pulled index and carried
    // forward (plus this run's uploads) into the re-pushed index. Empty in send
    // mode / on a fresh remote, so the first sync verifies every file once.
    const uploadedHashes = new Set<string>(remoteIndex?.uploadedHashes ?? []);
    // A file needs (re)uploading only when syncBooks is on and the remote copy
    // isn't recorded yet. Full Sync bypasses the record as an escape hatch for
    // drift (e.g. a file deleted out-of-band via the browse pane).
    const needsFilePush = (book: Book): boolean =>
      options.syncBooks && (fullSync || !uploadedHashes.has(book.hash));

    const remoteBooksToDownload: Book[] = [];
    // The remote source of truth for a book's on-disk filename is the per-hash
    // directory listing — NOT the book's title (which may be stale). We always
    // resolve the path by listing the hash dir.
    const explicitRemotePaths = new Map<string, string>();

    // Metadata reconciliation for books present BOTH locally and in the shared
    // library.json (#4756). Last-writer-wins on `book.updatedAt`: when a peer's
    // indexed copy is strictly newer, pull its title / author / tags / cover
    // down; readingStatus rides its own readingStatusUpdatedAt clock so a
    // status-only change also triggers (see shouldApplyRemoteBookMetadata).
    // Updating allBooksMap with the merged copy also stops the final index
    // re-push from clobbering the peer's newer metadata with this device's
    // stale copy.
    if (canPull && remoteIndex && remoteIndex.books) {
      const remoteNewer = remoteIndex.books.filter((rb) => {
        if (rb.deletedAt) return false;
        const local = allBooksMap.get(rb.hash);
        return !!local && !local.deletedAt && shouldApplyRemoteBookMetadata(local, rb);
      });
      await runPool(
        remoteNewer,
        concurrency,
        async (rb) => {
          const local = allBooksMap.get(rb.hash)!;
          const merged = mergeBookMetadata(local, rb);
          // Re-pull the cover so a changed cover travels with the metadata. The
          // subsequent push-side pushBookCover HEAD/size short-circuit then
          // matches (local now equals remote), so we never bounce it back up.
          try {
            const coverBytes = await this.pullBookCover(rb.hash);
            if (coverBytes) await this.store.saveBookCover(merged, coverBytes);
          } catch (e) {
            noteAbort(e);
            console.warn('file sync: metadata cover pull failed', rb.hash, e);
          }
          // Incremental only: the per-book push loop below skips remote-newer
          // books, so pull their config here too — otherwise a peer's progress /
          // notes wouldn't propagate without re-walking every book. In full-sync
          // mode the push loop pulls each config, so we skip this to avoid a
          // duplicate GET.
          if (!fullSync) {
            try {
              const localConfig = (await this.store.loadConfig(merged)) ?? {
                updatedAt: 0,
                booknotes: [],
              };
              const pull = await this.pullBookConfig(merged, localConfig);
              if (pull.applied && pull.mergedConfig) {
                await this.store.saveBookConfig(merged, pull.mergedConfig);
                result.configsDownloaded += 1;
              }
            } catch (e) {
              noteAbort(e);
              console.warn('file sync: metadata config pull failed', rb.hash, e);
            }
          }
          try {
            await this.store.updateBookMetadata(merged);
            allBooksMap.set(rb.hash, merged);
            result.metadataUpdated += 1;
            syncedHashes.add(rb.hash);
          } catch (e) {
            console.warn('file sync: metadata update failed', rb.hash, e);
          }
        },
        aborted,
      );
    }

    // Deletion propagation (#4860): a book a peer tombstoned in the shared index
    // must be removed from this device too, not just hidden on the origin. Apply
    // the deletion with edit-wins-over-delete semantics — only when it is newer
    // than any local change, so a device that kept reading a book after another
    // device deleted it keeps its copy (and the live row re-revives the tombstone
    // on the next push).
    if (canPull && remoteIndex && remoteIndex.books) {
      const remoteDeletions = remoteIndex.books.filter((rb) => {
        if (!rb.deletedAt) return false;
        const local = allBooksMap.get(rb.hash);
        return !!local && !local.deletedAt && (rb.deletedAt ?? 0) > (local.updatedAt ?? 0);
      });
      await runPool(remoteDeletions, concurrency, async (rb) => {
        const local = allBooksMap.get(rb.hash)!;
        const deleted: Book = {
          ...local,
          deletedAt: rb.deletedAt,
          downloadedAt: null,
          coverDownloadedAt: null,
          updatedAt: Math.max(local.updatedAt ?? 0, rb.updatedAt ?? 0),
        };
        try {
          await this.store.deleteBookLocally(deleted);
          // Keep the tombstone in allBooksMap so the index re-push carries it.
          allBooksMap.set(rb.hash, deleted);
          result.booksDeleted += 1;
          syncedHashes.add(rb.hash);
        } catch (e) {
          console.warn('file sync: local delete failed', rb.hash, e);
        }
      });
    }

    // Hash directories that still exist on the remote. Populated by the discovery
    // scan below and reused by the deleted-book GC before the index re-push.
    const remoteHashDirs = new Set<string>();

    if (canPull) {
      const candidateHashes = new Set<string>();

      // 1) Seed with hashes from the remote index (when the file exists).
      if (remoteIndex && remoteIndex.books) {
        for (const rb of remoteIndex.books) {
          if (!allBooksMap.has(rb.hash) && !rb.deletedAt) {
            candidateHashes.add(rb.hash);
            // Provisionally register the indexed book — fields refreshed below
            // once we've inspected the actual hash dir.
            allBooksMap.set(rb.hash, rb);
          }
        }
      }

      // 2) Also scan the books/ directory so legacy uploads (no library.json
      //    entry) and index/disk drift are still picked up.
      try {
        const booksDirPath = `${buildBasePath(this.provider.rootPath)}/${SYNC_BOOKS_DIR}`;
        const dirEntries = await this.provider.list(booksDirPath);
        for (const entry of dirEntries) {
          if (!entry.isDirectory) continue;
          remoteHashDirs.add(entry.name);
          if (!allBooksMap.has(entry.name)) {
            candidateHashes.add(entry.name);
          }
        }
      } catch (e) {
        // 404 is normal if the user has never pushed anything yet.
        noteAbort(e);
        console.warn('file sync: failed to list books directory', e);
      }

      // 3) For every candidate, look inside its hash directory to find the
      //    actual book file (the only entry that isn't config.json/cover.png).
      for (const hash of candidateHashes) {
        if (aborted()) break;
        try {
          const hashDirPath = `${buildBasePath(this.provider.rootPath)}/${SYNC_BOOKS_DIR}/${hash}`;
          const hashDirEntries = await this.provider.list(hashDirPath);
          const fileEntry = hashDirEntries.find(
            (e) =>
              !e.isDirectory && e.name !== SYNC_BOOK_CONFIG_FILE && e.name !== SYNC_BOOK_COVER_FILE,
          );
          if (!fileEntry) continue;

          const extMatch = fileEntry.name.match(/\.([^.]+)$/);
          const ext = extMatch && extMatch[1] ? extMatch[1].toUpperCase() : 'EPUB';
          const format = ext as Book['format'];
          const title = fileEntry.name.replace(/\.[^.]+$/, '');

          // If the index already gave us a book object, refresh the fields
          // that might be wrong/stale from a previous buggy push.
          const existing = allBooksMap.get(hash);
          const book: Book = existing
            ? {
                ...existing,
                format,
                title:
                  !existing.title || existing.title.toLowerCase().endsWith(`.${ext.toLowerCase()}`)
                    ? title
                    : existing.title,
                sourceTitle: title,
                updatedAt: existing.updatedAt || Date.now(),
                createdAt: existing.createdAt || Date.now(),
              }
            : {
                hash,
                format,
                title,
                sourceTitle: title,
                author: 'Unknown',
                createdAt: Date.now(),
                updatedAt: Date.now(),
              };

          explicitRemotePaths.set(hash, fileEntry.path);
          remoteBooksToDownload.push(book);
          allBooksMap.set(hash, book);
        } catch (e) {
          noteAbort(e);
          console.warn('file sync: failed to inspect hash dir', hash, e);
        }
      }
    }

    // Discovery+download is NOT gated on `syncBooks`. The toggle controls
    // whether the *push* side ships binaries to the remote — pulling books
    // that exist remotely but not locally is the whole point of a sync.
    if (canPull) {
      let downloadStarted = 0;
      await runPool(
        remoteBooksToDownload,
        concurrency,
        async (rb) => {
          options.onProgress?.({
            book: rb,
            index: downloadStarted,
            total: remoteBooksToDownload.length,
            action: 'downloading',
          });
          downloadStarted += 1;
          try {
            const explicitPath = explicitRemotePaths.get(rb.hash);
            // Prefer the streaming downloader. On Tauri/Android we MUST take
            // this path — moving a 30 MB epub through the WebView<->Rust IPC
            // bridge as a single Uint8Array crashes the renderer.
            let written = false;
            if (this.provider.downloadStream && explicitPath) {
              const dst = await this.store.prepareLocalBookPath(rb);
              written = await this.provider.downloadStream(explicitPath, dst);
            } else {
              const remotePath = explicitPath ?? buildBookFilePath(this.provider.rootPath, rb);
              const fileBytes = await this.provider.readBinary(remotePath);
              if (fileBytes) {
                await this.store.saveBookFile(rb, fileBytes);
                written = true;
              }
            }
            if (written) {
              try {
                const coverBytes = await this.pullBookCover(rb.hash);
                if (coverBytes) await this.store.saveBookCover(rb, coverBytes);
              } catch (e) {
                console.warn('file sync: cover download failed', rb.hash, e);
              }
              // Pull the remote config so progress, bookmarks and annotations
              // travel with the book. Best-effort: a missing config is not a
              // failure.
              try {
                const emptyLocal: BookConfig = { updatedAt: 0, booknotes: [] };
                const pullResult = await this.pullBookConfig(rb, emptyLocal);
                if (pullResult.applied && pullResult.mergedConfig) {
                  await this.store.saveBookConfig(rb, pullResult.mergedConfig);
                  result.configsDownloaded += 1;
                }
              } catch (e) {
                console.warn('file sync: config download failed', rb.hash, e);
              }
              await this.store.addBookToLibrary(rb);
              result.booksDownloaded += 1;
              syncedHashes.add(rb.hash);
              // We just pulled its bytes, so the file is on the remote — record it
              // so a later push-side sync doesn't HEAD-probe it back.
              uploadedHashes.add(rb.hash);
            } else {
              // No bytes returned (typically a 404 we couldn't resolve).
              result.failures += 1;
              result.failedBooks.push({
                hash: rb.hash,
                title: rb.title || rb.hash,
                phase: 'download',
                reason: 'No bytes returned (file may have been moved or deleted on the server)',
              });
              console.warn('file sync: book download produced no bytes', rb.hash, explicitPath);
            }
          } catch (e) {
            noteAbort(e);
            result.failures += 1;
            result.failedBooks.push({
              hash: rb.hash,
              title: rb.title || rb.hash,
              phase: 'download',
              reason: formatFailureReason(e),
            });
            console.warn('file sync: book download failed', rb.hash, e);
          }
        },
        aborted,
      );
    }

    // Books we just downloaded already exist on the remote — don't re-push
    // them. Only push books already present in the caller-supplied library.
    const downloadedHashes = new Set(remoteBooksToDownload.map((b) => b.hash));
    // A book's config/cover only need pushing when it changed locally since the
    // last index push (incremental; full-sync re-checks everything). Its FILE,
    // by contrast, is immutable per hash and only needs uploading when the
    // remote copy is missing per the index's uploaded-file record (`needsFilePush`)
    // — which catches the user enabling "Upload Book Files" only after the first
    // (config-only) sync (#4856) without a per-book probe once files are recorded.
    const configChanged = (b: Book): boolean => fullSync || isLocalNewer(b);
    // Consult the merged state, not the caller's raw book: a book a peer just
    // tombstoned in this same run is now deletedAt in allBooksMap even though
    // the caller's array copy isn't — pushing it would re-upload a book we are
    // about to GC (#4860).
    const isEffectivelyDeleted = (b: Book): boolean => !!(allBooksMap.get(b.hash) ?? b).deletedAt;
    const booksToPush = books.filter(
      (b) =>
        !isEffectivelyDeleted(b) &&
        !downloadedHashes.has(b.hash) &&
        (configChanged(b) || needsFilePush(b)),
    );
    result.totalBooks = booksToPush.length;

    if (canPush && booksToPush.length > 0) {
      let pushStarted = 0;
      await runPool(
        booksToPush,
        concurrency,
        async (book) => {
          options.onProgress?.({
            book,
            index: pushStarted,
            total: booksToPush.length,
            action: 'uploading',
          });
          pushStarted += 1;
          let phase: SyncFailureEntry['phase'] = 'upload-config';
          try {
            if (configChanged(book)) {
              const config = await this.store.loadConfig(book);
              if (config) {
                // Mirror the reader hook's pull-merge-push discipline so a manual
                // "Sync now" can't blind-overwrite state this device hasn't pulled
                // yet. Only in two-way ('silent') mode — 'send' keeps the blind
                // push. A failed pull-merge falls back to the local config.
                let configToPush = config;
                if (canPull) {
                  try {
                    const pull = await this.pullBookConfig(book, config);
                    if (pull.applied && pull.mergedConfig) {
                      configToPush = pull.mergedConfig;
                      // Persist the merged superset locally so this device
                      // converges too, not just the remote.
                      await this.store.saveBookConfig(book, pull.mergedConfig);
                    }
                  } catch (e) {
                    console.warn('file sync: config pull-merge failed', book.hash, e);
                  }
                }
                await this.pushBookConfig(book, configToPush, options.deviceId);
                result.configsUploaded += 1;
                syncedHashes.add(book.hash);
              }
              // Covers ride along with the config-level sync, NOT with syncBooks:
              // the receiving device can't regenerate them without the book bytes.
              // Failures here are warnings, not hard failures.
              try {
                const coverResult = await this.pushBookCover(book);
                if (coverResult.uploaded) {
                  result.coversUploaded += 1;
                  syncedHashes.add(book.hash);
                }
              } catch (e) {
                console.warn('file sync: cover failed', book.hash, e);
              }
            }
            if (needsFilePush(book)) {
              phase = 'upload-file';
              const fileResult = await this.pushBookFile(book);
              if (fileResult.uploaded) {
                result.filesUploaded += 1;
                syncedHashes.add(book.hash);
                uploadedHashes.add(book.hash);
              } else if (fileResult.reason === 'remote-matches') {
                result.filesAlreadyInSync += 1;
                uploadedHashes.add(book.hash);
              }
              // 'no-source' → the file isn't on this device; leave it unrecorded
              // so a device that does have it can upload and record it later.
            }
          } catch (e) {
            noteAbort(e);
            result.failures += 1;
            result.failedBooks.push({
              hash: book.hash,
              title: book.title || book.hash,
              phase,
              reason: formatFailureReason(e),
            });
            console.warn('file sync: book failed', book.hash, e);
          }
        },
        aborted,
      );
    }

    // A terminal auth failure surfaced mid-run: rethrow instead of re-pushing
    // an index built from a partial run, and let the caller show one re-auth
    // error rather than a per-book failure list.
    if (abort) throw abort;

    // The final index whenever we're allowed to write, even if no binaries
    // moved this turn (keeps library.json authoritative). Union in any remote
    // entries this device never materialised (chiefly peers' tombstones):
    // rebuilding purely from allBooksMap would drop a deletion for a book we
    // never had, silently reviving it for every other device (#4860).
    if (canPush) {
      const indexByHash = new Map(allBooksMap);
      if (remoteIndex?.books) {
        for (const rb of remoteIndex.books) {
          if (!indexByHash.has(rb.hash)) indexByHash.set(rb.hash, rb);
        }
      }

      // GC the remote per-hash directory of every tombstoned book whose files
      // still linger on the server (#4860). Scoped to dirs the discovery scan
      // actually saw, so a dir removed on a previous sync is never re-DELETEd
      // and 'send' mode (which never lists) is a safe no-op. This is what makes
      // a deletion reclaim server space instead of leaving orphaned book files.
      const dirsToGc = Array.from(remoteHashDirs).filter(
        (hash) => indexByHash.get(hash)?.deletedAt,
      );
      await runPool(dirsToGc, concurrency, async (hash) => {
        try {
          await deleteRemoteBookDir(this.provider, hash);
        } catch (e) {
          console.warn('file sync: failed to GC deleted book dir', hash, e);
        }
      });

      try {
        const newIndex: RemoteLibraryIndex = {
          schemaVersion: 1,
          books: Array.from(indexByHash.values()),
          updatedAt: Date.now(),
          // Carry the uploaded-file record forward so the next incremental sync
          // stays O(changed). Keep only hashes that still map to a live indexed
          // book so the set can't grow unbounded with tombstoned / evicted books.
          uploadedHashes: Array.from(uploadedHashes).filter((hash) => {
            const b = indexByHash.get(hash);
            return !!b && !b.deletedAt;
          }),
        };
        await this.pushLibraryIndex(newIndex);
      } catch (e) {
        console.warn('file sync: failed to push index', e);
      }
    }

    result.booksSynced = syncedHashes.size;
    return result;
  }
}
