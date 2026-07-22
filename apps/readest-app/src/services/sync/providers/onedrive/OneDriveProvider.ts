/**
 * Microsoft OneDrive implementation of {@link FileSyncProvider}, backed by the
 * Graph App Folder (`approot`) — an isolated per-app directory. Graph is
 * PATH-addressed, so (unlike the id-addressed Drive provider) there is no
 * path->id resolution or cache: each logical path maps straight to an approot
 * URL. Errors are normalised to {@link FileSyncError}; 429/5xx and thrown
 * transports are retried with Retry-After-aware backoff. Auth + fetch + sleep
 * are injected so the provider is unit-testable against a mocked Graph.
 */
import { stat } from '@tauri-apps/plugin-fs';
import { isTauriAppPlatform } from '@/services/environment';
import {
  FileEntry,
  FileHead,
  FileSyncError,
  FileSyncErrorCode,
  FileSyncProvider,
} from '@/services/sync/file/provider';
import { tauriDownload, tauriUpload } from '@/utils/transfer';
import {
  childrenUrl,
  contentUrl,
  createChildUrl,
  deleteItemUrl,
  itemUrl,
  uploadSessionUrl,
} from './graphRest';

export interface OneDriveAuth {
  getAccessToken(): Promise<string>;
}
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
export type SleepFn = (ms: number) => Promise<void>;
export interface OneDriveProviderOptions {
  sleep?: SleepFn;
}

const HTTP_GET = 'GET';
const HTTP_POST = 'POST';
const HTTP_PUT = 'PUT';
const HTTP_DELETE = 'DELETE';

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_REQUEST_TIMEOUT = 408;
const HTTP_CONFLICT = 409;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR_FLOOR = 500;

const CONTENT_TYPE_HEADER = 'Content-Type';
const JSON_CONTENT_TYPE = 'application/json';
const DEFAULT_TEXT_CONTENT_TYPE = 'application/json';
const DEFAULT_BINARY_CONTENT_TYPE = 'application/octet-stream';
const HEAD_SELECT = 'size,cTag,file,folder';

const MAX_BACKOFF_RETRIES = 4;
const BASE_BACKOFF_MS = 500;
const MS_PER_SEC = 1000;

/** Graph error codes that are transient even under a 403 (throttling). */
const THROTTLE_CODES = new Set(['activityLimitReached', 'quotaLimitReached']);
/** Graph error code that makes a folder-create idempotent (already exists). */
const NAME_EXISTS_CODE = 'nameAlreadyExists';

type OneDriveOperation = 'read' | 'head' | 'list' | 'write' | 'create folder' | 'delete';

interface GraphItem {
  name?: string;
  size?: number;
  cTag?: string;
  file?: unknown;
  folder?: unknown;
}
interface GraphChildrenPage {
  value?: GraphItem[];
  '@odata.nextLink'?: string;
}
interface GraphErrorBody {
  error?: { code?: string; message?: string };
}

class GraphHttpError extends Error {
  constructor(
    readonly status: number,
    readonly graphCode: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'GraphHttpError';
  }
}

const mapGraphError = (e: unknown): FileSyncError => {
  if (e instanceof FileSyncError) return e;
  if (e instanceof GraphHttpError) {
    let code: FileSyncErrorCode;
    if (e.status === HTTP_UNAUTHORIZED) {
      code = 'AUTH_FAILED';
    } else if (e.status === HTTP_FORBIDDEN) {
      code = THROTTLE_CODES.has(e.graphCode ?? '') ? 'NETWORK' : 'AUTH_FAILED';
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
    /sending request|network|connection|timed out|timeout|dns/i.test(message);
  return new FileSyncError(message, networkLike ? 'NETWORK' : 'UNKNOWN');
};

const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    throw mapGraphError(e);
  }
};

const splitSegments = (path: string): string[] => path.split('/').filter((s) => s.length > 0);
const joinAbs = (parent: string, name: string): string =>
  parent === '/' || parent === '' ? `/${name}` : `${parent}/${name}`;
