import { Book, BookConfig, BookNote } from '@/types/book';
import type { ProgressHandler } from '@/utils/transfer';
import { isAudiobook } from '@/utils/audiobook';
import { FileEntry, FileHead, FileSyncError, FileSyncProvider } from './provider';
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
  SYNC_PART_FILE_SUFFIX,
  SYNC_BACKUP_FILE_SUFFIX,
} from './layout';
import {
  buildRemotePayload,
  parseRemotePayload,
  parseRemoteLibraryIndex,
  stripDeviceLocalFields,
  RemoteLibraryIndex,
} from './wire';
import {
  isRemoteBookClockNewer,
  isRemoteBookMissingLocally,
  mergeBookConfig,
  mergeBookMetadata,
  resolvePublishedBook,
  shouldApplyRemoteBookMetadata,
} from './merge';
import { pickFresherCover } from '@/app/library/utils/libraryUtils';

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
  /** Remote-only books added to the local shelf without downloading their files (#5009). */
  booksAdded: number;
  /** Local books removed because a peer's tombstone propagated to this device (#4860). */
  booksDeleted: number;
  /** Already-local books whose metadata was refreshed from a newer index copy (#4756). */
  metadataUpdated: number;
  /** Distinct books that had any sync activity (pushed, added, or reconciled). */
  booksSynced: number;
  failures: number;
  /** Per-book failure breakdown for the diagnostic log in the Settings UI. */
  failedBooks: SyncFailureEntry[];
  /**
   * True when the shared library.json write itself failed (#5900). The per-book
   * uploads may all have succeeded, yet nothing converged: peers read
   * membership, tombstones and the uploaded-file record from that one file. A
   * run that could not write it must not be reported as a plain success.
   */
  indexPushFailed: boolean;
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
 * A hash-dir entry that is the actual book binary: not the metadata files and
 * not a temp file (dotfiles / the LAN server's `.part` partial uploads, which
 * disappear on completion or abort).
 */
const isSyncableFileEntry = (e: FileEntry): boolean =>
  !e.isDirectory &&
  e.name !== SYNC_BOOK_CONFIG_FILE &&
  e.name !== SYNC_BOOK_COVER_FILE &&
  !e.name.startsWith('.') &&
  !e.name.endsWith(SYNC_PART_FILE_SUFFIX) &&
  !e.name.endsWith(SYNC_BACKUP_FILE_SUFFIX);

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
 * The last successfully pulled library.json per provider instance, with both
 * change signals we can get: the `etag` when the backend has one, and a
 * `fingerprint` of the content when it does not. Providers are memoised per
 * connection (see providerRegistry), so this lives for the session and dies
 * with a reconnect / settings change.
 *
 * An etag match skips the index download entirely. A fingerprint match cannot
 * (we had to download it to compare), but it still proves no peer wrote since
 * our last run — which is what lets the run skip the DISCOVERY SCAN, a full
 * listing of books/. Without it, a backend with no etag (iCloud; WebDAV
 * servers that omit the header) re-listed the whole remote directory on every
 * incremental sync, which a large library cannot afford.
 *
 * Entries are cloned on read AND write so neither the caching run nor a
 * reusing run can pollute the snapshot through in-place row mutations.
 */
const remoteIndexCache = new WeakMap<
  FileSyncProvider,
  { etag?: string; fingerprint: string; index: RemoteLibraryIndex }
>();

/**
 * Per-provider memo of "this device holds no source for this book" verdicts,
 * keyed to the book's `updatedAt` at the time of the verdict. Without it,
 * every sync run re-walks all books whose file is recorded nowhere and pays
 * two local fs probes per book per run (the Tauri plugin:fs|exists storm)
 * just to relearn the same answer. A book re-qualifies for a probe only when
 * its local row changes (any download or progress save bumps `updatedAt`),
 * on Full Sync, or in a fresh session (same lifetime as the provider memo).
 */
const noSourceVerdicts = new WeakMap<FileSyncProvider, Map<string, number>>();

