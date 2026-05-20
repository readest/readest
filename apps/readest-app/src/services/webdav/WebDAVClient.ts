import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '../environment';

/**
 * Minimal WebDAV client used by the Integrations panel.
 *
 * Goals (intentionally narrow): authenticate against the server, prove the
 * configured root directory is reachable, and list its immediate children.
 * Anything more elaborate (downloading book binaries, uploading sync state,
 * etc.) belongs in higher-level sync code that builds on top of this client.
 *
 * Notes on transport:
 * - In Tauri we use `@tauri-apps/plugin-http` to bypass the renderer's CORS
 *   sandbox; in the browser/web build we fall back to `window.fetch` and
 *   rely on the server (or the user's reverse proxy) to send the right
 *   `Access-Control-Allow-*` headers.
 * - All requests use HTTP Basic Auth; users supply username/password in
 *   plaintext and we compose the header here. We never persist the
 *   raw password in this layer — that is the caller's responsibility.
 */

export interface WebDAVEntry {
  /** File or directory name (single path segment, decoded). */
  name: string;
  /** Absolute path on the server, including leading slash, decoded. */
  path: string;
  /** True when the entry is a collection (directory). */
  isDirectory: boolean;
  /** Content length in bytes when reported by the server (files only). */
  size?: number;
  /** Server-provided modification timestamp, if any. */
  lastModified?: string;
}

export interface WebDAVConfig {
  /** Server root URL, e.g. `https://dav.example.com`. Trailing slash optional. */
  serverUrl: string;
  username: string;
  password: string;
}

export interface WebDAVConnectResult {
  success: boolean;
  /** Translation-friendly short message describing the failure, when any. */
  message?: string;
  /** HTTP status surfaced from the server, if the request reached it. */
  status?: number;
}

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:displayname/>
    <D:resourcetype/>
    <D:getcontentlength/>
    <D:getlastmodified/>
  </D:prop>
