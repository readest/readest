/**
 * S3-compatible object-store implementation of {@link FileSyncProvider} — the
 * third concrete backend for the provider-agnostic file-sync engine (after
 * WebDAV and Google Drive). Targets any SigV4 endpoint: Cloudflare R2, AWS
 * S3, MinIO, Backblaze B2.
 *
 * Shape of the mapping:
 *
 *  - **Path-style addressing.** Every logical sync path maps 1:1 to an object
 *    key under `<endpoint>/<bucket>/` (`/Readest/books/<hash>/config.json` →
 *    key `Readest/books/<hash>/config.json`). No id resolution, no caches —
 *    unlike Drive, one logical operation is one HTTP request.
 *  - **Object stores have no directories.** `ensureDir` is a no-op; `list`
 *    emulates a directory with `ListObjectsV2` + `delimiter=/` (CommonPrefixes
 *    → subdirs, Contents → files), draining `NextContinuationToken` pages;
 *    `deleteDir` lists the prefix (no delimiter) and DELETEs each key —
 *    deliberately not `DeleteObjects`, whose Content-MD5 requirement WebCrypto
 *    cannot satisfy; a book dir holds at most three objects.
 *  - **`head` returns the ETag as `etag`** — for single-part PUTs that is the
 *    content md5, which feeds the engine's index change-detection exactly like
 *    Drive's md5Checksum.
 *
 * Signing is SigV4 via `aws4fetch` (already a dependency; the server-side
 * `utils/r2.ts` uses the same client). Requests are signed with
 * `AwsClient.sign()` and dispatched through an injected fetch — the platform
 * fetch on web, the Tauri HTTP plugin on native — so the provider stays
 * unit-testable against a mocked wire, like the Drive provider. Streaming
 * upload/download (Tauri only) hand a presigned query URL (`signQuery`) to
 * the native transfer plugin, the `utils/r2.ts` presign pattern.
 *
 * Every HTTP failure is translated into the engine's neutral
 * {@link FileSyncError}; 429/5xx and thrown transports are retried with
 * `Retry-After`-aware backoff, mirroring the Drive provider.
 */

import { AwsClient } from 'aws4fetch';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import { tauriDownload, tauriUpload } from '@/utils/transfer';
import {
  FileEntry,
  FileHead,
  FileSyncError,
  FileSyncErrorCode,
  FileSyncProvider,
} from '@/services/sync/file/provider';

/** Connection slice the provider needs (a subset of `S3Settings`). */
export interface S3ProviderConfig {
  /** Service endpoint origin, e.g. `https://<account-id>.r2.cloudflarestorage.com`. */
  endpoint: string;
  /** SigV4 region; 'auto' works for R2/MinIO, AWS wants the bucket region. */
  region?: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** Injected `fetch`, typed to what the provider uses (string URL + init). */
export type S3FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** Injected sleep so the retry backoff is instant under test. */
export type S3SleepFn = (ms: number) => Promise<void>;

export interface S3ProviderOptions {
  sleep?: S3SleepFn;
}

const HTTP_GET = 'GET';
const HTTP_PUT = 'PUT';
const HTTP_HEAD = 'HEAD';
const HTTP_DELETE = 'DELETE';

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_REQUEST_TIMEOUT = 408;
const HTTP_CONFLICT = 409;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_NO_CONTENT = 204;
const HTTP_SERVER_ERROR_FLOOR = 500;

const DEFAULT_TEXT_CONTENT_TYPE = 'application/json';
const DEFAULT_BINARY_CONTENT_TYPE = 'application/octet-stream';

/** Backoff: up to this many retries on a transient (429/5xx) response. */
const MAX_BACKOFF_RETRIES = 4;
/** Base delay for exponential backoff when no `Retry-After` is supplied. */
const BASE_BACKOFF_MS = 500;
const MS_PER_SEC = 1000;

/** Lifetime of presigned streaming URLs (seconds) — generous for large books. */
const PRESIGN_EXPIRES_SEC = 3600;

/** Request-name for error messages; names which operation/path failed. */
type S3Operation = 'list' | 'download' | 'upload' | 'stat' | 'delete';

/** An HTTP failure from an S3 request, carrying the status for mapping. */
class S3HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'S3HttpError';
  }
}

