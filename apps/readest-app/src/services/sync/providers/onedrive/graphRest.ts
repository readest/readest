/**
 * Pure request builders for the Microsoft Graph OneDrive App Folder REST API.
 *
 * Unlike Google Drive (id-addressed), Graph addresses items in the app folder
 * (`approot`) BY PATH: `/me/drive/special/approot:/{path}` for metadata,
 * `:/content` for bytes, `:/children` for listings. The path is URL-encoded
 * per segment. A root-level operation drops the `:/{path}:` colon form for the
 * bare `/approot/children` collection. No fetch, no auth, no state.
 */

export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const APPROOT = `${GRAPH_BASE}/me/drive/special/approot`;
/** Metadata + list selectors: enough to build a FileEntry + change-detect via cTag. */
const CHILD_SELECT = 'name,size,cTag,file,folder';
const LIST_PAGE_SIZE = 200;

/** Strip leading/trailing slashes and URL-encode each path segment. */
export const encodeGraphPath = (path: string): string =>
  path
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(s))
    .join('/');

/** Metadata URL for an item addressed by path, with an optional `$select`. */
export const itemUrl = (path: string, select?: string): string => {
  const enc = encodeGraphPath(path);
  const base = enc ? `${APPROOT}:/${enc}` : APPROOT;
  return select ? `${base}?$select=${select}` : base;
};

/** Content (bytes) URL for an item addressed by path. */
export const contentUrl = (path: string): string => `${APPROOT}:/${encodeGraphPath(path)}:/content`;

/** Children-listing URL for a folder addressed by path (root => no colon form). */
export const childrenUrl = (path: string): string => {
  const enc = encodeGraphPath(path);
  const base = enc ? `${APPROOT}:/${enc}:/children` : `${APPROOT}/children`;
  return `${base}?$select=${CHILD_SELECT}&$top=${LIST_PAGE_SIZE}`;
};

/** Children-collection URL to POST a new child into (root => no colon form). */
export const createChildUrl = (parentPath: string): string => {
  const enc = encodeGraphPath(parentPath);
  return enc ? `${APPROOT}:/${enc}:/children` : `${APPROOT}/children`;
};

/** Delete URL for an item addressed by path. */
export const deleteItemUrl = (path: string): string => `${APPROOT}:/${encodeGraphPath(path)}`;

/** Upload-session URL for a large-file streaming upload addressed by path. */
export const uploadSessionUrl = (path: string): string =>
  `${APPROOT}:/${encodeGraphPath(path)}:/createUploadSession`;

/** `/me` URL restricted to the identity fields used for the account label. */
export const meUrl = (): string => `${GRAPH_BASE}/me?$select=userPrincipalName,mail,displayName`;
