/**
 * Google Drive implementation of {@link FileSyncProvider} — the second concrete
 * backend for the provider-agnostic file-sync engine (after WebDAV).
 *
 * Two facts shape the whole design:
 *
 *  - **`drive.file` scope.** The app sees *only* the files it created, so Drive
 *    behaves like a private app folder rooted at `'root'`. That makes Drive's
 *    real root a safe namespace for our `/Readest/...` layout — no clash with the
 *    user's own files is possible because we cannot even see them.
 *  - **Drive is ID-addressed, not path-addressed.** A logical path like
 *    `/Readest/books/<hash>/config.json` must be resolved segment-by-segment into
 *    Drive file ids via `files.list` search queries, then operated on by id.
 *    Resolved ids are memoised in {@link idCache} (scoped to this provider
 *    instance) so repeated access under one folder does not re-walk the tree.
 *
 * Differences from the WebDAV wire that this layer absorbs so nothing above it
 * knows the backend is Drive:
 *  - every Drive HTTP failure is translated into the engine's neutral
 *    {@link FileSyncError} ({@link mapDriveError}); the reference threw plain
 *    `Error`, which the engine cannot branch on;
 *  - 429 / 5xx responses are retried with `Retry-After`-aware backoff;
 *  - `files.list` is drained across `nextPageToken` pages (no silent truncation);
 *  - concurrent folder creation is serialised per logical path and dup names are
 *    collapsed deterministically (the engine runs books at concurrency 4, which
 *    otherwise races to create `/Readest` several times on a fresh remote).
 *
 * Tokens are supplied by an injected {@link DriveAuth}; `fetch` is injected as
 * {@link FetchFn}; `sleep` is injected so backoff is instant under test. All
 * three keep the provider unit-testable against a mocked Drive.
 *
 * Adapted from ratatabananana-bit/Readest-google-drive-mod-patcher (AGPL-3.0),
 * used with the author's explicit permission.
 */

import {
  FileEntry,
  FileHead,
  FileSyncError,
  FileSyncErrorCode,
  FileSyncProvider,
} from '@/services/sync/file/provider';
import {
  childrenQuery,
  deleteUrl,
  FILES_ENDPOINT,
  FOLDER_MIME,
  listQuery,
  listUrl,
  mediaDownloadUrl,
  mediaUpdateUrl,
  metadataUrl,
  reparentUrl,
  simpleUploadUrl,
} from './driveRest';

/** Token source for Drive requests, supplied by the OAuth/token layer. */
export interface DriveAuth {
  /** A currently-valid access token; refreshes under the hood as needed. */
  getAccessToken(): Promise<string>;
}

/**
 * Injected `fetch`, typed to exactly what the provider uses (a string URL plus
 * optional init) so the platform's `fetch` or a test stub drops in.
 */
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** Injected sleep so the retry backoff is instant under test. */
export type SleepFn = (ms: number) => Promise<void>;

export interface GoogleDriveProviderOptions {
  sleep?: SleepFn;
}

/** Drive's real root, which `drive.file` scope makes our private namespace root. */
const DRIVE_ROOT_ID = 'root';

const HTTP_GET = 'GET';
const HTTP_POST = 'POST';
const HTTP_PATCH = 'PATCH';
const HTTP_DELETE = 'DELETE';

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_REQUEST_TIMEOUT = 408;
const HTTP_CONFLICT = 409;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_NO_CONTENT = 204;
const HTTP_SERVER_ERROR_FLOOR = 500;

const CONTENT_TYPE_HEADER = 'Content-Type';
const JSON_CONTENT_TYPE = 'application/json';
const DEFAULT_TEXT_CONTENT_TYPE = 'application/json';
const DEFAULT_BINARY_CONTENT_TYPE = 'application/octet-stream';

/** Backoff: up to this many retries on a transient (429/5xx) response. */
const MAX_BACKOFF_RETRIES = 4;
/** Base delay for exponential backoff when no `Retry-After` is supplied. */
const BASE_BACKOFF_MS = 500;

const MS_PER_SEC = 1000;

