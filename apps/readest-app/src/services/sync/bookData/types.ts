// A place a book's data files sync to: one per enabled file-sync backend,
// plus Readest Cloud for books uploaded there. Every destination holds the
// same layout, `<book dir>/<kind>/<name>`, and files are content-named and
// immutable, so a listed name already has the right bytes.
export interface BookDataDestination {
  /** 'readest' or the file-sync backend kind, for logs. */
  readonly id: string;
  /** File names in the book's kind folder; empty on a missing folder or any error. */
  list(bookHash: string, kind: string): Promise<Set<string>>;
  /** A file's bytes, or null when it is missing or unreadable. */
  read(bookHash: string, kind: string, name: string): Promise<ArrayBuffer | null>;
  /** Upload one file. Throws on failure (quota, network, auth). */
  write(
    bookHash: string,
    kind: string,
    name: string,
    body: ArrayBuffer,
    contentType: string,
  ): Promise<void>;
}
