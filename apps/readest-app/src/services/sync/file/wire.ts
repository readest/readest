import { Book, BookConfig, BookNote } from '@/types/book';

/**
 * Per-book remote payload stored at
 *   <rootPath>/Readest/books/<hash>/config.json
 *
 * The wire format is a thin envelope around the existing local
 * `BookConfig` so the merge logic can stay identical to readest's other
 * sync providers (per-field updatedAt LWW for top-level keys, per-note
 * updatedAt + deletedAt for booknotes). The envelope adds the bare
 * minimum "who/when last wrote this" metadata so clients can detect
 * cross-device clobbers and surface them in diagnostics.
 *
 * FROZEN: `schemaVersion`, `writerVersion`, and the trimmed-config field
 * set are part of the on-wire contract. A refactored client and an old
 * client must interoperate byte-for-byte, so do not rename or re-shape
 * these fields. `writerVersion` keeps its historical `'readest-webdav-1'`
 * value even though the engine is now provider-agnostic — it is an opaque
 * tag, never branched on, and changing it buys nothing.
 */
export interface RemoteBookConfig {
  schemaVersion: 1;
  bookHash: string;
  metaHash?: string;
  /** Trimmed BookConfig — only the keys we care about syncing. */
  config: Partial<BookConfig>;
  /** Booknotes carry their own per-note updatedAt/deletedAt for merging. */
  booknotes: BookNote[];
  writerDeviceId: string;
  writerVersion: 'readest-webdav-1';
  /** When the writer last touched the row (client wall clock, millis). */
  updatedAt: number;
}

/**
 * Convert the live local BookConfig into the wire envelope. We deliberately
 * drop transient view state (search config, RSVP position, viewSettings,
 * etc.) — those are device-local UI preferences, not progress.
 *
 * Why viewSettings stays local even though it lives in BookConfig:
 *   - Different devices have different screen sizes / DPI / typography
 *     preferences. Pushing a phone's 14pt setting onto a desktop would
 *     surprise users in a bad way.
 *   - readest's own cloud sync similarly carves out viewSettings from
 *     cross-device replication. Duplicating that policy here keeps the
 *     backends behaviourally aligned.
 *   - The trim list below is the SOURCE OF TRUTH for what travels —
 *     when adding a new BookConfig field, decide here whether it's a
 *     "reading state" (include) or a "device preference" (skip).
 *
 * Anything not in `trimmed` therefore never reaches the server, and
 * conversely the config merge (see `mergeBookConfig` in merge.ts) only
 * ever merges fields the server actually carries — so a malicious or
 * buggy server can't somehow inject viewSettings into a local config.
 */
export const buildRemotePayload = (
  book: Book,
  config: BookConfig,
  deviceId: string,
): RemoteBookConfig => {
  const trimmed: Partial<BookConfig> = {
    progress: config.progress,
    location: config.location,
    xpointer: config.xpointer,
    updatedAt: config.updatedAt,
  };
  return {
    schemaVersion: 1,
    bookHash: book.hash,
    metaHash: book.metaHash,
    config: trimmed,
    booknotes: config.booknotes ?? [],
    writerDeviceId: deviceId,
    writerVersion: 'readest-webdav-1',
    updatedAt: Date.now(),
  };
};

export const parseRemotePayload = (raw: string | null): RemoteBookConfig | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RemoteBookConfig;
    if (!parsed || parsed.schemaVersion !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
};

/**
 * The shared `<rootPath>/Readest/library.json` index. Membership is a
 * union-by-hash CRDT (with `deletedAt` tombstones); per-book metadata is
 * last-writer-wins on `book.updatedAt`. See merge.ts for the policies.
 */
export interface RemoteLibraryIndex {
  schemaVersion: 1;
  books: Book[];
  updatedAt: number;
  /**
   * Hashes whose book FILE (not just config/cover) is confirmed present on the
   * remote. A book's file is immutable per hash, so once uploaded it never
   * needs re-checking — recording it here lets an incremental "Sync now" skip
   * the per-book HEAD probe for already-mirrored files and stay O(changed)
   * instead of O(library) when "Upload Book Files" is on (#4856).
   *
   * Optional + additive: a legacy/absent value is treated as empty, so an old
   * client that rewrites the index simply drops it and the next new-client sync
   * re-verifies each file once (a bounded, self-healing HEAD) and re-records it.
   */
  uploadedHashes?: string[];
  /**
   * Hash dirs inspected by discovery and found to hold no book file (config /
   * cover only — legacy leftovers, or peers syncing without "Upload Book
   * Files"). Discovery skips them instead of re-listing every one on every
   * run. A dir is re-checked when {@link uploadedHashes} says its file has
   * arrived, on Full Sync, and whenever the record is dropped by a legacy
   * client (same optional + additive self-healing contract as uploadedHashes).
   */
  emptyDirs?: string[];
}

export const parseRemoteLibraryIndex = (raw: string | null): RemoteLibraryIndex | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RemoteLibraryIndex;
    if (parsed && parsed.schemaVersion === 1) return parsed;
  } catch {
    // Ignore parse errors — a malformed index is treated as "no index".
  }
  return null;
};
