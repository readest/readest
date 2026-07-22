/**
 * Transport abstraction for a file-based sync backend.
 *
 * A `FileSyncProvider` exposes the minimal set of remote file operations the
 * {@link FileSyncEngine} needs; everything above this line (layout, wire
 * envelopes, merge policy, orchestration) is provider-agnostic. Implementing
 * a new backend (Google Drive / Dropbox / FTP / SFTP) means writing one of
 * these — ideally validated against the shared provider-conformance test
 * suite — and nothing else.
 *
 * Error contract: read/head operations return `null` for a missing path
 * (HTTP 404 and equivalents); every other failure throws a
 * {@link FileSyncError} carrying a normalised `code` so the engine can branch
 * on auth / not-found / network / conflict without knowing the backend.
 */

export type FileSyncErrorCode = 'AUTH_FAILED' | 'NOT_FOUND' | 'NETWORK' | 'CONFLICT' | 'UNKNOWN';

export class FileSyncError extends Error {
  code: FileSyncErrorCode;
  /** HTTP status when the request reached the server, if applicable. */
  status?: number;

  constructor(message: string, code: FileSyncErrorCode = 'UNKNOWN', status?: number) {
    super(message);
    this.name = 'FileSyncError';
    this.code = code;
    this.status = status;
  }
}

/** A single directory entry returned by {@link FileSyncProvider.list}. */
export interface FileEntry {
  /** File or directory name (single decoded path segment). */
  name: string;
  /** Absolute path on the backend, leading slash, decoded. */
  path: string;
  isDirectory: boolean;
  /** Content length in bytes when the backend reports it (files only). */
  size?: number;
  /** Backend-provided modification timestamp, if any. */
  lastModified?: string;
}

/** Metadata returned by a HEAD-style probe. */
export interface FileHead {
  size?: number;
  etag?: string;
}

export interface FileSyncProvider {
  /** Normalised root path: leading '/', no trailing slash (root === '/'). */
  readonly rootPath: string;

  /** GET text. Resolves `null` when the path doesn't exist (404). */
  readText(path: string): Promise<string | null>;
  /** GET binary. Resolves `null` when the path doesn't exist (404). */
  readBinary(path: string): Promise<ArrayBuffer | null>;
  /** HEAD probe. Resolves `null` when the path doesn't exist (404). */
  head(path: string): Promise<FileHead | null>;
  /** List immediate children of a directory. Throws on non-2xx. */
  list(path: string): Promise<FileEntry[]>;

  /** PUT text. Parent directories must already exist (see {@link ensureDir}). */
  writeText(path: string, body: string, contentType?: string): Promise<void>;
  /** PUT binary. Parent directories must already exist. */
  writeBinary(path: string, body: ArrayBuffer, contentType?: string): Promise<void>;

  /** Create each directory in `paths` (top-down). Idempotent. */
  ensureDir(paths: string[]): Promise<void>;
  /** Recursively delete a directory subtree. A missing dir is success. */
  deleteDir(path: string): Promise<void>;

  /**
   * Optional streaming upload: PUT `localPath`'s bytes to `remotePath`
   * without materialising them in the JS heap. The provider owns the
   * remote URL + auth. Resolves `true` on success, `false` on a swallowed
   * failure. Absent on backends without a streaming primitive (e.g. web);
   * the engine then falls back to buffered {@link writeBinary}.
   */
  uploadStream?(remotePath: string, localPath: string): Promise<boolean>;
  /**
   * Optional streaming download: GET `remotePath` straight to `localPath`.
   * Same ownership + fallback rules as {@link uploadStream}.
   */
  downloadStream?(remotePath: string, localPath: string): Promise<boolean>;
}
