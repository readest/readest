import { Book, BookConfig, BookNote } from '@/types/book';
import type { ProgressHandler } from '@/utils/transfer';
import { isAudiobook } from '@/utils/audiobook';
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
   *
   * The local source is resolved BEFORE any remote probe: a book this device
   * does not hold can never be uploaded, so probing the remote for it buys
   * nothing — and at library scale (a cloud-only web library) it turns every
   * sync into a full per-book request storm. `no-source` costs zero requests.
   */
  async pushBookFile(book: Book): Promise<PushBookFileResult> {
    // ABS books stream from the server and never have a local file to push —
    // guard here too, not just in syncLibrary's needsFilePush, since this is
    // also called directly by the explicit per-book Upload action.
    if (isAudiobook(book)) return { uploaded: false, reason: 'no-source' };
    const dirPath = buildBookDirPath(this.provider.rootPath, book.hash);
    const path = buildBookFilePath(this.provider.rootPath, book);
    const dirs = [...ancestorsOf(`${dirPath}/.placeholder`), dirPath];

    // A thrown non-NETWORK failure (e.g. AUTH_FAILED) propagates so the
    // caller's terminal-failure latch can stop the run; a transport blip is
    // treated as "remote unknown" and the upload proceeds.
    const probeRemoteHead = async (): Promise<FileHead | null> => {
      try {
        return await this.provider.head(path);
      } catch (e) {
        if (!(e instanceof FileSyncError) || e.code !== 'NETWORK') throw e;
        return null;
      }
    };

    // Streaming path: resolve the on-disk path + size only, then stream the
    // bytes straight from disk. The metadata fetch never reads the body, so
    // heap stays flat even for gigabyte-scale PDFs.
    if (this.provider.uploadStream) {
      const src = await this.store.resolveLocalBookPath(book);
      if (src) {
        const remoteHead = await probeRemoteHead();
        if (remoteHead && remoteHead.size === src.size) {
          return { uploaded: false, reason: 'remote-matches' };
        }
        await this.ensureDirs(dirs);
        let ok = await this.provider.uploadStream(path, src.path);
        if (!ok) {
          // Mirror the buffered path's one-shot retry: a parent may have been
          // recreated mid-PUT (409). Re-ensure directories and try once more.
          await this.ensureDirs(dirs);
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

  /** GET the remote cover.png bytes for a hash, or null when absent. */
  async pullBookCover(bookHash: string): Promise<ArrayBuffer | null> {
    return this.provider.readBinary(buildBookCoverPath(this.provider.rootPath, bookHash));
  }

  /**
   * Download one book's binary from its remote hash dir into the local store,
   * plus cover + config best-effort — the explicit per-book Download action
   * (Book Details / bookshelf cloud button) for a third-party provider.
   * The on-disk filename is resolved by listing the dir (titles go stale).
   * Returns false when the remote holds no book file. `syncLibrary` only adds
   * metadata-only shelf rows; it deliberately leaves this binary transfer to
   * the explicit action.
   */
  async downloadBookFile(book: Book, onProgress?: ProgressHandler): Promise<boolean> {
    const dirPath = buildBookDirPath(this.provider.rootPath, book.hash);
    const entries = await this.provider.list(dirPath);
    const fileEntry = entries.find(
      (e) => !e.isDirectory && e.name !== SYNC_BOOK_CONFIG_FILE && e.name !== SYNC_BOOK_COVER_FILE,
    );
    if (!fileEntry) return false;

    let written = false;
    if (this.provider.downloadStream) {
      const dst = await this.store.prepareLocalBookPath(book);
      written = await this.provider.downloadStream(fileEntry.path, dst, onProgress);
    } else {
      const bytes = await this.provider.readBinary(fileEntry.path);
      if (bytes) {
        await this.store.saveBookFile(book, bytes);
        written = true;
      }
    }
    if (!written) return false;

    try {
      const coverBytes = await this.pullBookCover(book.hash);
      if (coverBytes) await this.store.saveBookCover(book, coverBytes);
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

  /** GET + parse the shared library.json index, or null when absent/malformed. */
  async pullLibraryIndex(): Promise<RemoteLibraryIndex | null> {
    const path = buildLibraryPath(this.provider.rootPath);
    return parseRemoteLibraryIndex(await this.provider.readText(path));
  }

  /** PUT the shared library.json index, creating its parent dirs. */
  async pushLibraryIndex(index: RemoteLibraryIndex): Promise<void> {
    const path = buildLibraryPath(this.provider.rootPath);
    await this.ensureDirs(ancestorsOf(path));
    await this.provider.writeText(path, JSON.stringify(index));
  }

  /**
   * Sync every book in `books` against the remote in sequence (predictable
   * progress bar; no parallel PUTs that upset shared servers). Per book:
   * pull index → reconcile metadata (LWW) → add remote-only cloud-shelf rows
   * → pull-merge-push each local config + cover + (optionally) file → re-push
   * the merged index.
   *
   * Strategy gating: 'silent' two-way, 'send' push-only, 'receive' pull-only.
   * 'send' applies nothing from the remote — no metadata reconciliation, no
   * deletion propagation, no discovery, no config pull-merge — but it is still
   * INCREMENTAL: it reads library.json to know what it already published, and
   * pushes only what changed locally. The blind local-authoritative overwrite
   * ("re-push everything, my copy wins") is `fullSync`, not `'send'`, so it is
   * reached deliberately instead of charged to every background run (#5900).
   * Single-book failures are caught and counted so one bad apple never aborts
   * the rest of the library.
   */
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

    // Distinct books touched in any direction — the single "N book(s) synced"
    // number the UI surfaces. Tracked as a set because the per-action counters
    // overlap (a Full-Sync re-check both reconciles and re-pushes the same
    // book, and one book can push a config + cover + file).
    const syncedHashes = new Set<string>();

    const strategy = options.strategy || 'silent';
    const canPull = strategy !== 'send';
    const canPush = strategy !== 'receive';
    const fullSync = options.fullSync ?? false;
    const concurrency = Math.max(1, options.concurrency ?? 4);

    let remoteIndex: RemoteLibraryIndex | null = null;
    // True when the remote index provably matches what this provider saw on
    // its previous successful run. Every peer mutation rewrites library.json,
    // so an unchanged index means no remote-side news — the run can skip the
    // index download AND the discovery scan.
    let remoteIndexUnchanged = false;
    // Read UNCONDITIONALLY, 'send' included (#5900). library.json is the shared
    // membership record, not a source of remote changes: the final re-push
    // below rebuilds it, so a run that rewrites it without having read it
    // publishes this device's state as the whole truth — dropping every
    // previously confirmed upload and every book or tombstone a peer
    // contributed that this device never materialised. The pull itself is a
    // pure read; every behaviour that APPLIES remote state to this device
    // (metadata reconciliation, deletion propagation, discovery, config
    // pull-merge, the push cursors) stays gated on `canPull` below, so 'send'
    // keeps its documented blind, local-authoritative push.
    //
    // Cheap change probe first: one metadata stat. `etag` is Drive's md5 / the
    // WebDAV ETag; a provider without one always re-pulls. An AUTH failure
    // aborts exactly like the pull below; any other probe failure falls back
    // to the full pull.
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
      // An UNREADABLE index (throw — expired session, network) is NOT the
      // same as an ABSENT one (404 → null, first-sync semantics). Proceeding
      // with a null index here would treat every local book as unpushed (an
      // attempted mass re-upload against a dead session) and the final index
      // re-push would drop the peers' tombstones it failed to read (#4860),
      // resurrecting deleted books. Abort the run instead; callers surface
      // one error.
      remoteIndex = await this.pullLibraryIndex();
      if (remoteIndex) {
        const fingerprint = JSON.stringify(remoteIndex);
        // No etag to probe with: the download already happened, so compare
        // what came back against the last snapshot instead. Identical content
        // carries the same news as a matching etag — nobody wrote since — and
        // that is what lets the discovery scan below be skipped.
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

    // Incremental cursor: a book needs a push only when its local copy is newer
    // than (or absent from) the shared library.json index. `book.updatedAt`
    // bumps on every progress / notes / metadata save, so the index is a
    // reliable per-book change marker. EVERY strategy uses it, 'send'
    // included: before #5900 send never read the index, so it re-pushed every
    // config and re-probed every cover on every run — O(library) per sync,
    // which a large library cannot afford. A book whose local row has not
    // changed since the index was written has nothing new to send, so the
    // cursor costs it nothing. Blind local-authoritative overwrite is Full
    // Sync's job (see class doc), reached deliberately rather than paid for on
    // every background run. A failed pull aborts before this point.
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
    // forward (plus this run's uploads) into the re-pushed index. Empty on a
    // fresh remote, so the first sync verifies every file once.
    //
    // 'send' now seeds it too. Before #5900 it could not (it never read the
    // index), so every Send Only run re-probed every book: an O(library) storm
    // of remote HEADs and local fs stats that made a big library unsyncable.
    // Trusting the record is what keeps EVERY incremental run O(changed),
    // whatever the strategy. The record being wrong is a drift case, and drift
    // in either direction is healed by Full Sync, which bypasses all three
    // records and audits the real filesystem — that is the escape hatch, not a
    // per-run re-audit.
    const uploadedHashes = new Set<string>(remoteIndex?.uploadedHashes ?? []);
    // A file needs (re)uploading only when syncBooks is on, the remote copy
    // isn't recorded yet, and the LIBRARY ROW says this device holds the file.
    // The row is authoritative (import / download / delete all stamp
    // downloadedAt; merges keep it device-local), so a book the row marks as
    // absent costs zero filesystem and zero remote probes — incremental sync
    // stays pure metadata diffing instead of an O(library) fs walk (the
    // Tauri plugin:fs|exists storm). The noSourceVerdicts memo additionally
    // suppresses re-probes of DRIFTED rows (row claims a file the filesystem
    // no longer has) within a session. Row-vs-filesystem split-brain in
    // either direction is healed by Full Sync, which bypasses all three
    // records and audits the real filesystem.
    let noSourceMemo = noSourceVerdicts.get(this.provider);
    if (!noSourceMemo) {
      noSourceMemo = new Map();
      noSourceVerdicts.set(this.provider, noSourceMemo);
    }
    const knownNoSource = noSourceMemo;
    const hasLocalFile = (b: Book): boolean => !!(b.downloadedAt || b.filePath);
    // ABS books stream from the server and never have a file to push, in a
    // full sync or otherwise — their config/cover still sync normally below.
    const needsFilePush = (book: Book): boolean =>
      options.syncBooks &&
      !isAudiobook(book) &&
      (fullSync ||
        (!uploadedHashes.has(book.hash) &&
          hasLocalFile(book) &&
          knownNoSource.get(book.hash) !== (book.updatedAt ?? 0)));

    // A book whose FILE is on the remote is cloud-backed, exactly like a book in
    // Readest Cloud storage — and `book.uploadedAt` is the only thing the rest of
    // the app reads to know that. Leaving it null for a provider-synced book made
    // the whole library misread it as purely-local: it could never be re-downloaded
    // (`makeBookAvailable` gates on `uploadedAt`), the shelf offered Upload instead
    // of Download, and — the data loss in #5084 — once "Remove from Device Only"
    // cleared `downloadedAt`, the stale-record cleanup treated it as a local book
    // whose file had vanished and offered a delete that GC'd it off the remote.
    // Stamps are collected and persisted in one batch at the end of the run.
    const stampedAt = Date.now();
    const cloudCopyStamps = new Map<string, Book>();
    const stampCloudCopy = (hash: string): void => {
      const current = allBooksMap.get(hash);
      if (!current || current.uploadedAt || current.deletedAt) return;
      // A fresh object, never an in-place mutation: the caller's rows are the
      // ones React renders, and a mutated row is invisible to the memo.
      const stamped: Book = { ...current, uploadedAt: stampedAt };
      allBooksMap.set(hash, stamped);
      cloudCopyStamps.set(hash, stamped);
    };
    // The index's uploaded-file record already proves the file is on the remote,
    // so a book another device (or an earlier run) pushed gets stamped without
    // any request of its own.
    for (const book of books) {
      if (uploadedHashes.has(book.hash)) stampCloudCopy(book.hash);
    }

    const remoteBooksToAdd: Book[] = [];

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
        if (!local || local.deletedAt) return false;
        // Full Sync additionally REPAIRS a shelf that lost its groups or
        // descriptions to #5911 / #5912. That is true for a whole library at
        // once and costs a library write each, so it must never run on the
        // incremental path — see isRemoteBookMissingLocally.
        return (
          shouldApplyRemoteBookMetadata(local, rb) ||
          (fullSync && isRemoteBookMissingLocally(local, rb))
        );
      });
      await runPool(
        remoteNewer,
        concurrency,
        async (rb) => {
          const local = allBooksMap.get(rb.hash)!;
          const merged = mergeBookMetadata(local, rb);
          // A book can also reach this pass with no clock newer at all, when
          // the index simply holds a group or a description this device is
          // missing (#5911 / #5912). That is an index-field repair: nothing
          // says the remote BYTES moved, so it must not cost a cover GET and a
          // config GET per book — which on a first run after the fix would be
          // one of each for the whole library.
          const bytesMayHaveMoved = isRemoteBookClockNewer(local, rb);
          // Re-pull the cover so a changed cover travels with the metadata. The
          // subsequent push-side pushBookCover HEAD/size short-circuit then
          // matches (local now equals remote), so we never bounce it back up.
          if (bytesMayHaveMoved) {
            try {
              const coverBytes = await this.pullBookCover(rb.hash);
              if (coverBytes) await this.store.saveBookCover(merged, coverBytes);
            } catch (e) {
              noteAbort(e);
              console.warn('file sync: metadata cover pull failed', rb.hash, e);
            }
          }
          // Incremental only: the per-book push loop below skips remote-newer
          // books, so pull their config here too — otherwise a peer's progress /
          // notes wouldn't propagate without re-walking every book. In full-sync
          // mode the push loop pulls each config, so we skip this to avoid a
          // duplicate GET.
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
          // Carry the peer's explicit provider-file deletion intent with the
          // tombstone. Older/ambiguous tombstones intentionally leave this
          // absent, which hides the row without destroying recoverable bytes.
          fileSyncDeletionRequestedAt: rb.fileSyncDeletionRequestedAt,
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

    // Revival stamp (#5900) — the send-mode dual of deletion propagation above.
    // 'send' keeps its live row and republishes it over the peer's tombstone,
    // but it republished the row's OLD `updatedAt`, and a peer only revives on
    // `remote.updatedAt > local.deletedAt`. A book last edited BEFORE the peer
    // deleted it could therefore never win: the peer kept re-pushing its
    // tombstone, the next send kept re-pushing the live row, and the two
    // devices ping-ponged forever without either shelf changing.
    //
    // Overriding a tombstone IS the newer decision, so stamp it as one — and
    // persist it, or the next run regresses to the old clock and a peer that
    // has not synced yet still refuses to revive. `deletedAt + 1` rather than
    // `Date.now()`: it is the smallest value that wins, and it cannot lose to a
    // peer whose wall clock runs ahead of ours (#5661).
    //
    // Send-mode only. Under 'silent' the deletion-propagation block above is
    // the authority — it either applied the tombstone (the row is deleted here
    // now) or declined it because the local edit was already newer, which the
    // published row's own `updatedAt` already proves.
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

    // Hash directories that still exist on the remote. Populated by the discovery
    // scan below and reused by the deleted-book GC before the index re-push.
    const remoteHashDirs = new Set<string>();
    // Dirs discovery already inspected and found file-less (see wire.ts).
    // Carried forward through the index so no client re-lists them every run.
    const emptyDirs = new Set<string>(remoteIndex?.emptyDirs ?? []);
    // Dirs THIS run looked inside and found a book file in. Kept so the
    // pre-push reconcile below can tell "the peer knows something we don't"
    // from "the peer's record is stale and we just disproved it".
    const confirmedNonEmptyDirs = new Set<string>();
    // Whether the books/ listing ran and succeeded this run — the empty-dir
    // record may only be pruned against a listing that actually happened.
    let booksDirListed = false;

    // Discovery is skipped when the remote index provably didn't change: a
    // peer adding a book (or a legacy client uploading one) has no way to
    // become visible without library.json changing... except a no-index
    // legacy upload, which is still picked up on the first run of a session
    // (cold cache) and on Full Sync.
    if (canPull && (!remoteIndexUnchanged || fullSync)) {
      const candidateHashes = new Set<string>();

      // 1) Seed with hashes from the remote index (when the file exists).
      if (remoteIndex && remoteIndex.books) {
        for (const rb of remoteIndex.books) {
          const local = allBooksMap.get(rb.hash);
          const revivesLocalTombstone =
            !!local?.deletedAt && (rb.updatedAt ?? 0) > (local.deletedAt ?? 0);
          if ((!local || revivesLocalTombstone) && !rb.deletedAt) {
            candidateHashes.add(rb.hash);
            // Provisionally register the indexed book — fields refreshed below
            // once we've inspected the actual hash dir. Strip the pushing
            // device's local fields: an index written by an older client still
            // carries its `filePath`, and adopting it would make this device
            // read the book as a purely-local record (#5084).
            allBooksMap.set(rb.hash, stripDeviceLocalFields(rb));
          }
        }
      }

      // 2) Also scan the books/ directory so legacy uploads (no library.json
      //    entry) and index/disk drift are still picked up.
      try {
        const booksDirPath = `${buildBasePath(this.provider.rootPath)}/${SYNC_BOOKS_DIR}`;
        const dirEntries = await this.provider.list(booksDirPath);
        booksDirListed = true;
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
        // Already inspected and file-less: don't re-list it — unless the
        // index says the file has since arrived (uploadedHashes), or a Full
        // Sync re-verifies everything.
        if (!fullSync && emptyDirs.has(hash) && !uploadedHashes.has(hash)) continue;
        try {
          const hashDirPath = `${buildBasePath(this.provider.rootPath)}/${SYNC_BOOKS_DIR}/${hash}`;
          const hashDirEntries = await this.provider.list(hashDirPath);
          const fileEntry = hashDirEntries.find(
            (e) =>
              !e.isDirectory && e.name !== SYNC_BOOK_CONFIG_FILE && e.name !== SYNC_BOOK_COVER_FILE,
          );
          if (!fileEntry) {
            emptyDirs.add(hash);
            continue;
          }
          emptyDirs.delete(hash);
          confirmedNonEmptyDirs.add(hash);

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

          remoteBooksToAdd.push(book);
          allBooksMap.set(hash, book);
        } catch (e) {
          noteAbort(e);
          console.warn('file sync: failed to inspect hash dir', hash, e);
        }
      }
    }

    // Discovery is NOT gated on `syncBooks`. The toggle controls whether this
    // device uploads local book files. A remote-only book is materialised as a
    // cloud-shelf row with its cover and reading config, while the immutable
    // book file stays on the provider until the user opens or downloads it
    // explicitly (#5009). This keeps secondary devices lightweight regardless
    // of which FileSyncProvider transport is active.
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
              }
            } catch (e) {
              console.warn('file sync: cover download failed', rb.hash, e);
            }

            // Pull the remote config so progress, bookmarks and annotations
            // are ready before the placeholder appears. Best-effort: a missing
            // config or cover must not hide an otherwise downloadable book.
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

            rb.uploadedAt = rb.uploadedAt ?? Date.now();
            rb.downloadedAt = null;
            await this.store.addBookToLibrary(rb);
            result.booksAdded += 1;
            syncedHashes.add(rb.hash);
            // Discovery confirmed the immutable file exists remotely. Record
            // it so future incremental passes do not HEAD-probe or re-discover it.
            uploadedHashes.add(rb.hash);
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

    // Books we just added already exist on the remote — don't re-push
    // them. Only push books already present in the caller-supplied library.
    const addedHashes = new Set(remoteBooksToAdd.map((b) => b.hash));
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
        !addedHashes.has(b.hash) &&
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
                stampCloudCopy(book.hash);
              } else if (fileResult.reason === 'remote-matches') {
                result.filesAlreadyInSync += 1;
                uploadedHashes.add(book.hash);
                stampCloudCopy(book.hash);
              } else if (fileResult.reason === 'no-source') {
                // The file isn't on this device; remember the verdict for this
                // exact row so the next run doesn't re-pay the fs probes. It
                // stays out of uploadedHashes so a device that does have the
                // file can upload and record it later.
                knownNoSource.set(book.hash, book.updatedAt ?? 0);
              }
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
          const local = indexByHash.get(rb.hash);
          if (!local) {
            indexByHash.set(rb.hash, rb);
            continue;
          }
          // Publishing must never DELETE the group or the description the
          // remote already carries — that clobber, on a row this device merely
          // TIED, is what emptied every peer's shelf (#5911 / #5912). Pure
          // in-memory over a map this push already walks: no request, no
          // library write, incremental sync stays O(changed).
          indexByHash.set(rb.hash, resolvePublishedBook(local, rb));
        }
      }

      // GC only when the current tombstone carries a matching, explicit
      // provider-file deletion authorization (#5695). `deletedAt` by itself is
      // library membership state and can come from older clients or indirect
      // cleanup paths; treating it as permission to destroy the only remaining
      // copy is what made "Remove from Device Only" destructive. Equality binds
      // the authorization to this deletion and rejects a stale marker left by a
      // prior delete/re-import cycle. Discovery scoping still avoids repeated
      // DELETEs, and send mode (which never lists) remains a safe no-op.
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

      // Prune the empty-dir record to dirs that still exist — but only against
      // a listing that actually ran, so a discovery-skipped run can't wipe it.
      if (booksDirListed) {
        for (const hash of Array.from(emptyDirs)) {
          if (!remoteHashDirs.has(hash)) emptyDirs.delete(hash);
        }
      }

      // Carry the uploaded-file record forward so the next incremental sync
      // stays O(changed). Keep only hashes that still map to a live indexed
      // book so the set can't grow unbounded with tombstoned / evicted books.
      const buildRecords = () => ({
        uploadedHashes: Array.from(uploadedHashes).filter((hash) => {
          const b = indexByHash.get(hash);
          return !!b && !b.deletedAt;
        }),
        emptyDirs: Array.from(emptyDirs),
      });
      const { uploadedHashes: nextUploadedHashes, emptyDirs: nextEmptyDirs } = buildRecords();

      // Skip the re-push when the rebuilt index is semantically identical to
      // the pulled one: a restamped byte-copy only churns the remote and
      // invalidates every other device's etag-based change detection. The
      // check is deliberately conservative — any per-book activity, failure,
      // record change, or local row the remote lacks (or trails) pushes.
      const remoteAllByHash = new Map((remoteIndex?.books ?? []).map((b) => [b.hash, b] as const));
      const indexDirty =
        remoteIndex === null ||
        syncedHashes.size > 0 ||
        result.failures > 0 ||
        !sameStringSet(nextUploadedHashes, remoteIndex.uploadedHashes ?? []) ||
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
          // FULL SYNC ONLY: last-moment reconcile. Everything above was
          // computed from the index as it looked when this run STARTED, and a
          // peer syncing in parallel may have rewritten it since — so
          // publishing the rebuild as-is drops whatever that peer added. Re-read
          // and fold its entries in by hash, ours winning where both have an
          // opinion.
          //
          // Deliberately NOT done on the incremental path. It costs a second
          // GET of library.json on every pushing run (tens to hundreds of KB
          // for a real library), and the incremental contract is speed, not
          // convergence: it is best-effort, runs unattended on every library
          // change, and is allowed to lose a race. Full Sync is where this
          // library pays for correctness — the same split that already makes it
          // the repair path for row-vs-filesystem drift above. A lost row is
          // in any case re-published by the device that owns it locally, since
          // membership is a union-by-hash CRDT.
          //
          // Even here the window is narrowed, not closed: two Full Syncs whose
          // PUTs land between this read and the write still race. Closing it
          // needs a conditional write, and there is nothing portable to
          // condition on — `head()` exposes no version token at all on iCloud
          // and only a server-dependent one on WebDAV, so an If-Match
          // capability would have to be added to FileSyncProvider and degrade
          // per backend. Follow-up.
          if (fullSync) {
            const fresh = await this.pullLibraryIndex();
            for (const rb of fresh?.books ?? []) {
              if (!indexByHash.has(rb.hash)) indexByHash.set(rb.hash, rb);
            }
            for (const hash of fresh?.uploadedHashes ?? []) uploadedHashes.add(hash);
            for (const hash of fresh?.emptyDirs ?? []) {
              // ...except a dir THIS run looked inside and found a file in.
              // That is newer knowledge than the peer's record, not a
              // competing entry.
              if (!confirmedNonEmptyDirs.has(hash)) emptyDirs.add(hash);
            }
          }
          const merged = buildRecords();

          const newIndex: RemoteLibraryIndex = {
            schemaVersion: 1,
            books: Array.from(indexByHash.values()).map(stripDeviceLocalFields),
            updatedAt: Date.now(),
            uploadedHashes: merged.uploadedHashes,
            emptyDirs: merged.emptyDirs,
          };
          await this.pushLibraryIndex(newIndex);
          // Our own push changed the remote etag; drop the cached snapshot so
          // the next run re-pulls (and re-discovers) once, then goes quiet.
          remoteIndexCache.delete(this.provider);
        } catch (e) {
          result.indexPushFailed = true;
          console.warn('file sync: failed to push index', e);
        }
      }
    }

    // Persist the cloud-copy stamps in one library write. They must survive a
    // restart: a row that boots without `uploadedAt` is read as purely-local
    // again, which is what made "Remove from Device Only" destructive (#5084).
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