/** Order-insensitive string-array equality (duplicates collapse). */
const sameStringSet = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  const bs = new Set(b);
  return a.every((x) => bs.has(x));
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
   * Directories already created (or confirmed to exist) during this engine
   * instance's sync session. The engine passes the FULL ancestor chain
   * (`/Readest`, `/Readest/books`, `/Readest/books/<hash>`) to `ensureDir` for
   * every book, so without this cache the shared parents get re-created on each
   * book — a redundant round-trip, and a 409 "name already exists" flood on
   * providers that create folders explicitly (OneDrive) or re-MKCOL (WebDAV).
   * S3's `ensureDir` no-ops and Drive caches path->id internally, so both are
   * unaffected. The engine is built per sync session, so the cache lifetime is
   * one run.
   */
  private readonly ensuredDirs = new Set<string>();
  /**
   * In-flight per-dir creations, so the concurrency-bounded book workers that
   * all find a shared parent missing on a fresh remote collapse to one create
   * instead of several racing calls.
   */
  private readonly ensuringDirs = new Map<string, Promise<void>>();

  /**
   * Session-cached, single-flighted wrapper over {@link FileSyncProvider.ensureDir}.
   * Ensures each dir top-down (order preserved), skipping any already ensured
   * this session and de-duplicating concurrent creates of the same path. A
   * failed create is not cached, so it is retried on the next call.
   */
  private async ensureDirs(dirs: string[]): Promise<void> {
    for (const dir of dirs) {
      if (this.ensuredDirs.has(dir)) continue;
      let pending = this.ensuringDirs.get(dir);
      if (!pending) {
        pending = this.provider
          .ensureDir([dir])
          .then(() => {
            this.ensuredDirs.add(dir);
          })
          .finally(() => {
            this.ensuringDirs.delete(dir);
          });
        this.ensuringDirs.set(dir, pending);
      }
      await pending;
    }
  }

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
    await this.ensureDirs(dirs);
    const body = JSON.stringify(buildRemotePayload(book, config, deviceId));
    try {
      await this.provider.writeText(path, body);
    } catch (e) {
      if (e instanceof FileSyncError && e.status === 409) {
        await this.ensureDirs(dirs);
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
   * Providers with `requireBookStreaming` never enter that buffered fallback.
   *
   * The local source is resolved BEFORE any remote probe: a book this device
   * does not hold can never be uploaded, so probing the remote for it buys
   * nothing — and at library scale (a cloud-only web library) it turns every
   * sync into a full per-book request storm. `no-source` costs zero requests.
   */
  async pushBookFile(book: Book): Promise<PushBookFileResult> {
    if (isAudiobook(book)) return { uploaded: false, reason: 'no-source' };
    const dirPath = buildBookDirPath(this.provider.rootPath, book.hash);
    const path = buildBookFilePath(this.provider.rootPath, book);
    const dirs = [...ancestorsOf(`${dirPath}/.placeholder`), dirPath];
    const requireStreaming = this.provider.requireBookStreaming === true;

    const probeRemoteHead = async (): Promise<FileHead | null> => {
      try {
        return await this.provider.head(path);
      } catch (e) {
        if (!(e instanceof FileSyncError) || e.code !== 'NETWORK') throw e;
        return null;
      }
    };

    if (this.provider.uploadStream) {
      const src = await this.store.resolveLocalBookPath(book);
      if (!src) {
        // The buffered loader resolves the same source but then reads the whole
        // thing into JS. A stream-required provider must not use that as a
        // second probe; report the honest no-source verdict instead.
        if (requireStreaming) return { uploaded: false, reason: 'no-source' };
      } else {
        const remoteHead = await probeRemoteHead();
        if (remoteHead && remoteHead.size === src.size) {
          return { uploaded: false, reason: 'remote-matches' };
        }
        await this.ensureDirs(dirs);
        const ok = await this.provider.uploadStream(path, src.path);
        if (ok) return { uploaded: true };
        if (requireStreaming) {
          throw new FileSyncError(
            'Native book upload stream was unavailable; buffered fallback is disabled',
            'UNKNOWN',
          );
        }
      }
    } else if (requireStreaming) {
      throw new FileSyncError(
        'Native book upload stream is not available; buffered fallback is disabled',
        'UNKNOWN',
      );
    }

    const local = await this.store.loadBookFile(book);
    if (!local) return { uploaded: false, reason: 'no-source' };
    const remoteHead = await probeRemoteHead();
    if (remoteHead && remoteHead.size === local.size) {
      return { uploaded: false, reason: 'remote-matches' };
    }
    await this.ensureDirs(dirs);
    try {
      await this.provider.writeBinary(path, local.bytes);
    } catch (e) {
      if (e instanceof FileSyncError && e.status === 409) {
        await this.ensureDirs(dirs);
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
  async pushBookCover(book: Book, forceUpload = false): Promise<PushBookFileResult> {
    const dirPath = buildBookDirPath(this.provider.rootPath, book.hash);
    const path = buildBookCoverPath(this.provider.rootPath, book.hash);
    const dirs = [...ancestorsOf(`${dirPath}/.placeholder`), dirPath];

    const local = await this.store.loadBookCover(book);
    if (!local) return { uploaded: false, reason: 'no-source' };

    let remoteHead: FileHead | null = null;
    try {
      remoteHead = await this.provider.head(path);
    } catch (e) {
      if (!(e instanceof FileSyncError) || e.code !== 'NETWORK') throw e;
    }
    if (!forceUpload && remoteHead && remoteHead.size === local.size) {
      return { uploaded: false, reason: 'remote-matches' };
    }
    await this.ensureDirs(dirs);
    try {
      await this.provider.writeBinary(path, local.bytes, 'image/png');
    } catch (e) {
      if (e instanceof FileSyncError && e.status === 409) {
        await this.ensureDirs(dirs);
        await this.provider.writeBinary(path, local.bytes, 'image/png');
      } else {
        throw e;
      }
    }
    return { uploaded: true };
  }

  async pullBookCover(bookHash: string): Promise<ArrayBuffer | null> {
    return this.provider.readBinary(buildBookCoverPath(this.provider.rootPath, bookHash));
  }

  async downloadBookFile(book: Book, onProgress?: ProgressHandler): Promise<boolean> {
    const dirPath = buildBookDirPath(this.provider.rootPath, book.hash);
    const entries = await this.provider.list(dirPath);
    const fileEntry = entries.find((e) => isSyncableFileEntry(e));
    if (!fileEntry) return false;

    const requireStreaming = this.provider.requireBookStreaming === true;
    let written = false;
    if (this.provider.downloadStream) {
      const dst = await this.store.prepareLocalBookPath(book);
      written = await this.provider.downloadStream(fileEntry.path, dst, onProgress);
      if (!written && requireStreaming) {
        throw new FileSyncError(
          'Native book download stream was unavailable; buffered fallback is disabled',
          'UNKNOWN',
        );
      }
    } else if (requireStreaming) {
      throw new FileSyncError(
        'Native book download stream is not available; buffered fallback is disabled',
        'UNKNOWN',
      );
    }
    if (!written) {
      const bytes = await this.provider.readBinary(fileEntry.path);
      if (bytes) {
        await this.store.saveBookFile(book, bytes);
        written = true;
      }
    }
    if (!written) return false;

    try {
      const coverBytes = await this.pullBookCover(book.hash);
      if (coverBytes) {
        await this.store.saveBookCover(book, coverBytes);
        book.coverDownloadedAt = Date.now();
      }
    } catch (e) {
      console.warn('file sync: cover download failed', book.hash, e);
    }
    try {
      const localConfig = (await this.store.loadConfig(book)) ?? { updatedAt: 0, booknotes: [] };
      const pull = await this.pullBookConfig(book, localConfig);
      if (pull.applied && pull.mergedConfig) {
        await this.store.saveBookConfig(book, pull.mergedConfig);
      }
    } catch (e) {
      console.warn('file sync: config download failed', book.hash, e);
    }
    return true;
  }

  async pullLibraryIndex(): Promise<RemoteLibraryIndex | null> {
    const path = buildLibraryPath(this.provider.rootPath);
    return parseRemoteLibraryIndex(await this.provider.readText(path));
  }

  async pushLibraryIndex(index: RemoteLibraryIndex): Promise<void> {
    const path = buildLibraryPath(this.provider.rootPath);
    await this.ensureDirs(ancestorsOf(path));
    await this.provider.writeText(path, JSON.stringify(index));
  }

  async syncLibrary(books: Book[], options: SyncLibraryOptions): Promise<SyncLibraryResult> {
    const result: SyncLibraryResult = {
      totalBooks: books.length,
      configsUploaded: 0,
      configsDownloaded: 0,
      filesUploaded: 0,
      filesAlreadyInSync: 0,
      coversUploaded: 0,
      booksAdded: 0,
      booksDeleted: 0,
      metadataUpdated: 0,
      booksSynced: 0,
      failures: 0,
      failedBooks: [],
      indexPushFailed: false,
    };

    const syncedHashes = new Set<string>();

    const strategy = options.strategy || 'silent';
    const canPull = strategy !== 'send';
    const canPush = strategy !== 'receive';
    const fullSync = options.fullSync ?? false;
    const concurrency = Math.max(1, options.concurrency ?? 4);
    const bookTransferConcurrency = Math.min(
      concurrency,
      Math.max(1, this.provider.maxConcurrentBookTransfers ?? concurrency),
    );

    let remoteIndex: RemoteLibraryIndex | null = null;
    let remoteIndexUnchanged = false;
    let remoteEtag: string | undefined;
    if (!fullSync) {
      try {
        remoteEtag = (await this.provider.head(buildLibraryPath(this.provider.rootPath)))?.etag;
      } catch (e) {
        if (e instanceof FileSyncError && e.code === 'AUTH_FAILED') throw e;
      }
    }
    const cachedIndex = remoteIndexCache.get(this.provider);
    if (!fullSync && remoteEtag !== undefined && cachedIndex && cachedIndex.etag === remoteEtag) {
      remoteIndex = structuredClone(cachedIndex.index);
      remoteIndexUnchanged = true;
    } else {
      remoteIndex = await this.pullLibraryIndex();
      if (remoteIndex) {
        const fingerprint = JSON.stringify(remoteIndex);
        if (!fullSync && remoteEtag === undefined && cachedIndex?.fingerprint === fingerprint) {
          remoteIndexUnchanged = true;
        }
        remoteIndexCache.set(this.provider, {
          etag: remoteEtag,
          fingerprint,
          index: structuredClone(remoteIndex),
        });
      }
    }

    let abort: FileSyncError | null = null;
    const noteAbort = (e: unknown): void => {
      if (!abort && e instanceof FileSyncError && e.code === 'AUTH_FAILED') abort = e;
    };
    const aborted = (): boolean => abort !== null;

    const allBooksMap = new Map<string, Book>();
    for (const b of books) allBooksMap.set(b.hash, b);

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

    const uploadedHashes = new Set<string>(remoteIndex?.uploadedHashes ?? []);
    const coverCursorKnown = Array.isArray(remoteIndex?.coveredHashes);
    const coveredHashes = new Set<string>(remoteIndex?.coveredHashes ?? []);
    let noSourceMemo = noSourceVerdicts.get(this.provider);
    if (!noSourceMemo) {
      noSourceMemo = new Map();
      noSourceVerdicts.set(this.provider, noSourceMemo);
    }
    const knownNoSource = noSourceMemo;
    const hasLocalFile = (b: Book): boolean => !!(b.downloadedAt || b.filePath);
    const needsFilePush = (book: Book): boolean =>
      options.syncBooks &&
      !isAudiobook(book) &&
      (fullSync ||
        (!uploadedHashes.has(book.hash) &&
          hasLocalFile(book) &&
          knownNoSource.get(book.hash) !== (book.updatedAt ?? 0)));
    const localCoverIsNewer = (book: Book): boolean => {
      const remote = remoteByHash.get(book.hash);
      return (
        !!book.coverHash &&
        book.coverHash !== remote?.coverHash &&
        (book.coverUpdatedAt ?? 0) > (remote?.coverUpdatedAt ?? 0)
      );
    };
    const needsCoverPush = (book: Book): boolean =>
      fullSync ||
      localCoverIsNewer(book) ||
      (!coveredHashes.has(book.hash) && (!!book.coverHash || !coverCursorKnown));

    const stampedAt = Date.now();
    const cloudCopyStamps = new Map<string, Book>();
    const stampCloudCopy = (hash: string): void => {
      const current = allBooksMap.get(hash);
      if (!current || current.uploadedAt || current.deletedAt) return;
      const stamped: Book = { ...current, uploadedAt: stampedAt };
      allBooksMap.set(hash, stamped);
      cloudCopyStamps.set(hash, stamped);
    };
    for (const book of books) {
      if (uploadedHashes.has(book.hash)) stampCloudCopy(book.hash);
    }

    const remoteBooksToAdd: Book[] = [];

    if (canPull && remoteIndex && remoteIndex.books) {
      const remoteNewer = remoteIndex.books.filter((rb) => {
        if (rb.deletedAt) return false;
        const local = allBooksMap.get(rb.hash);
        if (!local || local.deletedAt) return false;
        const coverRepair =
          canPull &&
          (fullSync || coveredHashes.has(rb.hash) || !coverCursorKnown) &&
          (!local.coverDownloadedAt ||
            (!!rb.coverHash &&
              rb.coverHash !== local.coverHash &&
              (rb.coverUpdatedAt ?? 0) > (local.coverUpdatedAt ?? 0)));
        return (
          shouldApplyRemoteBookMetadata(local, rb) ||
          (fullSync && isRemoteBookMissingLocally(local, rb)) ||
          coverRepair
        );
      });
      await runPool(
        remoteNewer,
        concurrency,
        async (rb) => {
          const local = allBooksMap.get(rb.hash)!;
          const merged = mergeBookMetadata(local, rb);
          const bytesMayHaveMoved = isRemoteBookClockNewer(local, rb);
          const coverRepair =
            canPull &&
            (fullSync || coveredHashes.has(rb.hash) || !coverCursorKnown) &&
            (!local.coverDownloadedAt ||
              (!!rb.coverHash &&
                rb.coverHash !== local.coverHash &&
                (rb.coverUpdatedAt ?? 0) > (local.coverUpdatedAt ?? 0)));
          const metadataChanged =
            shouldApplyRemoteBookMetadata(local, rb) ||
            (fullSync && isRemoteBookMissingLocally(local, rb));
          const remoteCoverIsFresher =
            !local.coverHash ||
            (!!rb.coverHash &&
              rb.coverHash !== local.coverHash &&
              (rb.coverUpdatedAt ?? 0) > (local.coverUpdatedAt ?? 0));
          const remoteCoverMatchesLocal = !!local.coverHash && rb.coverHash === local.coverHash;
          if (bytesMayHaveMoved || coverRepair) {
            try {
              const coverBytes = await this.pullBookCover(rb.hash);
              if (coverBytes) {
                coveredHashes.add(rb.hash);
                merged.coverDownloadedAt = Date.now();
                if (remoteCoverIsFresher || remoteCoverMatchesLocal) {
                  const cover = pickFresherCover(local, rb);
                  merged.coverHash = cover.coverHash;
                  merged.coverUpdatedAt = cover.coverUpdatedAt;
                  await this.store.saveBookCover(merged, coverBytes);
                }
                if (!metadataChanged) await this.store.updateBookCover?.(merged);
              }
            } catch (e) {
              noteAbort(e);
              console.warn('file sync: metadata cover pull failed', rb.hash, e);
            }
          }
          if (!fullSync && bytesMayHaveMoved) {
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
            if (metadataChanged) {
              await this.store.updateBookMetadata(merged);
              result.metadataUpdated += 1;
            }
            allBooksMap.set(rb.hash, merged);
            syncedHashes.add(rb.hash);
          } catch (e) {
            console.warn('file sync: metadata update failed', rb.hash, e);
          }
        },
        aborted,
      );
    }

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
          fileSyncDeletionRequestedAt: rb.fileSyncDeletionRequestedAt,
          downloadedAt: null,
          coverDownloadedAt: null,
          updatedAt: Math.max(local.updatedAt ?? 0, rb.updatedAt ?? 0),
        };
        try {
          await this.store.deleteBookLocally(deleted);
          allBooksMap.set(rb.hash, deleted);
          result.booksDeleted += 1;
          syncedHashes.add(rb.hash);
        } catch (e) {
          console.warn('file sync: local delete failed', rb.hash, e);
        }
      });
    }

    if (!canPull && canPush && remoteIndex?.books) {
      const revivals = remoteIndex.books.filter((rb) => {
        if (!rb.deletedAt) return false;
        const local = allBooksMap.get(rb.hash);
        return !!local && !local.deletedAt && (local.updatedAt ?? 0) <= rb.deletedAt;
      });
      await runPool(revivals, concurrency, async (rb) => {
        const local = allBooksMap.get(rb.hash)!;
        const revived: Book = { ...local, updatedAt: rb.deletedAt! + 1 };
        try {
          await this.store.updateBookMetadata(revived);
          allBooksMap.set(rb.hash, revived);
          syncedHashes.add(rb.hash);
        } catch (e) {
          console.warn('file sync: revival stamp failed', rb.hash, e);
        }
      });
    }

    const remoteHashDirs = new Set<string>();
    const emptyDirs = new Set<string>(remoteIndex?.emptyDirs ?? []);
    const confirmedNonEmptyDirs = new Set<string>();
    let booksDirListed = false;

    if (canPull && (!remoteIndexUnchanged || fullSync)) {
      const candidateHashes = new Set<string>();
      const indexSeededHashes = new Set<string>();

      if (remoteIndex && remoteIndex.books) {
        for (const rb of remoteIndex.books) {
          const local = allBooksMap.get(rb.hash);
          const revivesLocalTombstone =
            !!local?.deletedAt && (rb.updatedAt ?? 0) > (local.deletedAt ?? 0);
          if ((!local || revivesLocalTombstone) && !rb.deletedAt) {
            candidateHashes.add(rb.hash);
            indexSeededHashes.add(rb.hash);
            allBooksMap.set(rb.hash, stripDeviceLocalFields(rb));
          }
        }
      }

      try {
        const booksDirPath = `${buildBasePath(this.provider.rootPath)}/${SYNC_BOOKS_DIR}`;
        const dirEntries = await this.provider.list(booksDirPath);
        booksDirListed = true;
        for (const entry of dirEntries) {
          if (!entry.isDirectory) continue;
          remoteHashDirs.add(entry.name);
          if (!allBooksMap.has(entry.name)) candidateHashes.add(entry.name);
        }
      } catch (e) {
        noteAbort(e);
        console.warn('file sync: failed to list books directory', e);
      }

      for (const hash of candidateHashes) {
        if (aborted()) break;
        if (!fullSync && emptyDirs.has(hash) && !uploadedHashes.has(hash)) continue;
        try {
          const hashDirPath = `${buildBasePath(this.provider.rootPath)}/${SYNC_BOOKS_DIR}/${hash}`;
          const hashDirEntries = await this.provider.list(hashDirPath);
          const fileEntry = hashDirEntries.find((e) => isSyncableFileEntry(e));
          if (!fileEntry) {
            if (indexSeededHashes.has(hash)) {
              const indexed = allBooksMap.get(hash);
              if (indexed) {
                remoteBooksToAdd.push(indexed);
                allBooksMap.set(hash, indexed);
              }
            } else {
              emptyDirs.add(hash);
            }
            continue;
          }
          emptyDirs.delete(hash);
          confirmedNonEmptyDirs.add(hash);

          const extMatch = fileEntry.name.match(/\.([^.]+)$/);
          const ext = extMatch && extMatch[1] ? extMatch[1].toUpperCase() : 'EPUB';
          const format = ext as Book['format'];
          const title = fileEntry.name.replace(/\.[^.]+$/, '');
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

          remoteBooksToAdd.push(book);
          allBooksMap.set(hash, book);
        } catch (e) {
          noteAbort(e);
          console.warn('file sync: failed to inspect hash dir', hash, e);
        }
      }
    }

    if (canPull) {
      let addStarted = 0;
      await runPool(
        remoteBooksToAdd,
        concurrency,
        async (rb) => {
          options.onProgress?.({
            book: rb,
            index: addStarted,
            total: remoteBooksToAdd.length,
            action: 'downloading',
          });
          addStarted += 1;
          try {
            try {
              const coverBytes = await this.pullBookCover(rb.hash);
              if (coverBytes) {
                await this.store.saveBookCover(rb, coverBytes);
                rb.coverDownloadedAt = Date.now();
                coveredHashes.add(rb.hash);
              }
            } catch (e) {
              console.warn('file sync: cover download failed', rb.hash, e);
            }

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

            if (confirmedNonEmptyDirs.has(rb.hash)) {
              rb.uploadedAt = rb.uploadedAt ?? Date.now();
            }
            rb.downloadedAt = null;
            await this.store.addBookToLibrary(rb);
            result.booksAdded += 1;
            syncedHashes.add(rb.hash);
            if (confirmedNonEmptyDirs.has(rb.hash)) uploadedHashes.add(rb.hash);
          } catch (e) {
            noteAbort(e);
            result.failures += 1;
            result.failedBooks.push({
              hash: rb.hash,
              title: rb.title || rb.hash,
              phase: 'download',
              reason: formatFailureReason(e),
            });
            console.warn('file sync: cloud-shelf add failed', rb.hash, e);
          }
        },
        aborted,
      );
    }

    const addedHashes = new Set(remoteBooksToAdd.map((b) => b.hash));
    const configChanged = (b: Book): boolean => fullSync || isLocalNewer(b);
    const isEffectivelyDeleted = (b: Book): boolean => !!(allBooksMap.get(b.hash) ?? b).deletedAt;
    const booksToPush = books.filter(
      (b) =>
        !isEffectivelyDeleted(b) &&
        !addedHashes.has(b.hash) &&
        (configChanged(b) || needsFilePush(b) || needsCoverPush(b)),
    );
    result.totalBooks = booksToPush.length;

    if (canPush && booksToPush.length > 0) {
      let metaStarted = 0;
      const metadataBooks = booksToPush.filter((b) => configChanged(b));
      await runPool(
        metadataBooks,
        concurrency,
        async (book) => {
          options.onProgress?.({
            book,
            index: metaStarted,
            total: metadataBooks.length,
            action: 'uploading',
          });
          metaStarted += 1;
          try {
            const config = await this.store.loadConfig(book);
            if (config) {
              let configToPush = config;
              if (canPull) {
                try {
                  const pull = await this.pullBookConfig(book, config);
                  if (pull.applied && pull.mergedConfig) {
                    configToPush = pull.mergedConfig;
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
          } catch (e) {
            noteAbort(e);
            result.failures += 1;
            result.failedBooks.push({
              hash: book.hash,
              title: book.title || book.hash,
              phase: 'upload-config',
              reason: formatFailureReason(e),
            });
            console.warn('file sync: book metadata failed', book.hash, e);
          }
        },
        aborted,
      );

      const coverBooks = booksToPush.filter((b) => needsCoverPush(b));
      await runPool(
        coverBooks,
        concurrency,
        async (book) => {
          try {
            const coverResult = await this.pushBookCover(
              book,
              fullSync ||
                !coverCursorKnown ||
                !coveredHashes.has(book.hash) ||
                localCoverIsNewer(book),
            );
            if (coverResult.uploaded || coverResult.reason === 'remote-matches') {
              coveredHashes.add(book.hash);
              if (coverResult.uploaded) result.coversUploaded += 1;
              syncedHashes.add(book.hash);
            }
          } catch (e) {
            noteAbort(e);
            console.warn('file sync: cover failed', book.hash, e);
          }
        },
        aborted,
      );

      let fileStarted = 0;
      const fileBooks = booksToPush.filter((b) => needsFilePush(b));
      await runPool(
        fileBooks,
        bookTransferConcurrency,
        async (book) => {
          options.onProgress?.({
            book,
            index: fileStarted,
            total: fileBooks.length,
            action: 'uploading-files',
          });
          fileStarted += 1;
          try {
            const fileResult = await this.pushBookFile(book);
            if (fileResult.uploaded) {
              result.filesUploaded += 1;
              syncedHashes.add(book.hash);
              uploadedHashes.add(book.hash);
              stampCloudCopy(book.hash);
            } else if (fileResult.reason === 'remote-matches') {
              result.filesAlreadyInSync += 1;
              uploadedHashes.add(book.hash);
              stampCloudCopy(book.hash);
            } else if (fileResult.reason === 'no-source') {
              knownNoSource.set(book.hash, book.updatedAt ?? 0);
            }
          } catch (e) {
            noteAbort(e);
            result.failures += 1;
            result.failedBooks.push({
              hash: book.hash,
              title: book.title || book.hash,
              phase: 'upload-file',
              reason: formatFailureReason(e),
            });
            console.warn('file sync: book file failed', book.hash, e);
          }
        },
        aborted,
      );
    }

    if (abort) throw abort;

    if (canPush) {
      const indexByHash = new Map(allBooksMap);
      if (remoteIndex?.books) {
        for (const rb of remoteIndex.books) {
          const local = indexByHash.get(rb.hash);
          if (!local) {
            indexByHash.set(rb.hash, rb);
            continue;
          }
          indexByHash.set(rb.hash, resolvePublishedBook(local, rb));
        }
      }

      const dirsToGc = Array.from(remoteHashDirs).filter((hash) => {
        const book = indexByHash.get(hash);
        return !!book?.deletedAt && book.fileSyncDeletionRequestedAt === book.deletedAt;
      });
      await runPool(dirsToGc, concurrency, async (hash) => {
        try {
          await deleteRemoteBookDir(this.provider, hash);
        } catch (e) {
          console.warn('file sync: failed to GC deleted book dir', hash, e);
        }
      });

      if (booksDirListed) {
        for (const hash of Array.from(emptyDirs)) {
          if (!remoteHashDirs.has(hash)) emptyDirs.delete(hash);
        }
      }

      const buildRecords = () => ({
        uploadedHashes: Array.from(uploadedHashes).filter((hash) => {
          const b = indexByHash.get(hash);
          return !!b && !b.deletedAt;
        }),
        emptyDirs: Array.from(emptyDirs),
        coveredHashes: Array.from(coveredHashes).filter((hash) => {
          const b = indexByHash.get(hash);
          return !!b && !b.deletedAt;
        }),
      });
      const {
        uploadedHashes: nextUploadedHashes,
        emptyDirs: nextEmptyDirs,
        coveredHashes: nextCoveredHashes,
      } = buildRecords();

      const remoteAllByHash = new Map((remoteIndex?.books ?? []).map((b) => [b.hash, b] as const));
      const indexDirty =
        remoteIndex === null ||
        syncedHashes.size > 0 ||
        result.failures > 0 ||
        !coverCursorKnown ||
        !sameStringSet(nextUploadedHashes, remoteIndex.uploadedHashes ?? []) ||
        !sameStringSet(nextCoveredHashes, remoteIndex.coveredHashes ?? []) ||
        !sameStringSet(nextEmptyDirs, remoteIndex.emptyDirs ?? []) ||
        books.some((b) => {
          const r = remoteAllByHash.get(b.hash);
          if (!r) return true;
          if (!!r.deletedAt !== !!b.deletedAt) return true;
          if ((r.fileSyncDeletionRequestedAt ?? 0) !== (b.fileSyncDeletionRequestedAt ?? 0))
            return true;
          return (b.updatedAt ?? 0) > (r.updatedAt ?? 0);
        });

      if (indexDirty) {
        try {
          if (fullSync) {
            const fresh = await this.pullLibraryIndex();
            for (const rb of fresh?.books ?? []) {
              if (!indexByHash.has(rb.hash)) indexByHash.set(rb.hash, rb);
            }
            for (const hash of fresh?.uploadedHashes ?? []) uploadedHashes.add(hash);
            for (const hash of fresh?.coveredHashes ?? []) coveredHashes.add(hash);
            for (const hash of fresh?.emptyDirs ?? []) {
              if (!confirmedNonEmptyDirs.has(hash)) emptyDirs.add(hash);
            }
          }
          const merged = buildRecords();

          const newIndex: RemoteLibraryIndex = {
            schemaVersion: 1,
            books: Array.from(indexByHash.values()).map(stripDeviceLocalFields),
            updatedAt: Date.now(),
            uploadedHashes: merged.uploadedHashes,
            coveredHashes: merged.coveredHashes,
            emptyDirs: merged.emptyDirs,
          };
          await this.pushLibraryIndex(newIndex);
          remoteIndexCache.delete(this.provider);
        } catch (e) {
          result.indexPushFailed = true;
          console.warn('file sync: failed to push index', e);
        }
      }
    }

    if (cloudCopyStamps.size > 0) {
      try {
        await this.store.markBooksUploaded(Array.from(cloudCopyStamps.keys()), stampedAt);
      } catch (e) {
        console.warn('file sync: failed to persist cloud-copy stamps', e);
      }
    }

    result.booksSynced = syncedHashes.size;
    return result;
  }
}
