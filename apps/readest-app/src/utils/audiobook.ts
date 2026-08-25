import type { BookMetadata } from '@/libs/document';
import type { ABSServer } from '@/types/audiobookshelf';
import type { Book } from '@/types/book';

/** Scheme prefix for the synthetic filePath of an ABS streaming audiobook. */
export const ABS_FILE_SCHEME = 'abs://';

/** True when `book` is a streaming audiobook from an Audiobookshelf server (no local file). */
export const isAudiobook = (book: Pick<Book, 'format'>): boolean => book.format === 'ABS';

/** Builds the synthetic filePath for an ABS book: `abs://<serverId>/<itemId>`. */
export const makeAbsFilePath = (serverId: string, itemId: string): string =>
  `${ABS_FILE_SCHEME}${serverId}/${itemId}`;

/** Parses a `filePath` produced by {@link makeAbsFilePath}, or returns null if it isn't one. */
export const parseAbsFilePath = (
  filePath: string | undefined,
): { serverId: string; itemId: string } | null => {
  if (!filePath || !filePath.startsWith(ABS_FILE_SCHEME)) return null;
  const rest = filePath.slice(ABS_FILE_SCHEME.length);
  const slashIndex = rest.indexOf('/');
  if (slashIndex < 0) return null;
  const serverId = rest.slice(0, slashIndex);
  const itemId = rest.slice(slashIndex + 1);
  if (!serverId || !itemId) return null;
  return { serverId, itemId };
};

/**
 * Absolute media URL for a server-relative track path, authenticated by query
 * token (media elements cannot send headers). Takes the server row rather
 * than a client on purpose: callers pass the store's CURRENT row on every
 * load so a token rotated mid-session is used, not one captured at start.
 */
export const buildAbsMediaUrl = (
  server: Pick<ABSServer, 'url' | 'accessToken'>,
  contentPath: string,
): string => {
  const base = server.url.replace(/\/+$/, '');
  const separator = contentPath.includes('?') ? '&' : '?';
  // Encode the token: a `+`, `&`, or `#` in a non-JWT access token would
  // otherwise be reparsed as query syntax and the media request fail auth.
  return `${base}${contentPath}${separator}token=${encodeURIComponent(server.accessToken ?? '')}`;
};

/**
 * Build the `metadata` payload an ABS stub syncs with.
 *
 * The cloud `books` row has no column for `filePath`, `duration`,
 * `absMediaType` or `episodeCount`, and the push strips `filePath` outright
 * because for every other format it is a device-local absolute path. An ABS
 * stub has no file at all — `abs://<serverId>/<itemId>` IS its identity, and
 * the mirrored fields are all a peer has to draw the row — so they travel
 * inside `metadata`, which does sync. Same trick a feed book uses for
 * `metadata.feedUrl` (src/services/rss/feedBookUrl.ts).
 *
 * Any existing metadata (a user's edit) is preserved; only the mirrors are
 * authoritative, so a metadata edit that dropped them is healed on the next
 * reconcile pass.
 */
export const buildAbsBookMetadata = (
  book: Pick<
    Book,
    | 'title'
    | 'author'
    | 'primaryLanguage'
    | 'metadata'
    | 'filePath'
    | 'duration'
    | 'absMediaType'
    | 'episodeCount'
  >,
): BookMetadata => ({
  title: book.title,
  author: book.author,
  language: book.primaryLanguage ?? '',
  ...book.metadata,
  absSource: book.filePath,
  absMediaType: book.absMediaType,
  absEpisodeCount: book.episodeCount,
  absDuration: book.duration,
});

/**
 * Rebuild the device-side fields of a pulled ABS row from its metadata mirror
 * (see {@link buildAbsBookMetadata}). A legacy row pushed before the mirror
 * existed carries nothing to rebuild from and is left untouched — it stays
 * filePath-less, and useBooksSync drops it on the way into the library.
 */
export const restoreAbsBookFields = (book: Book): void => {
  const source = book.metadata?.absSource;
  if (!source || !parseAbsFilePath(source)) return;
  book.filePath = source;
  book.absMediaType = book.metadata?.absMediaType;
  book.episodeCount = book.metadata?.absEpisodeCount;
  book.duration = book.metadata?.absDuration;
};

export interface LibraryOpenSplit {
  /** Set when the whole selection was a single audiobook: open it in the player instead. */
  audiobookHash: string | null;
  /** Remaining ids to open in the reader (audiobook ids filtered out). */
  readerIds: string[];
  /** True when a multi-id open dropped one or more audiobooks. */
  droppedAudiobooks: boolean;
}

/**
 * Splits a library "open these books" request by format: a lone audiobook
 * routes straight to the player, and a mixed multi-open drops audiobooks
 * from the reader ids (the caller toasts when droppedAudiobooks is true).
 * Shared by the library's tap, multi-select, and last-session-restore open
 * paths so the routing rule lives in exactly one place.
 */
export const splitLibraryOpenIds = (
  ids: string[],
  lookup: (hash: string) => Pick<Book, 'format'> | undefined,
): LibraryOpenSplit => {
  if (ids.length === 1) {
    const book = lookup(ids[0]!);
    if (book && isAudiobook(book)) {
      return { audiobookHash: ids[0]!, readerIds: [], droppedAudiobooks: false };
    }
    return { audiobookHash: null, readerIds: ids, droppedAudiobooks: false };
  }
  const readerIds = ids.filter((id) => {
    const book = lookup(id);
    return !book || !isAudiobook(book);
  });
  return { audiobookHash: null, readerIds, droppedAudiobooks: readerIds.length < ids.length };
};