</D:propfind>`;

/**
 * Strip the trailing slash off a base URL so we can re-add slashes
 * deterministically when joining paths.
 */
const trimTrailingSlash = (s: string) => s.replace(/\/+$/, '');

/**
 * Normalise an arbitrary user-entered path into a server-absolute one
 * with a leading slash and no trailing slash (except for the root).
 *
 * Examples:
 *   ''            -> '/'
 *   '/'           -> '/'
 *   'books'       -> '/books'
 *   '/books/'     -> '/books'
 *   'a/b'         -> '/a/b'
 */
export const normalizeRootPath = (path: string): string => {
  if (!path) return '/';
  let p = path.trim();
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p;
};

/**
 * Encode every path segment for use in a URL while preserving '/' separators.
 * Spaces and unicode characters get %-escaped; existing %-escapes are
 * deliberately left alone so we don't double-encode caller input.
 *
 * The naive `encodeURIComponent(segment)` would re-escape the `%` in an
 * already-escaped triplet (e.g. `%20` becomes `%2520`), which silently
 * corrupts any path the caller chose to pre-encode. Tokenise the segment
 * into "already-escaped %XX" runs and "everything else" first, then
 * encode only the latter.
 */
// Two regexes so the `g`-flag splitter and the non-`g` classifier don't
// share lastIndex state — `RegExp.test` on a `g` regex is stateful and
// would skip every other token here.
const PERCENT_ESCAPE_SPLIT_RE = /(%[0-9A-Fa-f]{2})/g;
const PERCENT_ESCAPE_RE = /^%[0-9A-Fa-f]{2}$/;
const encodeSegment = (segment: string): string => {
  if (!segment) return '';
  // `split` with a capturing group keeps the matched delimiters in the
  // resulting array, so we end up with alternating
  // "raw text"/"%XX"/"raw text"/"%XX" tokens.
  return segment
    .split(PERCENT_ESCAPE_SPLIT_RE)
    .map((token) => (PERCENT_ESCAPE_RE.test(token) ? token : encodeURIComponent(token)))
    .join('');
};
const encodePath = (path: string): string => path.split('/').map(encodeSegment).join('/');

const buildUrl = (serverUrl: string, path: string): string => {
  const base = trimTrailingSlash(serverUrl);
  const normalized = normalizeRootPath(path);
  return `${base}${encodePath(normalized)}`;
};

/**
 * Public form of {@link buildUrl} for callers (e.g. the native streaming
 * downloader) that need to issue raw HTTP requests without going through
 * `requestWithMethod`.
 */
export const buildRequestUrl = buildUrl;

const buildAuthHeader = (username: string, password: string): string => {
  // btoa handles ASCII; for unicode credentials we round-trip through
  // TextEncoder so non-Latin1 characters don't throw.
  const raw = `${username}:${password}`;
  if (typeof btoa === 'function') {
    try {
      return `Basic ${btoa(raw)}`;
    } catch {
      // Fall through to the manual encoder below.
    }
  }
  const bytes = new TextEncoder().encode(raw);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return `Basic ${btoa(binary)}`;
};

/** Public alias for callers that need to build the same Basic header. */
export const buildBasicAuthHeader = buildAuthHeader;

const getFetch = () => (isTauriAppPlatform() ? tauriFetch : window.fetch.bind(window));

/**
 * Pull the inner text of the first matching tag, regardless of namespace
 * prefix. WebDAV servers are inconsistent about prefixes (`d:`, `D:`, none)
 * so a tolerant local-name match keeps the parser robust without reaching
 * for a full XML library.
 */
const extractTagText = (xml: string, localName: string): string | undefined => {
  const re = new RegExp(
    `<(?:[a-zA-Z0-9]+:)?${localName}[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9]+:)?${localName}>`,
    'i',
  );
  const match = re.exec(xml);
  return match ? match[1]!.trim() : undefined;
};

/**
 * `<resourcetype>` contains zero or one `<collection/>` child to flag
 * directories. The element may be self-closing or contain whitespace, hence
 * the relaxed regex.
 */
const isCollection = (resourceTypeXml: string | undefined): boolean => {
  if (!resourceTypeXml) return false;
  return /<(?:[a-zA-Z0-9]+:)?collection\b/i.test(resourceTypeXml);
};

const splitResponses = (xml: string): string[] => {
  const responses: string[] = [];
  const re = /<(?:[a-zA-Z0-9]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?response>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    responses.push(match[1]!);
  }
  return responses;
};

/**
 * Decode the path returned in `<href>`. WebDAV servers may return a fully
 * qualified URL or a server-absolute path; both branches resolve to a path
 * with leading slash and percent-decoded segments.
 */
const decodeHref = (href: string, serverOrigin: string): string => {
  let raw = href.trim();
  if (/^https?:\/\//i.test(raw)) {
    try {
      raw = new URL(raw).pathname;
    } catch {
      // Leave as-is; downstream still gets a sensible string.
    }
  } else if (raw && !raw.startsWith('/') && serverOrigin) {
    // Some servers return relative paths — make them absolute against the
    // origin so the consumer doesn't have to special-case them.
    try {
      raw = new URL(raw, serverOrigin).pathname;
    } catch {
      // Fall through.
    }
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

/**
 * Strip the server's base path (the path component of the configured
 * serverUrl, e.g. `/dav`) off a server-absolute href so the result is
 * expressed in the same coordinate system as the user-facing rootPath.
 *
 * Without this, configuring `serverUrl = https://host/dav` with
 * `rootPath = /apps/books` causes hrefs like `/dav/apps/books/Foo` to be
 * stored verbatim and re-prefixed with `/dav` on the next PROPFIND, yielding
 * `/dav/dav/apps/books/Foo` — a 404 trap.
 */
const stripServerBasePath = (absolutePath: string, serverUrl: string): string => {
  let basePath = '';
  try {
    basePath = new URL(serverUrl).pathname.replace(/\/+$/, '');
  } catch {
    return absolutePath;
  }
  if (!basePath || basePath === '/') return absolutePath;
  if (absolutePath === basePath) return '/';
  if (absolutePath.startsWith(`${basePath}/`)) {
    return absolutePath.slice(basePath.length) || '/';
  }
  return absolutePath;
};

/**
 * Simplest possible reachability probe: PROPFIND with Depth: 0 against the
 * configured root. Used by the Connect button to fail fast on bad
 * URL/credentials/root combinations before we ever try to list children.
 */