/**
 * Drive `error.errors[].reason` values that are *transient* even under a 403.
 * Drive overloads 403 for both rate/quota limits (retry) and genuine permission
 * failures (re-auth), so 403 must be classified by reason, not status alone.
 */
const RATE_LIMIT_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'dailyLimitExceeded',
  'quotaExceeded',
  'sharingRateLimitExceeded',
  'backendError',
]);

/** Request-name for error messages; names which operation/path failed. */
type DriveOperation =
  | 'list'
  | 'download'
  | 'upload'
  | 'create folder'
  | 'set metadata'
  | 'stat'
  | 'delete';

/** Raw Drive JSON for a single file/folder, restricted to requested `fields`. */
interface DriveFile {
  id: string;
  name?: string;
  /** Equals {@link FOLDER_MIME} for folders; absent/other for file blobs. */
  mimeType?: string;
  /** Byte size as a *string* (Drive returns numbers as strings in JSON). */
  size?: string;
  modifiedTime?: string;
  md5Checksum?: string;
}

/** Shape of a `files.list` response page. */
interface DriveFileListPage {
  files?: DriveFile[];
  nextPageToken?: string;
}

/** Drive's structured error body, used to classify a 403 by its `reason`. */
interface DriveErrorBody {
  error?: { errors?: { reason?: string }[]; message?: string };
}

/**
 * An HTTP failure from a Drive request, carrying the status (and the 403
 * `reason`) so {@link mapDriveError} can produce the right {@link FileSyncError}
 * code without re-reading the response body.
 */
class DriveHttpError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'DriveHttpError';
  }
}

/**
 * Translate any Drive failure into the engine's neutral {@link FileSyncError}.
 * 401 → AUTH_FAILED; 403 → AUTH_FAILED unless its `reason` is a rate/quota limit
 * (then NETWORK); 404 → NOT_FOUND; 408/429/5xx → NETWORK; 409 → CONFLICT; a
 * thrown `fetch` (TypeError) → NETWORK; anything else → UNKNOWN.
 */
const mapDriveError = (e: unknown): FileSyncError => {
  if (e instanceof FileSyncError) return e;
  if (e instanceof DriveHttpError) {
    let code: FileSyncErrorCode;
    if (e.status === HTTP_UNAUTHORIZED) {
      code = 'AUTH_FAILED';
    } else if (e.status === HTTP_FORBIDDEN) {
      code = RATE_LIMIT_REASONS.has(e.reason ?? '') ? 'NETWORK' : 'AUTH_FAILED';
    } else if (e.status === HTTP_NOT_FOUND) {
      code = 'NOT_FOUND';
    } else if (
      e.status === HTTP_REQUEST_TIMEOUT ||
      e.status === HTTP_TOO_MANY_REQUESTS ||
      e.status >= HTTP_SERVER_ERROR_FLOOR
    ) {
      code = 'NETWORK';
    } else if (e.status === HTTP_CONFLICT) {
      code = 'CONFLICT';
    } else {
      code = 'UNKNOWN';
    }
    return new FileSyncError(e.message, code, e.status);
  }
  // A thrown fetch (offline / DNS / reset) surfaces as a TypeError.
  const networkLike = e instanceof TypeError;
  return new FileSyncError(
    e instanceof Error ? e.message : String(e),
    networkLike ? 'NETWORK' : 'UNKNOWN',
  );
};

/** Run a provider operation, mapping any Drive failure to a {@link FileSyncError}. */
const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    throw mapDriveError(e);
  }
};

/** Split an absolute logical path into non-empty segments. */
const splitSegments = (path: string): string[] => path.split('/').filter((s) => s.length > 0);

/** Join an absolute parent path and a child name. */
const joinAbs = (parent: string, name: string): string =>
  parent === '/' || parent === '' ? `/${name}` : `${parent}/${name}`;

/** Absolute prefix of the first `count` segments (e.g. `/Readest/books`). */
const prefixOf = (segments: string[], count: number): string =>
  `/${segments.slice(0, count).join('/')}`;

