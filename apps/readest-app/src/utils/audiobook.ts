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
