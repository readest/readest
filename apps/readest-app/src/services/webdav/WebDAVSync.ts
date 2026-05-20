import { Book, BookConfig, BookNote } from '@/types/book';
import { WebDAVSettings } from '@/types/settings';
import {
  WebDAVConfig,
  buildBasicAuthHeader,
  buildRequestUrl,
  deleteDirectory,
  ensureDirectory,
  getFile,
  getFileBinary,
  headFile,
  listDirectory,
  putFile,
  putFileBinary,
  WebDAVRequestError,
} from './WebDAVClient';
import {
  ancestorsOf,
  buildBasePath,
  buildBookConfigPath,
  buildBookCoverPath,
  buildBookDirPath,
  buildBookFilePath,
  buildLibraryPath,
  WEBDAV_BOOKS_DIR,
} from './WebDAVPaths';

/**
 * Per-book remote payload stored at
 *   <rootPath>/Readest/books/<hash>/config.json
 *
 * The wire format is a thin envelope around the existing local
 * `BookConfig` so the merge logic can stay identical to readest's other
 * sync providers (per-field updatedAt LWW for top-level keys, per-note
 * updatedAt + deletedAt for booknotes). The envelope adds the bare
 * minimum "who/when last wrote this" metadata so clients can detect
 * cross-device clobbers and surface them in diagnostics.
 */
export interface RemoteBookConfig {
  schemaVersion: 1;
  bookHash: string;
  metaHash?: string;
  /** Trimmed BookConfig — only the keys we care about syncing. */
  config: Partial<BookConfig>;
  /** Booknotes carry their own per-note updatedAt/deletedAt for merging. */
  booknotes: BookNote[];
  writerDeviceId: string;
  writerVersion: 'readest-webdav-1';
  /** When the writer last touched the row (client wall clock, millis). */
  updatedAt: number;
}

/**
 * Convert the live local BookConfig into the wire envelope. We deliberately
 * drop transient view state (search config, RSVP position, viewSettings,
 * etc.) — those are device-local UI preferences, not progress.
 *
 * Why viewSettings stays local even though it lives in BookConfig:
 *   - Different devices have different screen sizes / DPI / typography
 *     preferences. Pushing a phone's 14pt setting onto a desktop would
 *     surprise users in a bad way.
 *   - readest's own cloud sync similarly carves out viewSettings from
 *     cross-device replication. Duplicating that policy here keeps the
 *     two backends behaviourally aligned.
 *   - The trim list below is the SOURCE OF TRUTH for what travels —
 *     when adding a new BookConfig field, decide here whether it's a
 *     "reading state" (include) or a "device preference" (skip).
 *
 * Anything not in `trimmed` therefore never reaches the server, and
 * conversely `pullBookConfig` only ever merges fields the server
 * actually carries (see filteredRemote spread there) — so a malicious
 * or buggy server can't somehow inject viewSettings into a local config.
 */
const buildRemotePayload = (book: Book, config: BookConfig, deviceId: string): RemoteBookConfig => {
  const trimmed: Partial<BookConfig> = {
    progress: config.progress,
    location: config.location,
    xpointer: config.xpointer,
    updatedAt: config.updatedAt,
  };
  return {
    schemaVersion: 1,
    bookHash: book.hash,
    metaHash: book.metaHash,
    config: trimmed,
    booknotes: config.booknotes ?? [],
    writerDeviceId: deviceId,
    writerVersion: 'readest-webdav-1',
    updatedAt: Date.now(),
  };
};

const parseRemotePayload = (raw: string | null): RemoteBookConfig | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RemoteBookConfig;
    if (!parsed || parsed.schemaVersion !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
};

const toClientConfig = (settings: WebDAVSettings): WebDAVConfig => ({
  serverUrl: settings.serverUrl,
  username: settings.username,
  password: settings.password,
});

/**
 * Per-note merge: pick the locally-stored copy or the remote copy of each
 * note based on `updatedAt` / `deletedAt`. Mirrors `processNewNote` in
 * `useNotesSync.ts` so users get the same semantics regardless of which
 * sync backend produced the row.
 *
 * Implementation detail: a note is keyed by `id`. When the same id exists
 * on both sides we keep whichever side has the larger updatedAt; ties go
 * to the side whose `deletedAt` is more recent (which usually means the
 * deletion came after the creation/edit).
 */