/** Map Drive file metadata onto a {@link FileEntry} at the given absolute path. */
const toFileEntry = (path: string, file: DriveFile): FileEntry => {
  const isDirectory = file.mimeType === FOLDER_MIME;
  return {
    name: file.name ?? splitSegments(path).pop() ?? path,
    path,
    isDirectory,
    size: !isDirectory && file.size !== undefined ? Number(file.size) : undefined,
    lastModified: file.modifiedTime,
  };
};

/** Parse a `Retry-After` header (delta-seconds) into ms, or undefined for a date/absent. */
const parseRetryAfterMs = (header: string | null): number | undefined => {
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * MS_PER_SEC : undefined;
};

const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class DriveProviderImpl {
  readonly rootPath = '/';

  /**
   * Memoised absolute-path → Drive file id, scoped to this instance. The engine
   * rebuilds the provider whenever settings change, so the cache lifetime is one
   * sync session — long enough to avoid re-walking the tree, short enough that
   * cross-session staleness cannot accumulate. Stale entries are also evicted on
   * a 404 (see {@link evict}).
   */
  private readonly idCache = new Map<string, string>();

  /**
   * In-flight folder creations keyed by absolute prefix. The engine runs books
   * at concurrency 4, so several workers can simultaneously find `/Readest`
   * missing and each create it. Serialising per prefix collapses that to one
   * create; {@link findChild} then picks a deterministic winner if a race still
   * produced duplicate folders.
   */
  private readonly folderLocks = new Map<string, Promise<string>>();

  constructor(
    private readonly auth: DriveAuth,
    private readonly fetchFn: FetchFn,
    private readonly sleep: SleepFn = defaultSleep,
  ) {}

  async readText(path: string): Promise<string | null> {
    const res = await this.getMedia(path);
    return res ? res.text() : null;
  }

  async readBinary(path: string): Promise<ArrayBuffer | null> {
    const res = await this.getMedia(path);
    return res ? res.arrayBuffer() : null;
  }

  async head(path: string): Promise<FileHead | null> {
    const file = await this.statFresh(path, (id) => metadataUrl(id), 'stat');
    if (file === null) return null;
    return {
      size: file.size !== undefined ? Number(file.size) : undefined,
      etag: file.md5Checksum,
    };
  }

  async list(path: string): Promise<FileEntry[]> {
    const folderId = await this.resolveFolderSegments(splitSegments(path), false);
    // Absent folder -> empty listing (Drive has no path, so a missing parent is
    // simply "no children"). Matches what the engine's discovery expects.
    if (folderId === null) return [];
    const entries: FileEntry[] = [];
    let pageToken: string | undefined;
    do {
      const res = await this.authedFetch(listUrl(childrenQuery(folderId), pageToken), HTTP_GET);
      await this.ensureOk(res, 'list', path);
      const data = (await res.json()) as DriveFileListPage;
      for (const file of data.files ?? []) {
        const childPath = joinAbs(path, file.name ?? file.id);
        this.idCache.set(childPath, file.id);
        entries.push(toFileEntry(childPath, file));
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
    return entries;
  }

  writeText(
    path: string,
    body: string,
    contentType: string = DEFAULT_TEXT_CONTENT_TYPE,
  ): Promise<void> {
    return this.writeBinary(
      path,
      new TextEncoder().encode(body).buffer as ArrayBuffer,
      contentType,
    );
  }

  async writeBinary(
    path: string,
    body: ArrayBuffer,
    contentType: string = DEFAULT_BINARY_CONTENT_TYPE,
  ): Promise<void> {
    const segments = splitSegments(path);
    const name = segments.pop();
    if (name === undefined)
      throw new DriveHttpError(0, undefined, `Drive upload failed: empty path`);
    // Auto-create the containing chain as a backup; the engine usually calls
    // ensureDir first, but a write must still materialise its parents.
    const folderId = await this.resolveFolderSegments(segments, true);
    if (folderId === null) {
      throw new DriveHttpError(
        0,
        undefined,
        `Drive upload failed: could not create folder for ${path}`,
      );
    }

    const existingId = await this.findChild(name, folderId);
    if (existingId !== null) {
      // Overwrite in place, preserving the file id (and any links) rather than
      // orphaning it and creating a duplicate name.
      await this.uploadMedia(mediaUpdateUrl(existingId), HTTP_PATCH, body, contentType, path);
      this.idCache.set(path, existingId);
    } else {
      // `uploadType=media` carries no metadata, so create-then-name: POST the
      // bytes to root, then PATCH name + reparent under the resolved folder.
      const created = await this.uploadMedia(simpleUploadUrl(), HTTP_POST, body, contentType, path);
      await this.nameAndReparent(created.id, name, folderId, path);
      this.idCache.set(path, created.id);
    }
  }

  async ensureDir(paths: string[]): Promise<void> {
    // Create each directory's full chain (idempotent via cache + findChild). The
    // engine passes ancestors top-down, so deeper paths reuse the cached parents.
    for (const path of paths) {
      await this.resolveFolderSegments(splitSegments(path), true);
    }
  }

  async deleteDir(path: string): Promise<void> {
    const folderId = await this.resolveFolderSegments(splitSegments(path), false);
    // Already absent — nothing to delete (idempotent).
    if (folderId === null) return;
    const res = await this.authedFetch(deleteUrl(folderId), HTTP_DELETE);
    // Tolerate a 404: the dir may have been deleted concurrently, which still
    // satisfies the caller's intent.
    if (res.status === HTTP_NOT_FOUND) {
      this.evict(path);
      return;
    }
    await this.ensureOk(res, 'delete', path);
    this.evict(path);
  }

  // --- read plumbing (with one stale-cache eviction retry) -----------------

  /**
   * GET a file's bytes, returning the Response or null when the file is absent.
   * If a *cached* id 404s, the cache is stale (the file was deleted/recreated):
   * evict and resolve once more before giving up.
   */
  private async getMedia(path: string): Promise<Response | null> {
    const cachedId = this.idCache.get(path);
    let fileId = await this.resolveFile(path);
    if (fileId === null) return null;
    let res = await this.authedFetch(mediaDownloadUrl(fileId), HTTP_GET);
    if (res.status === HTTP_NOT_FOUND && cachedId !== undefined) {
      this.evict(path);
      fileId = await this.resolveFile(path);
      if (fileId === null) return null;
      res = await this.authedFetch(mediaDownloadUrl(fileId), HTTP_GET);
    }
    if (res.status === HTTP_NOT_FOUND) return null;
    await this.ensureOk(res, 'download', path);
    return res;
  }

  /** GET a file's metadata, with the same stale-cache eviction retry as reads. */
  private async statFresh(
    path: string,
    urlFor: (id: string) => string,
    operation: DriveOperation,
  ): Promise<DriveFile | null> {
    const cachedId = this.idCache.get(path);
    let fileId = await this.resolveFile(path);
    if (fileId === null) return null;
    let res = await this.authedFetch(urlFor(fileId), HTTP_GET);
    if (res.status === HTTP_NOT_FOUND && cachedId !== undefined) {
      this.evict(path);
      fileId = await this.resolveFile(path);
      if (fileId === null) return null;
      res = await this.authedFetch(urlFor(fileId), HTTP_GET);
    }
    if (res.status === HTTP_NOT_FOUND) return null;
    await this.ensureOk(res, operation, path);
    return (await res.json()) as DriveFile;
  }

  // --- path resolution -----------------------------------------------------

  /** Resolve an absolute file path to its Drive id, or null when any part is absent. */
  private async resolveFile(path: string): Promise<string | null> {
    const cached = this.idCache.get(path);
    if (cached !== undefined) return cached;

    const segments = splitSegments(path);
    const name = segments.pop();
    if (name === undefined) return null;
    const folderId = await this.resolveFolderSegments(segments, false);
    if (folderId === null) return null;

    const fileId = await this.findChild(name, folderId);
    if (fileId !== null) this.idCache.set(path, fileId);
    return fileId;
  }

  /**
   * Resolve a chain of folder-name segments to the deepest folder id, from the
   * Drive root. `create=true` materialises missing folders (write path);
   * `create=false` returns null at the first missing segment (read path).
   */
  private async resolveFolderSegments(segments: string[], create: boolean): Promise<string | null> {
    let parentId = DRIVE_ROOT_ID;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!;
      const prefix = prefixOf(segments, i + 1);

      const cached = this.idCache.get(prefix);
      if (cached !== undefined) {
        parentId = cached;
        continue;
      }

      if (create) {
        parentId = await this.resolveOrCreateFolder(prefix, segment, parentId);
      } else {
        const childId = await this.findChild(segment, parentId);
        if (childId === null) return null;
        this.idCache.set(prefix, childId);
        parentId = childId;
      }
    }
    return parentId;
  }

  /**
   * Resolve-or-create one folder segment, serialised per prefix so concurrent
   * workers create it at most once. After creating, re-query and pick the
   * deterministic winner so a race that still produced duplicates converges.
   */
  private async resolveOrCreateFolder(
    prefix: string,
    segment: string,
    parentId: string,
  ): Promise<string> {
    const cached = this.idCache.get(prefix);
    if (cached !== undefined) return cached;
    const inflight = this.folderLocks.get(prefix);
    if (inflight) return inflight;

    const promise = (async (): Promise<string> => {
      const found = await this.findChild(segment, parentId);
      if (found !== null) {
        this.idCache.set(prefix, found);
        return found;
      }
      const created = await this.createFolder(segment, parentId);
      // Re-query so concurrent creators of the same name converge on one id
      // (findChild picks the lexicographically smallest), not their own create.
      const winner = (await this.findChild(segment, parentId)) ?? created;
      this.idCache.set(prefix, winner);
      return winner;
    })();

    this.folderLocks.set(prefix, promise);
    try {
      return await promise;
    } finally {
      this.folderLocks.delete(prefix);
    }
  }

  /**
   * Find a directly-nested child by name under `parentId`. Returns the
   * deterministic (lexicographically smallest) id when multiple same-named
   * children exist, so racing resolvers converge on one; null when none exist.
   */
  private async findChild(name: string, parentId: string): Promise<string | null> {
    const res = await this.authedFetch(listUrl(listQuery(name, parentId)), HTTP_GET);
    await this.ensureOk(res, 'list', name);
    const data = (await res.json()) as DriveFileListPage;
    const ids = (data.files ?? []).map((f) => f.id);
    if (ids.length === 0) return null;
    ids.sort();
    return ids[0]!;
  }

  /** Create an empty folder named `name` under `parentId`; return its new id. */
  private async createFolder(name: string, parentId: string): Promise<string> {
    const res = await this.authedFetch(FILES_ENDPOINT, HTTP_POST, {
      headers: { [CONTENT_TYPE_HEADER]: JSON_CONTENT_TYPE },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
    await this.ensureOk(res, 'create folder', name);
    const file = (await res.json()) as DriveFile;
    return file.id;
  }

  /** Set a freshly-uploaded file's name and move it under its target folder. */
  private async nameAndReparent(
    fileId: string,
    name: string,
    folderId: string,
    path: string,
  ): Promise<void> {
    const res = await this.authedFetch(reparentUrl(fileId, folderId, DRIVE_ROOT_ID), HTTP_PATCH, {
      headers: { [CONTENT_TYPE_HEADER]: JSON_CONTENT_TYPE },
      body: JSON.stringify({ name }),
    });
    await this.ensureOk(res, 'set metadata', path);
  }

  /** Send a simple media upload (create POST or overwrite PATCH) and parse the result. */
  private async uploadMedia(
    url: string,
    method: typeof HTTP_POST | typeof HTTP_PATCH,
    body: ArrayBuffer,
    contentType: string,
    path: string,
  ): Promise<DriveFile> {
    const res = await this.authedFetch(url, method, {
      headers: { [CONTENT_TYPE_HEADER]: contentType },
      body,
    });
    await this.ensureOk(res, 'upload', path);
    return (await res.json()) as DriveFile;
  }

  // --- request plumbing ----------------------------------------------------

  /** Issue an authenticated Drive request, retried on transient failures. */
  private async authedFetch(url: string, method: string, init?: RequestInit): Promise<Response> {
    return this.withBackoff(async () => {
      const token = await this.auth.getAccessToken();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        ...(init?.headers as Record<string, string> | undefined),
      };
      return this.fetchFn(url, { ...init, method, headers });
    });
  }

  /**
   * Retry `fn` on a 429 / 5xx response with `Retry-After`-aware exponential
   * backoff. A first full-sync of a large library at concurrency 4 multiplies
   * Drive calls (per-segment resolution + 2-write create-then-name), so a 429 is
   * expected, not exceptional. A thrown fetch is *not* retried here — it
   * propagates and is mapped to NETWORK by {@link mapDriveError}.
   */
  private async withBackoff(fn: () => Promise<Response>): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const res = await fn();
      const transient =
        res.status === HTTP_TOO_MANY_REQUESTS || res.status >= HTTP_SERVER_ERROR_FLOOR;
      if (!transient || attempt >= MAX_BACKOFF_RETRIES) return res;
      const retryAfter = parseRetryAfterMs(res.headers.get('Retry-After'));
      await this.sleep(retryAfter ?? BASE_BACKOFF_MS * 2 ** attempt);
    }
  }

  /**
   * Throw a context-carrying {@link DriveHttpError} for any non-success response.
   * Callers handle the expected 404/null cases before calling this, so any status
   * reaching here is a genuine failure. Reads Drive's error body to recover the
   * `reason` (used to tell a 403 rate-limit from a 403 permission failure).
   */
  private async ensureOk(res: Response, operation: DriveOperation, path: string): Promise<void> {
    if (res.ok || res.status === HTTP_NO_CONTENT) return;
    const reason = await readDriveErrorReason(res);
    throw new DriveHttpError(
      res.status,
      reason,
      `Drive ${operation} failed: HTTP ${res.status}${reason ? ` (${reason})` : ''} for ${path}`,
    );
  }

  /** Evict an absolute path and every ancestor prefix from the id cache. */
  private evict(path: string): void {
    const segments = splitSegments(path);
    for (let i = segments.length; i >= 1; i--) {
      this.idCache.delete(prefixOf(segments, i));
    }
  }
}