/**
 * Translate any S3 failure into the engine's neutral {@link FileSyncError}.
 * 401/403 → AUTH_FAILED (bad or expired credentials — S3 has no rate-limit
 * 403 overload like Drive; throttling is 429/503); 404 → NOT_FOUND;
 * 408/429/5xx → NETWORK; 409 → CONFLICT; a thrown fetch → NETWORK.
 */
const mapS3Error = (e: unknown): FileSyncError => {
  if (e instanceof FileSyncError) return e;
  if (e instanceof S3HttpError) {
    let code: FileSyncErrorCode;
    if (e.status === HTTP_UNAUTHORIZED || e.status === HTTP_FORBIDDEN) {
      code = 'AUTH_FAILED';
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
  const message = e instanceof Error ? e.message : String(e);
  const networkLike =
    e instanceof TypeError ||
    /sending request|network|connection|timed out|timeout|dns|fetch/i.test(message);
  return new FileSyncError(message, networkLike ? 'NETWORK' : 'UNKNOWN');
};

/** Run a provider operation, mapping any S3 failure to a {@link FileSyncError}. */
const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    throw mapS3Error(e);
  }
};

/** Logical absolute path → object key (leading slashes stripped). */
const keyFor = (path: string): string =>
  path
    .split('/')
    .filter((s) => s.length > 0)
    .join('/');

/** Percent-encode a key for the URL path, keeping `/` separators. */
const encodeKey = (key: string): string => key.split('/').map(encodeURIComponent).join('/');

/** Parse a `Retry-After` header (delta-seconds) into ms, or undefined. */
const parseRetryAfterMs = (header: string | null): number | undefined => {
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * MS_PER_SEC : undefined;
};

const defaultSleep: S3SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const textOf = (parent: Element | Document, tag: string): string | undefined =>
  parent.getElementsByTagName(tag)[0]?.textContent ?? undefined;

class S3ProviderImpl {
  readonly rootPath = '/';

  private readonly client: AwsClient;
  private readonly baseUrl: string;

  constructor(
    config: S3ProviderConfig,
    private readonly fetchFn: S3FetchFn,
    private readonly sleep: S3SleepFn = defaultSleep,
  ) {
    this.client = new AwsClient({
      service: 's3',
      region: config.region || 'auto',
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    });
    this.baseUrl = `${config.endpoint.replace(/\/+$/, '')}/${encodeURIComponent(config.bucket)}`;
  }

  private urlFor(key: string): string {
    return `${this.baseUrl}/${encodeKey(key)}`;
  }

  async readText(path: string): Promise<string | null> {
    const res = await this.getObject(path);
    return res ? res.text() : null;
  }

  async readBinary(path: string): Promise<ArrayBuffer | null> {
    const res = await this.getObject(path);
    return res ? res.arrayBuffer() : null;
  }

  private async getObject(path: string): Promise<Response | null> {
    const res = await this.request(HTTP_GET, this.urlFor(keyFor(path)));
    if (res.status === HTTP_NOT_FOUND) return null;
    await this.ensureOk(res, 'download', path);
    return res;
  }

  async head(path: string): Promise<FileHead | null> {
    const res = await this.request(HTTP_HEAD, this.urlFor(keyFor(path)));
    if (res.status === HTTP_NOT_FOUND) return null;
    await this.ensureOk(res, 'stat', path);
    const length = res.headers.get('content-length');
    const etag = res.headers.get('etag');
    return {
      size: length !== null ? Number(length) : undefined,
      etag: etag ? etag.replace(/^"|"$/g, '') : undefined,
    };
  }

