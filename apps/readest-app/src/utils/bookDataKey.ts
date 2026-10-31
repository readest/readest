// A book's synced data (TTS packs, later translations) sits one folder down
// from the book, at `.../Books/<hash>/<kind>/<file>`, and its `files` rows carry
// the book's `book_hash`. The book file and cover are always
// `.../Books/<hash>/<file>`. Anything picking "the book file" by hash skips these.
export const isBookDataFileKey = (fileKey: string): boolean =>
  /\/Books\/[^/]+\/[^/]+\/[^/]+$/.test(fileKey);