const parentOf = (path: string): string => {
  const segs = splitSegments(path);
  segs.pop();
  return segs.length ? `/${segs.join('/')}` : '/';
};
const nameOf = (path: string): string => splitSegments(path).pop() ?? '';

const toFileEntry = (parentPath: string, item: GraphItem): FileEntry => {
  const isDirectory = item.folder !== undefined;
  const name = item.name ?? '';
  return {
    name,
    path: joinAbs(parentPath, name),
    isDirectory,
    size: !isDirectory ? item.size : undefined,
  };
};

const parseRetryAfterMs = (header: string | null): number | undefined => {
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * MS_PER_SEC : undefined;
};
const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readGraphErrorCode = async (res: Response): Promise<string | undefined> => {
  try {
    return ((await res.json()) as GraphErrorBody).error?.code;
  } catch {
    return undefined;
  }
};

class OneDriveProviderImpl {
  readonly rootPath = '/';
  constructor(
    private readonly auth: OneDriveAuth,
    private readonly fetchFn: FetchFn,
    private readonly sleep: SleepFn = defaultSleep,
  ) {}

  async readText(path: string): Promise<string | null> {
    const res = await this.getContent(path);
    return res ? res.text() : null;
  }
  async readBinary(path: string): Promise<ArrayBuffer | null> {
    const res = await this.getContent(path);
    return res ? res.arrayBuffer() : null;
  }
  async head(path: string): Promise<FileHead | null> {
    const res = await this.authedFetch(itemUrl(path, HEAD_SELECT), HTTP_GET);
    if (res.status === HTTP_NOT_FOUND) return null;
    await this.ensureOk(res, 'head', path);
    const item = (await res.json()) as GraphItem;
    return { size: item.size, etag: item.cTag };
  }
  async list(path: string): Promise<FileEntry[]> {
    const entries: FileEntry[] = [];
    let url: string | undefined = childrenUrl(path);
    while (url) {
      const res = await this.authedFetch(url, HTTP_GET);
      if (res.status === HTTP_NOT_FOUND) return entries;
      await this.ensureOk(res, 'list', path);
      const page = (await res.json()) as GraphChildrenPage;
      for (const item of page.value ?? []) entries.push(toFileEntry(path, item));
      url = page['@odata.nextLink'];
    }
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
    const res = await this.authedFetch(contentUrl(path), HTTP_PUT, {
      headers: { [CONTENT_TYPE_HEADER]: contentType },
      body,
    });
    await this.ensureOk(res, 'write', path);
  }
  async ensureDir(paths: string[]): Promise<void> {
    for (const path of paths) await this.createFolder(path);
  }
  async deleteDir(path: string): Promise<void> {
    const res = await this.authedFetch(deleteItemUrl(path), HTTP_DELETE);
    if (res.status === HTTP_NOT_FOUND) return;
    await this.ensureOk(res, 'delete', path);
  }

  // --- streaming (Tauri only) ----------------------------------------------

  /**
   * Streaming upload: open a Graph upload session and PUT the whole file to
   * the returned pre-authed `uploadUrl` straight from disk, so a gigabyte-scale
   * book never lands in the JS heap (buffered {@link writeBinary} marshals the
   * whole file across the WebView↔Rust bridge, which crashes the renderer on
   * mobile). Unlike Drive's resumable session, Graph's single-PUT completion
   * requires an explicit `Content-Range` naming the total size, so the local
   * file size is read via the Tauri fs plugin before the PUT.
   *
   * Returns `true` on success, `false` on a swallowed failure (matching the
   * provider contract: the engine retries once, then falls back to buffered).
   */
  async uploadStream(remotePath: string, localPath: string): Promise<boolean> {
    try {
      const size = (await stat(localPath)).size;
      const uploadUrl = await this.openUploadSession(remotePath);
      await tauriUpload(uploadUrl, localPath, 'PUT', undefined, {
        'Content-Range': `bytes 0-${size - 1}/${size}`,
      } as unknown as Map<string, string>);
      return true;
    } catch (e) {
      console.warn('OneDriveProvider.uploadStream failed', remotePath, e);
      return false;
    }
  }