export const checkConnection = async (
  config: WebDAVConfig,
  rootPath: string,
): Promise<WebDAVConnectResult> => {
  if (!config.serverUrl) {
    return { success: false, message: 'Server URL is required' };
  }
  const url = buildUrl(config.serverUrl, rootPath);
  const fetchFn = getFetch();
  try {
    const response = await fetchFn(url, {
      method: 'PROPFIND',
      headers: {
        Authorization: buildAuthHeader(config.username, config.password),
        Depth: '0',
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body: PROPFIND_BODY,
    });
    if (response.status === 207 || response.status === 200) {
      return { success: true, status: response.status };
    }
    if (response.status === 401 || response.status === 403) {
      return { success: false, status: response.status, message: 'Authentication failed' };
    }
    if (response.status === 404) {
      return { success: false, status: response.status, message: 'Root directory not found' };
    }
    return {
      success: false,
      status: response.status,
      message: `Unexpected server response (${response.status})`,
    };
  } catch (e) {
    return { success: false, message: (e as Error).message || 'Network error' };
  }
};

/**
 * List the immediate children of the given path on the server.
 *
 * The PROPFIND with `Depth: 1` returns the directory itself plus its
 * children; we drop the self-entry by comparing decoded hrefs against the
 * normalised root, which is more reliable than trusting the server-set
 * `<displayname>` (some servers omit it for the self-entry).
 */
export const listDirectory = async (
  config: WebDAVConfig,
  rootPath: string,
): Promise<WebDAVEntry[]> => {
  const root = normalizeRootPath(rootPath);
  const url = buildUrl(config.serverUrl, root);
  const fetchFn = getFetch();
  const response = await fetchFn(url, {
    method: 'PROPFIND',
    headers: {
      Authorization: buildAuthHeader(config.username, config.password),
      Depth: '1',
      'Content-Type': 'application/xml; charset=utf-8',
    },
    body: PROPFIND_BODY,
  });
  if (response.status !== 207 && response.status !== 200) {
    throw new Error(`PROPFIND failed with status ${response.status}`);
  }
  const xml = await response.text();
  let serverOrigin = '';
  try {
    serverOrigin = new URL(config.serverUrl).origin;
  } catch {
    serverOrigin = '';
  }

  const entries: WebDAVEntry[] = [];
  for (const block of splitResponses(xml)) {
    const hrefRaw = extractTagText(block, 'href');
    if (!hrefRaw) continue;
    const decodedAbsolute = decodeHref(hrefRaw, serverOrigin);
    // Re-express the server-absolute href in the same coordinate system as
    // the user's rootPath by stripping the serverUrl's base path. The
    // resulting `path` is what gets passed back into `buildUrl` on the next
    // PROPFIND — keeping the two in sync prevents accidental re-prefixing.
    const appPath = stripServerBasePath(decodedAbsolute, config.serverUrl);
    const trimmedPath = appPath.replace(/\/+$/, '') || '/';
    // Skip the self entry — it points at the directory we asked about.
    if (trimmedPath === root || trimmedPath === `${root}/`.replace(/\/+$/, '')) continue;

    const resourceType = extractTagText(block, 'resourcetype');
    const isDir = isCollection(resourceType);
    // Prefer the path's last segment over <displayname>: it always reflects
    // what the server stores, which is what users will recognise.
    const segments = trimmedPath.split('/').filter(Boolean);
    const name = segments[segments.length - 1] ?? trimmedPath;
    const sizeStr = extractTagText(block, 'getcontentlength');
    const lastModified = extractTagText(block, 'getlastmodified');
    entries.push({
      name,
      path: trimmedPath,
      isDirectory: isDir,
      size: sizeStr && !isDir ? Number(sizeStr) : undefined,
      lastModified,
    });
  }

  // Show directories first, then files; alphabetic within each bucket.
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
  return entries;
};

/**
 * Error thrown by file-level WebDAV operations. `status` carries the HTTP
 * status when the request reached the server; `code === 'NOT_FOUND'`
 * uniquely identifies a 404 so the higher-level sync layer can branch on
 * "remote has no such file yet" without parsing messages.
 */
export class WebDAVRequestError extends Error {
  status?: number;
  code?: 'NOT_FOUND' | 'AUTH_FAILED' | 'NETWORK';

  constructor(message: string, status?: number, code?: WebDAVRequestError['code']) {
    super(message);
    this.name = 'WebDAVRequestError';
    this.status = status;
    this.code = code;
  }
}

const requestWithMethod = async (
  config: WebDAVConfig,
  path: string,
  method: string,
  init: { headers?: Record<string, string>; body?: BodyInit | null } = {},
): Promise<Response> => {
  const url = buildUrl(config.serverUrl, path);
  const fetchFn = getFetch();
  const headers: Record<string, string> = {
    Authorization: buildAuthHeader(config.username, config.password),
    ...(init.headers || {}),
  };
  try {
    return await fetchFn(url, { method, headers, body: init.body ?? null });
  } catch (e) {
    throw new WebDAVRequestError((e as Error).message || 'Network error', undefined, 'NETWORK');
  }
};

/**
 * GET a file's content. Returns `null` when the server replies 404, so the
 * caller can treat "first push" as a non-error code path. Any other
 * non-2xx surfaces as a `WebDAVRequestError` with the status attached.
 */
export const getFile = async (config: WebDAVConfig, path: string): Promise<string | null> => {
  const response = await requestWithMethod(config, path, 'GET');
  if (response.status === 404) return null;
  if (response.status === 401 || response.status === 403) {
    throw new WebDAVRequestError('Authentication failed', response.status, 'AUTH_FAILED');
  }
  if (response.status < 200 || response.status >= 300) {
    throw new WebDAVRequestError(`GET failed with status ${response.status}`, response.status);
  }
  return response.text();
};

/**
 * GET a file's binary content. Returns `null` when the server replies 404.
 */
export const getFileBinary = async (
  config: WebDAVConfig,
  path: string,
): Promise<ArrayBuffer | null> => {
  const response = await requestWithMethod(config, path, 'GET');
  if (response.status === 404) return null;
  if (response.status === 401 || response.status === 403) {
    throw new WebDAVRequestError('Authentication failed', response.status, 'AUTH_FAILED');
  }
  if (response.status < 200 || response.status >= 300) {
    throw new WebDAVRequestError(`GET failed with status ${response.status}`, response.status);
  }
  return response.arrayBuffer();
};

/**
 * PUT a file. Parent directories must exist first — see `ensureDirectory`
 * which calls `mkdir` for every ancestor. The body is `string` for our
 * JSON metadata files; book binaries take a more specialised path that's
 * not covered by this helper.
 */
export const putFile = async (
  config: WebDAVConfig,
  path: string,
  body: string,
  contentType: string = 'application/json; charset=utf-8',
): Promise<void> => {
  const response = await requestWithMethod(config, path, 'PUT', {
    headers: { 'Content-Type': contentType },
    body,
  });
  if (response.status === 401 || response.status === 403) {
    throw new WebDAVRequestError('Authentication failed', response.status, 'AUTH_FAILED');
  }
  // 200 (existing file replaced), 201 (created), 204 (no content). Some
  // servers also return 207 multistatus for PUT — accept that too rather
  // than fail loudly on a corner-case server quirk.
  if (![200, 201, 204, 207].includes(response.status)) {
    throw new WebDAVRequestError(`PUT failed with status ${response.status}`, response.status);
  }
};

/**
 * Binary equivalent of `putFile`. Used for book files (epub / pdf / ...) —
 * the body is an `ArrayBuffer` and the content type defaults to a
 * generic octet-stream so the server doesn't try to interpret it.
 *
 * Same status-code handling as `putFile`. Parents must already exist.
 */
export const putFileBinary = async (
  config: WebDAVConfig,
  path: string,
  body: ArrayBuffer,
  contentType: string = 'application/octet-stream',
): Promise<void> => {
  const response = await requestWithMethod(config, path, 'PUT', {
    headers: { 'Content-Type': contentType },
    body,
  });
  if (response.status === 401 || response.status === 403) {
    throw new WebDAVRequestError('Authentication failed', response.status, 'AUTH_FAILED');
  }
  if (![200, 201, 204, 207].includes(response.status)) {
    throw new WebDAVRequestError(`PUT failed with status ${response.status}`, response.status);
  }
};

/**
 * HEAD request, returning the remote file's metadata when present.
 * Returns `null` on 404 so callers can branch on "remote has no copy
 * yet" without try/catch ceremony. Other failures throw.
 *
 * `size` is parsed from `Content-Length`; some WebDAV servers omit it on
 * HEAD (notably for chunked-upload landing files), in which case we
 * return `undefined` for the field and the caller should treat the
 * remote as "exists, size unknown" — usually that's enough to skip a
 * needless re-upload.
 */
export const headFile = async (
  config: WebDAVConfig,
  path: string,
): Promise<{ size?: number; etag?: string } | null> => {
  const response = await requestWithMethod(config, path, 'HEAD');
  if (response.status === 404) return null;
  if (response.status === 401 || response.status === 403) {
    throw new WebDAVRequestError('Authentication failed', response.status, 'AUTH_FAILED');
  }
  if (response.status < 200 || response.status >= 300) {
    throw new WebDAVRequestError(`HEAD failed with status ${response.status}`, response.status);
  }
  const sizeHeader = response.headers.get('content-length');
  const etag = response.headers.get('etag') ?? undefined;
  const size = sizeHeader ? Number(sizeHeader) : undefined;
  return { size: Number.isFinite(size) ? (size as number) : undefined, etag };
};

/**
 * MKCOL on a single path. 405 is the standard "directory already exists"
 * response on most WebDAV servers — we fold that into success so callers
 * can call this idempotently without first probing existence.
 */
export const mkdir = async (config: WebDAVConfig, path: string): Promise<void> => {
  const response = await requestWithMethod(config, path, 'MKCOL');
  if (response.status === 201 || response.status === 405) return;
  if (response.status === 401 || response.status === 403) {
    throw new WebDAVRequestError('Authentication failed', response.status, 'AUTH_FAILED');
  }
  if (response.status === 409) {
    // Conflict — usually means a parent directory is missing. Surface as
    // not-found-style so the caller can re-run ensureDirectory.
    throw new WebDAVRequestError('Parent directory missing', 409);
  }
  throw new WebDAVRequestError(`MKCOL failed with status ${response.status}`, response.status);
};

/**
 * Walk every ancestor of `path` and MKCOL it. Idempotent thanks to the
 * 405-as-ok behaviour in `mkdir`. Use this before any PUT to a deep path.
 *
 * Imported lazily from WebDAVPaths via the caller — keeping this client
 * file free of higher-level layout knowledge.
 */
export const ensureDirectory = async (config: WebDAVConfig, ancestors: string[]): Promise<void> => {
  for (const dir of ancestors) {
    await mkdir(config, dir);
  }
};

/** Existence probe via HEAD; returns false on 404, true on 2xx, throws otherwise. */
export const exists = async (config: WebDAVConfig, path: string): Promise<boolean> => {
  const response = await requestWithMethod(config, path, 'HEAD');
  if (response.status === 404) return false;
  if (response.status >= 200 && response.status < 300) return true;
  if (response.status === 401 || response.status === 403) {
    throw new WebDAVRequestError('Authentication failed', response.status, 'AUTH_FAILED');
  }
  throw new WebDAVRequestError(`HEAD failed with status ${response.status}`, response.status);
};

/** Best-effort delete; 404 is treated as success (already gone). */
export const deleteFile = async (config: WebDAVConfig, path: string): Promise<void> => {
  const response = await requestWithMethod(config, path, 'DELETE');
  if (response.status === 404) return;
  if (response.status >= 200 && response.status < 300) return;
  if (response.status === 401 || response.status === 403) {
    throw new WebDAVRequestError('Authentication failed', response.status, 'AUTH_FAILED');
  }
  throw new WebDAVRequestError(`DELETE failed with status ${response.status}`, response.status);
};

/**
 * Recursively DELETE a collection (directory) and everything below it.
 *
 * Per RFC 4918 §9.6.1, `DELETE` on a collection is required to delete
 * the entire subtree, and `Depth: infinity` is the only legal value
 * (servers MUST treat a missing Depth on a collection-DELETE as
 * `infinity`). Some implementations (older Apache mod_dav, a handful
 * of community servers) reject the request with 400/412 if the header
 * is absent — sending it explicitly removes that ambiguity at zero
 * cost. NextCloud, sabre/dav, Synology and Microsoft IIS all accept
 * the explicit form.
 *
 * 404 is treated as success: a directory that already isn't there is
 * the desired post-condition.
 */
export const deleteDirectory = async (config: WebDAVConfig, path: string): Promise<void> => {
  const response = await requestWithMethod(config, path, 'DELETE', {
    headers: { Depth: 'infinity' },
  });
  if (response.status === 404) return;
  if (response.status >= 200 && response.status < 300) return;
  if (response.status === 401 || response.status === 403) {
    throw new WebDAVRequestError('Authentication failed', response.status, 'AUTH_FAILED');
  }
  throw new WebDAVRequestError(`DELETE failed with status ${response.status}`, response.status);
};