  async list(path: string): Promise<FileEntry[]> {
    const key = keyFor(path);
    const prefix = key ? `${key}/` : '';
    const entries: FileEntry[] = [];
    let token: string | undefined;
    do {
      const url =
        `${this.baseUrl}?list-type=2&prefix=${encodeURIComponent(prefix)}&delimiter=%2F` +
        (token ? `&continuation-token=${encodeURIComponent(token)}` : '');
      const res = await this.request(HTTP_GET, url);
      await this.ensureOk(res, 'list', path);
      const doc = new DOMParser().parseFromString(await res.text(), 'application/xml');
      for (const cp of Array.from(doc.getElementsByTagName('CommonPrefixes'))) {
        const p = textOf(cp, 'Prefix');
        if (!p) continue;
        const dirKey = p.replace(/\/$/, '');
        entries.push({
          name: dirKey.slice(prefix.length),
          path: `/${dirKey}`,
          isDirectory: true,
        });
      }
      for (const c of Array.from(doc.getElementsByTagName('Contents'))) {
        const objectKey = textOf(c, 'Key');
        // Skip the prefix's own placeholder object and (defensively) any
        // nested key the delimiter should already have folded away.
        if (!objectKey || objectKey === prefix) continue;
        const name = objectKey.slice(prefix.length);
        if (!name || name.includes('/')) continue;
        const size = textOf(c, 'Size');
        entries.push({
          name,
          path: `/${objectKey}`,
          isDirectory: false,
          size: size !== undefined ? Number(size) : undefined,
          lastModified: textOf(c, 'LastModified'),
        });
      }
      token = textOf(doc, 'NextContinuationToken');
    } while (token);
    return entries;
  }

  writeText(
    path: string,
    body: string,
    contentType: string = DEFAULT_TEXT_CONTENT_TYPE,
  ): Promise<void> {
    return this.putObject(path, body, contentType);
  }

  writeBinary(
    path: string,
    body: ArrayBuffer,
    contentType: string = DEFAULT_BINARY_CONTENT_TYPE,
  ): Promise<void> {
    return this.putObject(path, body, contentType);
  }

  private async putObject(
    path: string,
    body: string | ArrayBuffer,
    contentType: string,
  ): Promise<void> {
    const res = await this.request(HTTP_PUT, this.urlFor(keyFor(path)), body, {
      'Content-Type': contentType,
    });
    await this.ensureOk(res, 'upload', path);
  }

  /** Object stores have no directories — nothing to create. */
  async ensureDir(_paths: string[]): Promise<void> {}

  async deleteDir(path: string): Promise<void> {
    const prefix = `${keyFor(path)}/`;
    let token: string | undefined;
    do {
      const url =
        `${this.baseUrl}?list-type=2&prefix=${encodeURIComponent(prefix)}` +
        (token ? `&continuation-token=${encodeURIComponent(token)}` : '');
      const res = await this.request(HTTP_GET, url);
      await this.ensureOk(res, 'list', path);
      const doc = new DOMParser().parseFromString(await res.text(), 'application/xml');
      for (const c of Array.from(doc.getElementsByTagName('Contents'))) {
        const objectKey = textOf(c, 'Key');
        if (!objectKey) continue;
        const del = await this.request(HTTP_DELETE, this.urlFor(objectKey));
        // Tolerate a 404: deleted concurrently, which satisfies the intent.
        if (del.status !== HTTP_NOT_FOUND) await this.ensureOk(del, 'delete', objectKey);
      }
      token = textOf(doc, 'NextContinuationToken');
    } while (token);
  }

  // --- streaming (Tauri only) ----------------------------------------------

  /**
   * Streaming upload via a presigned PUT URL: the native transfer plugin
   * streams the file off the disk, so a gigabyte-scale book never lands in
   * the JS heap. Returns `false` on a swallowed failure (provider contract:
   * the engine re-ensures dirs and retries once, then throws).
   */
  async uploadStream(remotePath: string, localPath: string): Promise<boolean> {
    try {
      const url = await this.presign(HTTP_PUT, remotePath);
      await tauriUpload(url, localPath, 'PUT');
      return true;
    } catch (e) {
      console.warn('S3Provider.uploadStream failed', remotePath, e);
      return false;
    }
  }