const mergeNotes = (local: BookNote[], remote: BookNote[]): BookNote[] => {
  const byId = new Map<string, BookNote>();
  for (const n of local) byId.set(n.id, n);
  for (const r of remote) {
    const l = byId.get(r.id);
    if (!l) {
      byId.set(r.id, r);
      continue;
    }
    const lUpdated = l.updatedAt ?? 0;
    const rUpdated = r.updatedAt ?? 0;
    const lDeleted = l.deletedAt ?? 0;
    const rDeleted = r.deletedAt ?? 0;
    if (rUpdated > lUpdated || rDeleted > lDeleted) {
      byId.set(r.id, { ...l, ...r });
    } else {
      byId.set(r.id, { ...r, ...l });
    }
  }
  return Array.from(byId.values());
};

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

/**
 * Pull `<rootPath>/Readest/books/<hash>/config.json`, merge into the
 * provided local config, and return the merged result. The caller is
 * responsible for writing the merged config back via the bookData store
 * (so this module stays free of React/store dependencies).
 *
 * Returns `applied: false` when the remote file doesn't exist yet or its
 * envelope is malformed. Auth failures and other server errors propagate
 * as `WebDAVRequestError` so the caller can show a toast.
 */
export const pullBookConfig = async (
  settings: WebDAVSettings,
  book: Book,
  localConfig: BookConfig,
): Promise<PullResult> => {
  const path = buildBookConfigPath(settings.rootPath, book.hash);
  const raw = await getFile(toClientConfig(settings), path);
  const remote = parseRemotePayload(raw);
  if (!remote) {
    return { applied: false };
  }
  // Top-level field merge: same per-config updatedAt LWW that the native
  // cloud sync uses in useProgressSync.applyRemoteProgress.
  const remoteConfigUpdated = remote.config.updatedAt ?? remote.updatedAt;
  const localConfigUpdated = localConfig.updatedAt ?? 0;
  // Drop null/undefined fields the server might have left in (e.g. an
  // older client that didn't write `xpointer`). Crucially, this also
  // means the spread below can NEVER introduce server-driven values for
  // keys the server isn't supposed to care about (viewSettings,
  // searchConfig, RSVP) — those keys never appear in `remote.config` to
  // begin with because `buildRemotePayload` strips them on push. The
  // invariant "wire envelope only carries reading state" therefore
  // protects pull as well as push.
  const filteredRemote = Object.fromEntries(
    Object.entries(remote.config).filter(([, v]) => v !== null && v !== undefined),
  ) as Partial<BookConfig>;
  const mergedConfig: BookConfig =
    remoteConfigUpdated >= localConfigUpdated
      ? ({ ...localConfig, ...filteredRemote } as BookConfig)
      : ({ ...filteredRemote, ...localConfig } as BookConfig);
  const mergedNotes = mergeNotes(localConfig.booknotes ?? [], remote.booknotes ?? []);
  mergedConfig.booknotes = mergedNotes;
  return {
    applied: true,
    mergedConfig,
    mergedNotes,
    remoteDeviceId: remote.writerDeviceId,
  };
};

/**
 * Push the local BookConfig to the remote. Creates parent directories as
 * needed (idempotent — MKCOL 405 is treated as success). The caller
 * provides a stable deviceId so we can record which device last wrote
 * the file.
 *
 * If the remote already has a strictly newer payload, we still overwrite —
 * deciding whether to push is the caller's responsibility (it has the
 * strategy / preview-mode context). This function is the dumb mechanism.
 */
export const pushBookConfig = async (
  settings: WebDAVSettings,
  book: Book,
  config: BookConfig,
  deviceId: string,
): Promise<void> => {
  const client = toClientConfig(settings);
  const dirPath = buildBookDirPath(settings.rootPath, book.hash);
  const path = buildBookConfigPath(settings.rootPath, book.hash);
  // Ensure every ancestor up to and including the per-book directory.
  const dirs = [...ancestorsOf(`${dirPath}/.placeholder`), dirPath];
  await ensureDirectory(client, dirs);
  const payload = buildRemotePayload(book, config, deviceId);
  try {
    await putFile(client, path, JSON.stringify(payload));
  } catch (e) {
    if (e instanceof WebDAVRequestError && e.status === 409) {
      // 409 from PUT means a parent disappeared between our MKCOL and the
      // PUT. Re-create the chain and retry once.
      await ensureDirectory(client, dirs);
      await putFile(client, path, JSON.stringify(payload));
      return;
    }
    throw e;
  }
};

export interface BookFileSource {
  /** Bytes to upload. The caller owns reading them off disk. */
  bytes: ArrayBuffer;
  /** Total byte length, used for the HEAD-vs-local size short-circuit. */
  size: number;
}

export type BookFileLoader = () => Promise<BookFileSource | null>;