/** Best-effort read of Drive's `error.errors[0].reason` for 403 classification. */
const readDriveErrorReason = async (res: Response): Promise<string | undefined> => {
  try {
    const body = (await res.json()) as DriveErrorBody;
    return body.error?.errors?.[0]?.reason;
  } catch {
    return undefined;
  }
};

/**
 * Build a Google Drive {@link FileSyncProvider}. Each public method is wrapped so
 * a Drive HTTP failure surfaces as a {@link FileSyncError} the engine can branch
 * on — mirroring `createWebDAVProvider`. Streaming is intentionally omitted
 * (PR1): the engine falls back to buffered read/write, and resumable Drive upload
 * lands in a later phase to unlock large-book sync on mobile.
 */
export const createGoogleDriveProvider = (
  auth: DriveAuth,
  fetchFn: FetchFn,
  options: GoogleDriveProviderOptions = {},
): FileSyncProvider => {
  const impl = new DriveProviderImpl(auth, fetchFn, options.sleep);
  return {
    rootPath: impl.rootPath,
    readText: (path) => wrap(() => impl.readText(path)),
    readBinary: (path) => wrap(() => impl.readBinary(path)),
    head: (path) => wrap(() => impl.head(path)),
    list: (path) => wrap(() => impl.list(path)),
    writeText: (path, body, contentType) => wrap(() => impl.writeText(path, body, contentType)),
    writeBinary: (path, body, contentType) => wrap(() => impl.writeBinary(path, body, contentType)),
    ensureDir: (paths) => wrap(() => impl.ensureDir(paths)),
    deleteDir: (path) => wrap(() => impl.deleteDir(path)),
  };
};
