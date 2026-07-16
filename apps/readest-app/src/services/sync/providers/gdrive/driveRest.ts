/**
 * Pure request builders for the Google Drive v3 REST API.
 *
 * {@link GoogleDriveProvider} drives all of its file operations through the Drive
 * REST endpoints. Drive is *ID-addressed*: there is no path-based lookup, so the
 * provider resolves a logical path segment-by-segment with `files.list` search
 * queries, then acts on the resolved file id with download/upload/metadata
 * endpoints. The query strings and endpoint URLs those calls need are assembled
 * here as small pure functions, kept apart from the provider so the exact wire
 * format (quote escaping, query parameters, `fields` selectors, pagination) is
 * unit-testable without a network and reads as a single source of truth.
 *
 * No `fetch`, no auth, no state — every export is a deterministic string builder.
 *
 * Adapted from ratatabananana-bit/Readest-google-drive-mod-patcher (AGPL-3.0),
 * used with the author's explicit permission. Pagination + `about.get` added for
 * Readest.
 */

/** Drive REST collection endpoint for file *metadata* operations (list/get/patch/delete). */
export const FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';

/**
 * Drive REST *upload* endpoint (a different host path than {@link FILES_ENDPOINT}).
 * Drive splits metadata operations from media transfer onto the `/upload/...`
 * path, so the byte-carrying POST/PATCH requests target this base URL.
 */
export const UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/drive/v3/files';

/** Drive REST endpoint for account info (`about.get`) — used to label the account. */
export const ABOUT_ENDPOINT = 'https://www.googleapis.com/drive/v3/about';

/** MIME type Drive assigns to folders; the marker we use to tell folders from blobs. */
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

/**
 * Max children returned per `files.list` page. Drive caps `pageSize` at 1000;
 * requesting the max minimises round-trips for large hash directories while the
 * provider still loops on `nextPageToken` to drain every page.
 */
const LIST_PAGE_SIZE = 1000;

/**
 * Escape a string literal for embedding inside a Drive search query. Drive query
 * literals are wrapped in single quotes, so the backslash escape character and
 * the single quote both have to be escaped, or a value like a file named
 * `O'Brien` (or one ending in a backslash) breaks out of the literal and
 * malforms the query. Backslashes are escaped FIRST so the backslashes added
 * for the quotes are not doubled.
 */
export const escapeDriveLiteral = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/**
 * Build the `files.list` `q` to find a *named* child directly under a parent —
 * the per-segment lookup that powers path resolution. `trashed = false` keeps
 * tombstoned files (still listable in Drive) from masking a live file of the
 * same name.
 */
export const listQuery = (name: string, parentId: string): string =>
  `name = '${escapeDriveLiteral(name)}' and '${parentId}' in parents and trashed = false`;

/**
 * Build the `files.list` `q` to enumerate *all* live children of a parent — the
 * query behind {@link GoogleDriveProvider.list}.
 */
export const childrenQuery = (parentId: string): string =>
  `'${parentId}' in parents and trashed = false`;

/**
 * URL to download a file's raw bytes. `alt=media` switches the metadata `get`
 * endpoint into returning the file *body* instead of its JSON metadata.
 */
export const mediaDownloadUrl = (fileId: string): string => `${FILES_ENDPOINT}/${fileId}?alt=media`;

/**
 * URL for a multipart upload that creates a new file with its metadata (name +
 * parent) and its bytes in ONE request. Atomicity is the point: the previous
 * two-request create (an unnamed `uploadType=media` POST, which Drive
 * materialises as a file literally called "Untitled" in the user's Drive root,
 * followed by a rename/reparent PATCH) stranded that "Untitled" file whenever
 * the second request failed (#5147).
 */
export const multipartUploadUrl = (): string =>
  `${UPLOAD_ENDPOINT}?uploadType=multipart&fields=id,md5Checksum,size`;

/**
 * URL to overwrite an *existing* file's bytes via a media PATCH. The request
 * body is the raw file bytes (`uploadType=media`), targeted at a known file id.
 */
export const mediaUpdateUrl = (fileId: string): string =>
  `${UPLOAD_ENDPOINT}/${fileId}?uploadType=media&fields=id,md5Checksum,size`;

/**
 * URL to open a *resumable* upload session that creates a new file. Like the
 * multipart create, the initiation request carries the file metadata (name +
 * parent) in its body, so the file can never appear unnamed in the Drive root.
 * The POST replies with the one-time session URI in its `Location` header; the
 * bytes are then PUT to that URI — streamed from disk on Tauri (constant heap,
 * the whole point for large books on mobile), or buffered for a large web
 * upload. `fields=id` narrows the completion response to the new file id.
 */
export const resumableCreateUrl = (): string => `${UPLOAD_ENDPOINT}?uploadType=resumable&fields=id`;

/**
 * URL to open a resumable upload session that overwrites an *existing* file's
 * bytes (a PATCH to the known id), preserving the file id and any links rather
 * than orphaning it. The session-URI handshake is identical to
 * {@link resumableCreateUrl}.
 */
export const resumableUpdateUrl = (fileId: string): string =>
  `${UPLOAD_ENDPOINT}/${fileId}?uploadType=resumable&fields=id`;

/**
 * URL to fetch a single file's metadata, restricted to the {@link FileEntry}
 * fields the provider exposes.
 */
export const metadataUrl = (fileId: string): string =>
  `${FILES_ENDPOINT}/${fileId}?fields=${FILE_FIELDS}`;

/** URL to delete a file by id. */
export const deleteUrl = (fileId: string): string => `${FILES_ENDPOINT}/${fileId}`;

/**
 * URL for the `about.get` call that returns the signed-in user's identity. The
 * `fields` selector is mandatory for `about`; we request only the display
 * name + email so the settings UI can render "Connected as <email>".
 */
export const aboutUrl = (): string => `${ABOUT_ENDPOINT}?fields=user(displayName,emailAddress)`;

/**
 * The metadata `fields` selector requested for individual files and list rows.
 * Drive omits unrequested fields entirely, so this is the contract for what the
 * provider can read back: enough to build a {@link FileEntry}.
 */
const FILE_FIELDS = 'id,name,mimeType,size,modifiedTime,md5Checksum';

/**
 * Build a `files.list` request URL for the given query, asking for the
 * id-resolution/metadata fields the provider uses from each row plus the
 * `nextPageToken` that drives pagination. Pass `pageToken` to fetch a
 * subsequent page; omit it for the first page.
 */
export const listUrl = (query: string, pageToken?: string): string => {
  const url = new URL(FILES_ENDPOINT);
  url.searchParams.set('q', query);
  // `nextPageToken` rides alongside the per-row fields so a large directory is
  // drained page by page rather than silently truncated at the first page.
  url.searchParams.set('fields', `nextPageToken,files(${FILE_FIELDS})`);
  url.searchParams.set('pageSize', String(LIST_PAGE_SIZE));
  if (pageToken) url.searchParams.set('pageToken', pageToken);
  return url.toString();
};