  /**
   * Open a Graph upload session and return its one-time, pre-authed
   * `uploadUrl`. `replace` conflict behavior makes this create-or-overwrite,
   * matching the buffered {@link writeBinary} path's semantics.
   */
  private async openUploadSession(path: string): Promise<string> {
    const res = await this.authedFetch(uploadSessionUrl(path), HTTP_POST, {
      headers: { [CONTENT_TYPE_HEADER]: JSON_CONTENT_TYPE },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
    });
    await this.ensureOk(res, 'write', path);
    const { uploadUrl } = (await res.json()) as { uploadUrl?: string };
    if (!uploadUrl) {
      throw new GraphHttpError(res.status, undefined, `OneDrive upload: no uploadUrl for ${path}`);
    }
    return uploadUrl;
  }

  /**
   * Streaming download: GET the file's bytes straight to disk through the
   * native transfer plugin (same heap-safety rationale as {@link uploadStream}).
   * The content URL needs a bearer token. Returns `false` when the transport
   * swallows a failure (e.g. the remote file is absent).
   */
  async downloadStream(remotePath: string, localPath: string): Promise<boolean> {
    try {
      const token = await this.auth.getAccessToken();
      await tauriDownload(contentUrl(remotePath), localPath, undefined, {
        Authorization: `Bearer ${token}`,
      });
      return true;
    } catch (e) {
      console.warn('OneDriveProvider.downloadStream failed', remotePath, e);
      return false;
    }
  }

  private async getContent(path: string): Promise<Response | null> {
    const res = await this.authedFetch(contentUrl(path), HTTP_GET);
    if (res.status === HTTP_NOT_FOUND) return null;
    await this.ensureOk(res, 'read', path);
    return res;
  }

  /** Create one folder (idempotent: 409 nameAlreadyExists is success). */
  private async createFolder(path: string): Promise<void> {
    const res = await this.authedFetch(createChildUrl(parentOf(path)), HTTP_POST, {
      headers: { [CONTENT_TYPE_HEADER]: JSON_CONTENT_TYPE },
      body: JSON.stringify({
        name: nameOf(path),
        folder: {},
        '@microsoft.graph.conflictBehavior': 'fail',
      }),
    });
    if (res.status === HTTP_CONFLICT) {
      const code = await readGraphErrorCode(res);
      if (code === NAME_EXISTS_CODE) return;
      throw new GraphHttpError(res.status, code, `OneDrive create folder failed for ${path}`);
    }
    await this.ensureOk(res, 'create folder', path);
  }

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

  private async ensureOk(res: Response, operation: OneDriveOperation, path: string): Promise<void> {
    if (res.ok) return;
    const code = await readGraphErrorCode(res);
    throw new GraphHttpError(
      res.status,
      code,
      `OneDrive ${operation} failed: HTTP ${res.status}${code ? ` (${code})` : ''} for ${path}`,
    );
  }
}

/**
 * Build a OneDrive {@link FileSyncProvider}. Each method is wrapped so a Graph
 * failure surfaces as a {@link FileSyncError} the engine can branch on —
 * mirroring `createGoogleDriveProvider`.
 *
 * Streaming `uploadStream`/`downloadStream` are attached only on Tauri
 * platforms (they shell the bytes through the native transfer plugin off the
 * disk); on web they stay absent and the engine falls back to buffered
 * read/write. They are deliberately NOT `wrap`ped — they own the provider's
 * boolean contract (swallow-to-`false`), matching `createGoogleDriveProvider`.
 */
export const createOneDriveProvider = (
  auth: OneDriveAuth,
  fetchFn: FetchFn,
  options: OneDriveProviderOptions = {},
): FileSyncProvider => {
  const impl = new OneDriveProviderImpl(auth, fetchFn, options.sleep);
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