/**
 * Streaming alternative to {@link BookFileLoader}: hands the syncer a
 * cheap-to-resolve metadata bundle (just `size` is needed for the
 * HEAD-vs-local short-circuit) plus an `upload` callback that streams
 * the bytes directly from disk to the WebDAV server, never letting the
 * full file land in the JS heap.
 *
 * Why this exists separately from BookFileLoader:
 *   - `loader` materialises the entire file as an ArrayBuffer up-front,
 *     which is fine for small books (a few MB) but a hard kill switch
 *     for a library of multi-hundred-megabyte PDFs: each book opens
 *     its own ArrayBuffer in the renderer's V8 heap, and even with
 *     sequential `pushBookFile` calls the GC can't reliably free them
 *     before the next `arrayBuffer()` allocates. After 2–3 large
 *     books the renderer hits the heap ceiling and the WebView
 *     crashes — symptom: the entire UI goes blank mid-sync.
 *   - The streaming loader hands the file path to a Tauri command
 *     (`upload_file` via `tauriUpload`) which reads + uploads off the
 *     Rust side in chunks. JS heap stays flat regardless of book size.
 *
 * Callers should provide `streamingLoader` when running on Tauri (where
 * `tauriUpload` is available) and fall back to `loader` on web targets
 * that don't have a streaming HTTP primitive.
 */
export interface BookFileStreamingSource {
  /** File size in bytes, for the HEAD-vs-local short-circuit. */
  size: number;
  /**
   * Stream the bytes to `remoteUrl` via PUT. Authentication headers
   * are pre-baked by the caller (typically via {@link buildBasicAuthHeader})
   * because the streaming primitive can't see the WebDAV settings.
   * Returns `true` on success, `false` when the upload was skipped or
   * failed in a way the caller wants to swallow.
   */
  upload: (remoteUrl: string, headers: Record<string, string>) => Promise<boolean>;
}

export type BookFileStreamingLoader = () => Promise<BookFileStreamingSource | null>;

export interface PushBookFileResult {
  /** True when bytes were uploaded; false when the upload was skipped. */
  uploaded: boolean;
  /** Reason for the skip, when applicable — surfaced for diagnostics. */
  reason?: 'remote-matches' | 'no-source' | 'disabled';
}

/**
 * Upload the book file binary to
 *   <rootPath>/Readest/books/<hash>/<safe-title>.<ext>
 *
 * Idempotency story: the path lives under the per-hash directory, so the
 * remote location is uniquely determined by `book.hash` (the local hash
 * of the file's content). A HEAD probe + size compare lets us skip a
 * re-upload whenever the remote already has a copy of the matching size,
 * which in practice means we only PUT bytes the very first time a book
 * is seen on a device. Renaming a book locally never re-uploads — we
 * MOVE the friendly file name in a future patch (Step 3).
 *
 * Two upload modes are supported and mutually exclusive:
 *   - {@link BookFileStreamingLoader} (preferred when available): hands
 *     the file path off to a Tauri-side streamer. Constant JS heap
 *     regardless of book size — required for libraries with multi-
 *     hundred-megabyte PDFs, where buffering was crashing the renderer.
 *   - {@link BookFileLoader} (fallback): materialises the file as an
 *     ArrayBuffer in JS, then PUTs it via `putFileBinary`. Fine for
 *     small files; OOMs the WebView for large libraries.
 *
 * Pass `streamingLoader` when running on Tauri; pass `loader` otherwise.
 * Passing both makes streaming win — the HEAD short-circuit is shared
 * either way so steady-state syncs cost a single round-trip per book.
 */
