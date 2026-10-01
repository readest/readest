/**
 * Which server implementation answers at `url`. The official `calibre-server`
 * exposes the /ajax JSON API; Calibre-Web is a Flask app whose books are
 * browsed through its OPDS feed. Auto-detected at connect time (see
 * CalibreClient.getLibraryInfo) and persisted on the row.
 */
export type CalibreFlavor = 'calibre' | 'calibre-web';

/** A configured Calibre content server. Mirrors ABSServer (src/types/audiobookshelf.ts). */
export interface CalibreServer {
  /**
   * Stable cross-session id, derived from the URL (see
   * computeCalibreServerId). Baked into every synced book's synthetic
   * `calibre://` filePath and therefore into its hash, so it must never
   * change for a given server URL.
   */
  id: string;
  name: string;
  /** Base URL, no trailing slash, may carry a reverse-proxy path prefix. */
  url: string;
  username?: string;
  password?: string;
  /** Selected calibre library id; absent = the server's default library. */
  libraryId?: string;
  libraryName?: string;
  /** Server flavor; absent means 'calibre' (rows from before detection existed). */
  flavor?: CalibreFlavor;
  lastSyncedAt?: number;
  /**
   * Book count at the last completed full sync, used by the periodic auto
   * pass as a cheap change probe: an unchanged count skips the full feed
   * walk. Manual "Sync Now" always walks. Reset when the library changes.
   */
  lastSyncedBookCount?: number;
  disabled?: boolean;
  addedAt?: number;
  deletedAt?: number;
}

/** Subset of a library from GET /ajax/library-info. */
export interface CalibreLibraryInfo {
  libraries: { id: string; name: string }[];
  defaultLibraryId: string;
  /** The detected server flavor. */
  flavor: CalibreFlavor;
}

/**
 * Subset of the per-book JSON from GET /ajax/books/{library_id}?ids=...
 * (calibre srv/ajax.py book_to_json, backed by JsonCodec.encode_book_metadata).
 * `formats` is a sorted lowercase list of format names; `main_format` maps the
 * server-preferred format to a download URL and `other_formats` the rest.
 * `rating` is a 0–5 float (the server halves the 0–10 database value).
 */
export interface CalibreBookJson {
  title: string;
  title_sort?: string;
  authors: string[];
  author_sort?: string;
  tags?: string[] | null;
  rating?: number | null;
  comments?: string | null;
  series?: string | null;
  series_index?: number | null;
  identifiers?: Record<string, string> | null;
  publisher?: string | null;
  pubdate?: string | null;
  timestamp?: string | null;
  last_modified?: string | null;
  languages?: string[];
  uuid?: string;
  cover?: string;
  thumbnail?: string;
  formats?: string[];
  main_format?: Record<string, string> | null;
  other_formats?: Record<string, string> | null;
  format_metadata?: Record<string, { size?: number; mtime?: string } | undefined>;
}

/** Subset of GET /ajax/search/{library_id}. */
export interface CalibreSearchResult {
  total_num: number;
  num: number;
  offset: number;
  book_ids: number[];
  library_id: string;
}

/** A stored reading position from calibre's per-user progress API. */
export interface CalibrePosition {
  cfi: string;
  epoch: number;
  pos_frac: number;
  device?: string;
  user?: string;
}
