---
name: auto-import-duplicate-files-reimport
description: "Watched folder with duplicate files re-imports (toast + shelf re-sort) on every foreground; Book records only one filePath, so add altFilePaths"
metadata: 
  node_type: memory
  type: project
  originSessionId: b4fdc8c4-b4f7-4d8f-80fa-69a5a9260781
  modified: 2026-07-26T07:38:46.799Z
---

Auto-import from a watched folder (`settings.autoImportFolders`, feature #3889 /
commit c8e2c9533) fires the "Successfully imported N book(s)" toast on **every
foreground** when the folder holds the same book under two different names.

Root cause — one book, N source paths:
- `Book.filePath` has room for exactly ONE absolute source path, but a watched
  folder can hold several files that all dedup into one book: identical bytes
  (`byHash`) or different bytes with the same metadata (`byMetaKey`).
- `importBook` overwrote `existingBook.filePath` with whichever duplicate was
  ingested last (`bookService.ts`, the `transient || inPlace` branch).
- `collectKnownSourcePaths` (what the scan diffs against, via
  `selectNewImportableFiles`) reads only `filePath`, so the OTHER path looked
  new on the next scan → re-imported → `filePath` flipped back → **ping-pong
  forever**. Each pass also re-parses the file and sets
  `existingBook.createdAt/updatedAt = Date.now()`, so the book jumps to the top
  of the shelf and queues a sync push every single foreground.

Fix (MERGED 2026-07-26 as PR #5337, merge commit `3c154a609`):
- New device-local `Book.altFilePaths?: string[]` — other on-disk paths that
  resolve to the same book. Only `filePath` is ever read for content.
- `displaceSourcePath()` in `bookService.ts` moves the outgoing `filePath` into
  `altFilePaths` (deduped by `normalizeFilePathForIndex`) before the newest path
  takes the slot. **Newest path must keep winning `filePath`** — that is what
  makes a rename recoverable (old name is gone from disk).
- `collectKnownSourcePaths` unions `filePath + altFilePaths`.
- Device-local discipline, same as `filePath`: added to
  `DEVICE_LOCAL_BOOK_FIELDS` in `sync/file/wire.ts` and stripped in
  `useBooksSync.getNewBooks`. The native cloud row is an explicit allow-list
  (`transformBookToDB`) so it needs nothing.
- Deliberately NOT added to `buildBookLookupIndex.byFilePath`: a stale alt path
  should only make auto-import skip a file, never resolve content to the wrong
  book.
- Self-healing on upgrade: an already-ping-ponging library imports once more,
  records the displaced path, then goes quiet.

Tests: `src/__tests__/services/auto-import-duplicate-files.test.ts` (scan →
ingest → re-scan over the real `importBook`, both dedup arms, rename, copy-mode)
and additions to `collect-known-source-paths.test.ts`.

Related: [[demo-books-cloud-sync-5049]], [[in-place-delete-wiped-originals]].