export const pushBookFile = async (
  settings: WebDAVSettings,
  book: Book,
  loader: BookFileLoader,
  streamingLoader?: BookFileStreamingLoader,
): Promise<PushBookFileResult> => {
  const client = toClientConfig(settings);
  const dirPath = buildBookDirPath(settings.rootPath, book.hash);
  const path = buildBookFilePath(settings.rootPath, book);

  // Cheap probe first — if the remote already has a same-sized blob we
  // know it's the same content (hash-keyed directory, single file inside).
  let remoteHead: { size?: number } | null = null;
  try {
    remoteHead = await headFile(client, path);
  } catch (e) {
    // HEAD failures other than 404 propagate; the caller decides whether
    // to surface them as a toast.
    if (!(e instanceof WebDAVRequestError) || e.code !== 'NETWORK') throw e;
  }

  // Streaming path: resolve metadata only, then stream bytes off disk.
  // The metadata fetch (file.size) doesn't read the body, so heap
  // stays flat even for gigabyte-scale PDFs.
  if (streamingLoader) {
    const meta = await streamingLoader();
    if (!meta) {
      // Loader returned null — most often "file isn't on this device";
      // check the buffered loader as a last resort so callers that
      // wired both keep working when one path is unavailable.
      if (!loader) return { uploaded: false, reason: 'no-source' };
    } else {
      if (remoteHead && remoteHead.size === meta.size) {
        return { uploaded: false, reason: 'remote-matches' };
      }
      const dirs = [...ancestorsOf(`${dirPath}/.placeholder`), dirPath];
      await ensureDirectory(client, dirs);
      const remoteUrl = buildRequestUrl(settings.serverUrl, path);
      const headers: Record<string, string> = {
        Authorization: buildBasicAuthHeader(settings.username, settings.password),
      };
      const ok = await meta.upload(remoteUrl, headers);
      if (!ok) {
        // Some upstream servers return 409 if a parent is recreated
        // mid-PUT. Mirror the buffered path's one-shot retry: re-
        // ensure directories and try again. The caller's `upload`
        // implementation owns the actual error mapping; we just give
        // it one more chance.
        await ensureDirectory(client, dirs);
        const retried = await meta.upload(remoteUrl, headers);
        if (!retried) {
          throw new WebDAVRequestError('Streaming upload failed', undefined, 'NETWORK');
        }
      }
      return { uploaded: true };
    }
  }

  const local = await loader();
  if (!local) {
    return { uploaded: false, reason: 'no-source' };
  }

  if (remoteHead && remoteHead.size === local.size) {
    return { uploaded: false, reason: 'remote-matches' };
  }

  const dirs = [...ancestorsOf(`${dirPath}/.placeholder`), dirPath];
  await ensureDirectory(client, dirs);
  try {
    await putFileBinary(client, path, local.bytes);
  } catch (e) {
    if (e instanceof WebDAVRequestError && e.status === 409) {
      await ensureDirectory(client, dirs);
      await putFileBinary(client, path, local.bytes);
    } else {
      throw e;
    }
  }
  return { uploaded: true };
};

/**
 * Upload the book's cover image to
 *   <rootPath>/Readest/books/<hash>/cover.png
 *
 * Same idempotency model as `pushBookFile`: HEAD-probe + size compare,
 * then PUT only when missing or sized differently. Covers are tiny
 * (typically 50–200 KB), but multiplied across a 100-book library they
 * still add up — the HEAD short-circuit keeps the steady state cheap.
 *
 * Why a separate function (rather than rolling into `pushBookFile`):
 *   - Most readers don't enable `syncBooks` in v1; covers travel with
 *     books rather than configs, but should be a stand-alone primitive
 *     so a future "syncCovers" toggle can reuse it.
 *   - readest fetches custom covers via metadata services that produce
 *     better art than what's embedded in the EPUB. Those custom covers
 *     can't be regenerated on the receiving device, so syncing them is
 *     the only way to preserve user choice across devices.
 */
export const pushBookCover = async (
  settings: WebDAVSettings,
  bookHash: string,
  loader: BookFileLoader,
): Promise<PushBookFileResult> => {
  const client = toClientConfig(settings);
  const dirPath = buildBookDirPath(settings.rootPath, bookHash);
  const path = buildBookCoverPath(settings.rootPath, bookHash);

  let remoteHead: { size?: number } | null = null;
  try {
    remoteHead = await headFile(client, path);
  } catch (e) {
    if (!(e instanceof WebDAVRequestError) || e.code !== 'NETWORK') throw e;
  }

  const local = await loader();
  // Covers are best-effort — books without a local cover are a normal
  // state (TXT/MD without metadata), so a missing source is not a
  // failure and the caller shouldn't toast about it.
  if (!local) return { uploaded: false, reason: 'no-source' };

  if (remoteHead && remoteHead.size === local.size) {
    return { uploaded: false, reason: 'remote-matches' };
  }

  const dirs = [...ancestorsOf(`${dirPath}/.placeholder`), dirPath];
  await ensureDirectory(client, dirs);
  try {
    await putFileBinary(client, path, local.bytes, 'image/png');
  } catch (e) {
    if (e instanceof WebDAVRequestError && e.status === 409) {
      await ensureDirectory(client, dirs);
      await putFileBinary(client, path, local.bytes, 'image/png');
    } else {
      throw e;
    }
  }
  return { uploaded: true };
};

export const pullBookFile = async (
  settings: WebDAVSettings,
  book: Book,
  explicitPath?: string,
): Promise<ArrayBuffer | null> => {
  const client = toClientConfig(settings);
  const path = explicitPath ?? buildBookFilePath(settings.rootPath, book);
  return getFileBinary(client, path);
};

export const pullBookCover = async (
  settings: WebDAVSettings,
  bookHash: string,
): Promise<ArrayBuffer | null> => {
  const client = toClientConfig(settings);
  const path = buildBookCoverPath(settings.rootPath, bookHash);
  return getFileBinary(client, path);
};

