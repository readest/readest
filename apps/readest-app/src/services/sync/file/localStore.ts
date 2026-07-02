import { Book, BookConfig } from '@/types/book';

/** A buffered file payload + its byte length (for the HEAD-vs-local probe). */
export interface BookBytes {
  bytes: ArrayBuffer;
  size: number;
}

/**
 * App-side local I/O the {@link FileSyncEngine} needs, abstracted away from
 * `appService` / Zustand stores so the engine stays testable with a plain
 * fake. One implementation — {@link createAppLocalStore} — is built once per
 * consumer (the reader hook and the library "Sync now" form) and shared, so
 * the buffered + streaming book/cover loaders live in exactly one place
 * instead of being copy-pasted across consumers.
 *
 * Split of responsibilities with {@link FileSyncProvider}:
 *   - provider owns the REMOTE side (and the actual stream transport);
 *   - localStore owns the LOCAL side (reading/writing files on this device,
 *     resolving on-disk paths for streaming, and mutating the local library).
 */
export interface LocalStore {
  /** Load a book's local config (progress + booknotes), or null if none. */
  loadConfig(book: Book): Promise<BookConfig | null>;
  /** Persist a (merged) config to local disk. */
  saveBookConfig(book: Book, config: BookConfig): Promise<void>;

  /** Buffered upload source: the book file bytes, or null when not on disk. */
  loadBookFile(book: Book): Promise<BookBytes | null>;
  /**
   * Streaming upload source: the absolute on-disk path + size of the book
   * file, or null when not on this device. Size lets the engine run the
   * HEAD-vs-local short-circuit without reading any bytes.
   */
  resolveLocalBookPath(book: Book): Promise<{ path: string; size: number } | null>;
  /** Buffered download sink: write freshly-pulled book bytes to disk. */
  saveBookFile(book: Book, bytes: ArrayBuffer): Promise<void>;
  /**
   * Streaming download sink: ensure the per-book directory exists and return
   * the absolute destination path the provider should stream into.
   */
  prepareLocalBookPath(book: Book): Promise<string>;

  /** Buffered cover source, or null when the book has no local cover. */
  loadBookCover(book: Book): Promise<BookBytes | null>;
  /** Write a freshly-pulled cover image to disk. */
  saveBookCover(book: Book, bytes: ArrayBuffer): Promise<void>;

  /** Insert a brand-new book row (no-op on an existing hash). */
  addBookToLibrary(book: Book): Promise<void>;
  /** Persist refreshed metadata for a book already in the local library. */
  updateBookMetadata(book: Book): Promise<void>;
  /**
   * Apply a peer's deletion locally: remove this device's managed copy of the
   * book file and persist the tombstone (`book.deletedAt`) so the book drops
   * off the shelf and stops being re-uploaded. External / in-place sources are
   * never touched — only the app-managed `Books/<hash>/` copy is removed.
   */
  deleteBookLocally(book: Book): Promise<void>;
}