  /** Streaming download via a presigned GET URL; same contract as upload. */
  async downloadStream(remotePath: string, localPath: string): Promise<boolean> {
    try {
      const url = await this.presign(HTTP_GET, remotePath);
      await tauriDownload(url, localPath);
      return true;
    } catch (e) {
      console.warn('S3Provider.downloadStream failed', remotePath, e);
      return false;
    }
  }

  private async presign(method: string, path: string): Promise<string> {
    const url = `${this.urlFor(keyFor(path))}?X-Amz-Expires=${PRESIGN_EXPIRES_SEC}`;
    const signed = await this.client.sign(url, { method, aws: { signQuery: true } });
    return signed.url;
  }

  // --- request plumbing ----------------------------------------------------

  /** Sign and issue one request, retried on transient failures. */
  private async request(
    method: string,
    url: string,
    body?: string | ArrayBuffer,
    headers?: Record<string, string>,
  ): Promise<Response> {
    return this.withBackoff(async () => {
      const signed = await this.client.sign(url, { method, headers, body });
      return this.fetchFn(signed.url, {
        method,
        headers: Object.fromEntries(signed.headers.entries()),
        body,
      });
    });
  }

  /**
   * Retry on 429/5xx — or a thrown transport error — with `Retry-After`-aware
   * exponential backoff, mirroring the Drive provider (S3 throttling surfaces
   * as 429 SlowDown / 503).
   */
  private async withBackoff(fn: () => Promise<Response>): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fn();
      } catch (e) {
        if (attempt >= MAX_BACKOFF_RETRIES) throw e;
        await this.sleep(BASE_BACKOFF_MS * 2 ** attempt);
        continue;
      }
      const transient =
        res.status === HTTP_TOO_MANY_REQUESTS || res.status >= HTTP_SERVER_ERROR_FLOOR;
      if (!transient || attempt >= MAX_BACKOFF_RETRIES) return res;
      const retryAfter = parseRetryAfterMs(res.headers.get('Retry-After'));
      await this.sleep(retryAfter ?? BASE_BACKOFF_MS * 2 ** attempt);
    }
  }

  /** Throw a status-carrying error for any non-success response. */
  private async ensureOk(res: Response, operation: S3Operation, path: string): Promise<void> {
    if (res.ok || res.status === HTTP_NO_CONTENT) return;
    throw new S3HttpError(res.status, `S3 ${operation} failed: HTTP ${res.status} for ${path}`);
  }
}

const resolveFetch = (): S3FetchFn =>
  (isTauriAppPlatform() ? tauriFetch : globalThis.fetch.bind(globalThis)) as S3FetchFn;

/**
 * Build an S3-compatible {@link FileSyncProvider}. Public methods are wrapped
 * so failures surface as {@link FileSyncError}s the engine can branch on.
 * Streaming methods attach on Tauri only (they hand presigned URLs to the
 * native transfer plugin); on web the engine falls back to buffered I/O. They
 * are deliberately NOT `wrap`ped — they own the boolean swallow-to-`false`
 * contract, matching the WebDAV and Drive providers.
 */
export const createS3Provider = (
  config: S3ProviderConfig,
  fetchFn: S3FetchFn = resolveFetch(),
  options: S3ProviderOptions = {},
): FileSyncProvider => {
  const impl = new S3ProviderImpl(config, fetchFn, options.sleep);
  const provider: FileSyncProvider = {
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

  if (isTauriAppPlatform()) {
    provider.uploadStream = (remotePath, localPath) => impl.uploadStream(remotePath, localPath);
    provider.downloadStream = (remotePath, localPath) => impl.downloadStream(remotePath, localPath);
  }

  return provider;
};