/**
 * Delete the per-book directory `<rootPath>/Readest/books/<hash>/`
 * — the file, the cover and the config.json — from the WebDAV
 * server in one round-trip.
 *
 * Used by the WebDAV browser's cleanup mode to evict orphans (remote
 * dirs whose local Book carries `deletedAt`). We deliberately do
 * *not* touch the local library here: the local row's `deletedAt`
 * tombstone is the signal that propagates the deletion to other
 * sync clients, and clearing it would resurrect the book on next
 * push from a sibling device. See the cleanup-pane comment in
 * `WebDAVBrowsePane.tsx` for the broader rationale.
 *
 * The result shape mirrors {@link PushBookFileResult} so callers
 * batching a list of hashes can aggregate without exception
 * boilerplate. AUTH failures still throw — they're a global
 * condition, not a per-book problem, and the caller surfaces a
 * single re-auth toast.
 */
export interface DeleteRemoteBookDirResult {
  /** True when the server confirmed deletion (or the dir was already gone). */
  ok: boolean;
  /** Compact reason string when `ok === false`, for the failure toast. */
  reason?: string;
}

export const deleteRemoteBookDir = async (
  settings: WebDAVSettings,
  bookHash: string,
): Promise<DeleteRemoteBookDirResult> => {
  const client = toClientConfig(settings);
  const path = buildBookDirPath(settings.rootPath, bookHash);
  try {
    await deleteDirectory(client, path);
    return { ok: true };
  } catch (e) {
    // Auth failures aren't a "this hash failed" condition — every
    // subsequent hash would fail the same way. Re-throw so the
    // batch loop can short-circuit and the caller can surface a
    // single re-auth prompt.
    if (e instanceof WebDAVRequestError && e.code === 'AUTH_FAILED') throw e;
    return {
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
};

export interface RemoteLibraryIndex {
  schemaVersion: 1;
  books: Book[];
  updatedAt: number;
}

export const pullLibraryIndex = async (
  settings: WebDAVSettings,
): Promise<RemoteLibraryIndex | null> => {
  const client = toClientConfig(settings);
  const path = buildLibraryPath(settings.rootPath);
  const raw = await getFile(client, path);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RemoteLibraryIndex;
    if (parsed && parsed.schemaVersion === 1) return parsed;
  } catch {
    // Ignore parse errors
  }
  return null;
};

export const pushLibraryIndex = async (
  settings: WebDAVSettings,
  index: RemoteLibraryIndex,
): Promise<void> => {
  const client = toClientConfig(settings);
  const path = buildLibraryPath(settings.rootPath);
  const dirs = ancestorsOf(path);
  await ensureDirectory(client, dirs);
  await putFile(client, path, JSON.stringify(index));
};

/**
 * Aggregate result of a library-wide push. Counters are kept granular
 * so the UI can render an honest "X uploaded, Y already in sync, Z
 * failed" toast at the end.
 */
export interface SyncLibraryResult {
  totalBooks: number;
  configsUploaded: number;
  configsDownloaded: number;
  filesUploaded: number;
  filesAlreadyInSync: number;
  coversUploaded: number;
  booksDownloaded: number;
  failures: number;
  /**
   * Per-book failure breakdown for the diagnostic log surfaced in the
   * Settings UI. Populated alongside `failures` so the user-facing log
   * can show which books failed and why without needing to re-run with
   * verbose console output. `reason` is a short single-line string —
   * the caller is responsible for truncating server XML / stacks
   * before persisting.
   */
  failedBooks: SyncFailureEntry[];
}

export interface SyncFailureEntry {
  hash: string;
  title: string;
  reason: string;
  /** Which phase of the per-book pipeline failed; helps users self-triage. */
  phase: 'download' | 'upload-config' | 'upload-file' | 'upload-cover';
}

export interface SyncLibraryOptions {
  syncBooks: boolean;
  strategy?: 'silent' | 'send' | 'receive';
  loadConfig: (book: Book) => Promise<BookConfig | null>;
  /**
   * Provider that returns the bytes of a book's local file. Resolve to
   * `null` when the book hasn't been downloaded locally — those books
   * are silently skipped (they'll be picked up on the device that
   * actually has the binary).
   */
  loadBookFile: (book: Book) => Promise<BookFileSource | null>;
  /**
   * Streaming alternative to {@link SyncLibraryOptions.loadBookFile}.
   * When supplied, the per-book upload path uses this in preference to
   * `loadBookFile`, handing the file off to a transport that streams
   * the bytes off disk directly to the WebDAV server. Required for
   * libraries with multi-hundred-megabyte books — see
   * {@link BookFileStreamingSource} for the heap-pressure rationale.
   *
   * Tauri callers should provide this; web callers (where streaming
   * PUTs aren't available) leave it undefined and fall back to the
   * buffered `loadBookFile` path.
   */
  loadBookFileStreaming?: (book: Book) => Promise<BookFileStreamingSource | null>;
  /**
   * Provider that returns the bytes of a book's local cover image.
   * Books without a cover (e.g. plaintext imports) resolve to `null`
   * and are silently skipped — covers are best-effort, not load-bearing.
   */
  loadBookCover?: (book: Book) => Promise<BookFileSource | null>;
  saveBookFile?: (book: Book, bytes: ArrayBuffer) => Promise<void>;
  /**
   * Streaming alternative to (pullBookFile + saveBookFile) — when
   * provided, the syncer hands the caller the *remote WebDAV path* and
   * expects the caller to download + persist the bytes itself. This is
   * how the Tauri app keeps gigabyte-scale book payloads out of the
   * WebView heap (which crashes Android with a Binder OOM otherwise).
   * Return `true` when the book was successfully written; `false` when
   * the server returned 404 / nothing to download.
   */
  downloadBookFile?: (book: Book, remotePath: string) => Promise<boolean>;
  saveBookCover?: (book: Book, bytes: ArrayBuffer) => Promise<void>;
  /**
   * Persist a freshly-downloaded BookConfig to local disk so progress,
   * bookmarks, and annotations are available the next time the user
   * opens the book. Called once per book whose remote config existed.
   */
  saveBookConfig?: (book: Book, config: BookConfig) => Promise<void>;
  addBookToLibrary?: (book: Book) => Promise<void>;
  /** Stable per-device id; written into every config envelope. */
  deviceId: string;
  /**
   * Optional progress callback fired before each book is processed,
   * suitable for driving a UI like "Syncing 3 / 42 — Project Hail Mary".
   */
  onProgress?: (info: { book: Book; index: number; total: number; action?: string }) => void;
}

/**
 * Push every book in `books` to the WebDAV remote in sequence. Designed
 * for the user-facing "Sync now" flow, where we trade parallelism for
 * a predictable progress bar and for not hammering shared servers.
 *
 * Per-book steps:
 *   1. Load the local config from disk (skip the book if it has none —
 *      brand-new entries the user has never opened don't need to sync
 *      anything yet).
 *   2. `pushBookConfig` — creates `Readest/books/<hash>/config.json`.
 *   3. `pushBookFile` (only when `syncBooks` is on) — HEAD-probes the
 *      friendly file name path, uploads if missing or size-mismatched.
 *   4. `pushBookCover` (only when `syncBooks` is on AND a cover loader
 *      was provided) — same HEAD-then-PUT pattern. Cover failures are
 *      treated as warnings, not failures, since they don't break the
 *      reading experience on the receiving device.
 *
 * Failures on a single book are caught and counted; we keep going so a
 * single bad apple doesn't abort the rest of the library. The aggregate
 * counters returned to the caller drive the final toast.
 */
/**
 * Reduce an arbitrary error to a short, single-line description suitable
 * for surfacing in the user-visible sync log.
 *
 * Goals:
 *   - Strip stack traces and any embedded server XML so the persisted
 *     `syncLog` in settings.json doesn't bloat (settings is read on every
 *     app start, so size matters).
 *   - Preserve the semantically useful bits — HTTP status, our own
 *     `code` enum (`AUTH_FAILED`, `NOT_FOUND`, `NETWORK`) — because that
 *     is what tells a user whether they should re-tap or fix their
 *     credentials.
 *   - Cap at 200 chars so a runaway server response doesn't make a
 *     single failure entry dominate the log file.
 */
const formatFailureReason = (e: unknown): string => {
  let message: string;
  if (e instanceof WebDAVRequestError) {
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
  // Collapse whitespace (newlines, tabs from server XML) to single spaces
  // so the entry stays a true one-liner in the UI.
  message = message.replace(/\s+/g, ' ').trim();
  return message.length > 200 ? `${message.slice(0, 197)}...` : message;
};

export const syncLibrary = async (
  settings: WebDAVSettings,
  books: Book[],
  options: SyncLibraryOptions,
): Promise<SyncLibraryResult> => {
  const result: SyncLibraryResult = {
    totalBooks: books.length,
    configsUploaded: 0,
    configsDownloaded: 0,
    filesUploaded: 0,
    filesAlreadyInSync: 0,
    coversUploaded: 0,
    booksDownloaded: 0,
    failures: 0,
    failedBooks: [],
  };

  const strategy = options.strategy || 'silent';
  const canPull = strategy !== 'send';
  const canPush = strategy !== 'receive';

  let remoteIndex: RemoteLibraryIndex | null = null;
  if (canPull) {
    try {
      remoteIndex = await pullLibraryIndex(settings);
    } catch (e) {
      console.warn('WD library sync: failed to pull index', e);
    }
  }

  const allBooksMap = new Map<string, Book>();
  for (const b of books) {
    allBooksMap.set(b.hash, b);
  }

  const remoteBooksToDownload: Book[] = [];
  // The remote source of truth for "what filename does this book actually
  // have on disk" is the per-hash directory listing — NOT the book's title
  // (which may have been written into library.json before makeSafeFilename
  // existed, or by an older buggy build). We always resolve the path by
  // listing the hash dir.
  const explicitRemotePaths = new Map<string, string>();

  if (canPull) {
    const client = toClientConfig(settings);
    const candidateHashes = new Set<string>();

    // 1) Seed with hashes from the remote index (when the file exists).
    if (remoteIndex && remoteIndex.books) {
      for (const rb of remoteIndex.books) {
        if (!allBooksMap.has(rb.hash) && !rb.deletedAt) {
          candidateHashes.add(rb.hash);
          // Provisionally register the indexed book — fields will be
          // refreshed below once we've inspected the actual hash dir.
          allBooksMap.set(rb.hash, rb);
        }
      }
    }

    // 2) Also scan the books/ directory so legacy uploads (no library.json
    //    entry) and any drift between index and disk are still picked up.
    try {
      const booksDirPath = `${buildBasePath(settings.rootPath)}/${WEBDAV_BOOKS_DIR}`;
      const dirEntries = await listDirectory(client, booksDirPath);
      for (const entry of dirEntries) {
        if (entry.isDirectory && !allBooksMap.has(entry.name)) {
          candidateHashes.add(entry.name);
        }
      }
    } catch (e) {
      // 404 is normal if the user has never pushed anything yet.
      console.warn('WD library sync: failed to list books directory', e);
    }

    // 3) For every candidate, look inside its hash directory to find the
    //    actual book file (the only entry that isn't config.json/cover.png).
    //    We use that file's real path for the GET and derive title/format
    //    from its real name — independent of whatever is in library.json.
    for (const hash of candidateHashes) {
      try {
        const hashDirPath = `${buildBasePath(settings.rootPath)}/${WEBDAV_BOOKS_DIR}/${hash}`;
        const hashDirEntries = await listDirectory(client, hashDirPath);
        const fileEntry = hashDirEntries.find(
          (e) => !e.isDirectory && e.name !== 'config.json' && e.name !== 'cover.png',
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
              // Only override title/sourceTitle when the existing values
              // look broken (no value, or contain the file extension).
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
        console.warn('WD library sync: failed to inspect hash dir', hash, e);
      }
    }
  }

  // Discovery+download is *not* gated on `syncBooks`. The toggle controls
  // whether the *push* side ships binaries to the remote — pulling books
  // that exist remotely but not locally is the whole point of a sync, and
  // the user already paid the storage cost on the remote side. Without
  // this, a fresh device with `syncBooks: false` (the default) would
  // never see any of the books in the WebDAV root, which is the exact
  // "I only see 1 / 5 books" footgun users have hit.
  if (canPull && (options.saveBookFile || options.downloadBookFile) && options.addBookToLibrary) {
    for (let i = 0; i < remoteBooksToDownload.length; i++) {
      const rb = remoteBooksToDownload[i]!;
      options.onProgress?.({
        book: rb,
        index: i,
        total: remoteBooksToDownload.length,
        action: 'downloading',
      });
      try {
        const explicitPath = explicitRemotePaths.get(rb.hash);
        // Prefer the streaming downloader when the caller provides one.
        // On Tauri/Android we MUST take this path — moving a 30 MB epub
        // through the WebView <-> Rust IPC bridge as a single Uint8Array
        // crashes the renderer.
        let written = false;
        if (options.downloadBookFile && explicitPath) {
          written = await options.downloadBookFile(rb, explicitPath);
        } else if (options.saveBookFile) {
          const fileBytes = await pullBookFile(settings, rb, explicitPath);
          if (fileBytes) {
            await options.saveBookFile(rb, fileBytes);
            written = true;
          }
        }
        if (written) {
          if (options.saveBookCover) {
            try {
              const coverBytes = await pullBookCover(settings, rb.hash);
              if (coverBytes) await options.saveBookCover(rb, coverBytes);
            } catch (e) {
              console.warn('WD library sync: cover download failed', rb.hash, e);
            }
          }
          // Pull the remote config so progress, bookmarks and annotations
          // travel with the book. This is best-effort: a missing config
          // simply means "no remote progress yet" and is not a failure.
          if (options.saveBookConfig) {
            try {
              const emptyLocal: BookConfig = { updatedAt: 0, booknotes: [] };
              const pullResult = await pullBookConfig(settings, rb, emptyLocal);
              if (pullResult.applied && pullResult.mergedConfig) {
                await options.saveBookConfig(rb, pullResult.mergedConfig);
                result.configsDownloaded += 1;
              }
            } catch (e) {
              console.warn('WD library sync: config download failed', rb.hash, e);
            }
          }
          await options.addBookToLibrary(rb);
          result.booksDownloaded += 1;
        } else {
          // No bytes returned (typically a 404 we couldn't resolve) —
          // count as a failure so the user sees something happened.
          result.failures += 1;
          result.failedBooks.push({
            hash: rb.hash,
            title: rb.title || rb.hash,
            phase: 'download',
            reason: 'No bytes returned (file may have been moved or deleted on the server)',
          });
          console.warn('WD library sync: book download produced no bytes', rb.hash, explicitPath);
        }
      } catch (e) {
        result.failures += 1;
        result.failedBooks.push({
          hash: rb.hash,
          title: rb.title || rb.hash,
          phase: 'download',
          reason: formatFailureReason(e),
        });
        console.warn('WD library sync: book download failed', rb.hash, e);
      }
    }
  }

  // Books we just downloaded already exist on the remote — don't waste
  // bandwidth/time HEAD-probing and re-pushing them. Only push books that
  // were already present in the caller-supplied local library.
  const downloadedHashes = new Set(remoteBooksToDownload.map((b) => b.hash));
  const booksToPush = books.filter((b) => !b.deletedAt && !downloadedHashes.has(b.hash));
  result.totalBooks = booksToPush.length;

  if (canPush && booksToPush.length > 0) {
    for (let i = 0; i < booksToPush.length; i += 1) {
      const book = booksToPush[i]!;
      options.onProgress?.({ book, index: i, total: booksToPush.length, action: 'uploading' });
      // Track which step we were in when an exception escapes the inner
      // try, so the user-facing log can pinpoint whether config / file /
      // cover upload tripped the wire. Cover failures are caught locally
      // (covers are best-effort) and don't update this.
      let phase: SyncFailureEntry['phase'] = 'upload-config';
      try {
        const config = await options.loadConfig(book);
        if (config) {
          await pushBookConfig(settings, book, config, options.deviceId);
          result.configsUploaded += 1;
        }
        if (options.syncBooks) {
          phase = 'upload-file';
          const fileResult = await pushBookFile(
            settings,
            book,
            () => options.loadBookFile(book),
            options.loadBookFileStreaming ? () => options.loadBookFileStreaming!(book) : undefined,
          );
          if (fileResult.uploaded) {
            result.filesUploaded += 1;
          } else if (fileResult.reason === 'remote-matches') {
            result.filesAlreadyInSync += 1;
          }
          if (options.loadBookCover) {
            try {
              const coverResult = await pushBookCover(settings, book.hash, () =>
                options.loadBookCover!(book),
              );
              if (coverResult.uploaded) result.coversUploaded += 1;
            } catch (e) {
              console.warn('WD library sync: cover failed', book.hash, e);
            }
          }
        }
      } catch (e) {
        result.failures += 1;
        result.failedBooks.push({
          hash: book.hash,
          title: book.title || book.hash,
          phase,
          reason: formatFailureReason(e),
        });
        console.warn('WD library sync: book failed', book.hash, e);
      }
    }
  }

  // Push the merged index whenever we're allowed to write to the remote,
  // even if we didn't upload any binaries this turn (e.g. all books were
  // freshly pulled from the remote). Keeps library.json authoritative.
  //
  // Per-hash directories of soft-deleted books are intentionally NOT
  // GC'd from this sync path: a peer that hasn't pulled this push yet
  // would see the `deletedAt` tombstone arrive together with the bytes
  // already gone, surfacing as a phantom-deleted shelf row. The orphan
  // sweep is instead exposed manually via WebDAVBrowsePane's cleanup
  // mode, where it's the user (per device) who decides when the
  // deletion has settled. See `deleteRemoteBookDir` above.
  if (canPush) {
    try {
      const newIndex: RemoteLibraryIndex = {
        schemaVersion: 1,
        books: Array.from(allBooksMap.values()),
        updatedAt: Date.now(),
      };
      await pushLibraryIndex(settings, newIndex);
    } catch (e) {
      console.warn('WD library sync: failed to push index', e);
    }
  }

  return result;
};
