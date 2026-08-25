---
name: backup-orphan-book-files-5837
description: "#5837 Android backup exported hundreds of book files not in the library: backup zipped the whole Books/ tree; orphan dirs come from #5658 (not in 0.12.1), kill windows, and cloud tombstones that never delete local files"
metadata: 
  node_type: memory
  type: project
  originSessionId: 9f157ce7-2830-4615-8d58-0a9186461cda
  modified: 2026-08-24T16:39:37.735Z
---

Issue #5837 (Android 16, Readest 0.12.1, OPDS + KOSync user): the backup zip
held hundreds of EPUB/PDF files for books absent from the library UI; Refresh
Metadata and Manage Cache did not shrink it.

**Root cause (backup side):** `addBackupEntriesToZip` in
`src/services/backupService.ts` walked `Books/` with `readDirectory` and
exported every file except a hard-coded `LIBRARY_META_FILES` set. It never
consulted the library it had just loaded, so any `Books/<hash>/` dir without a
live row shipped. Restore deliberately imports such "orphan hash dirs" (since
#3571), which is why nobody noticed.

**How orphan dirs get created (all code-verified):**
1. #5658: OPDS auto-download resurrects a tombstoned row in memory only while
   the file is re-downloaded to disk; row stays `deletedAt` on disk. Fix #5665
   (`34922b172`) is NOT in v0.12.1 (`git merge-base --is-ancestor` = no), so
   0.12.1 users still produce these. Most likely the reporter's path.
2. Kill window: `importBook` copies into `Books/<hash>/` before the caller's
   `saveLibraryBooks`; an Android process kill mid-import leaves files, no row.
3. Cloud tombstones: NO sync path calls `appService.deleteBook`; only the
   library page (user action), `transferManager` ('cloud'),
   `deleteLibraryService` ('purge') and file-sync `appLocalStore` ('local')
   do. A `deletedAt` pulled from another device hides the row and keeps the
   EPUB.
Also note a plain "Delete" (`'local'`) removes ONLY the managed book file and
keeps `cover.png` + `config.json` on purpose (re-download resumes), so every
tombstoned row still owns a dir. `deletedAt` rows stay in the store's
`library`; only `visibleLibrary` filters them.

**Fix: PR #5851 MERGED 2026-08-24 as `ded443512` (squash of 3 commits:
fix, review hardening, coverage tests); worktree removed. Full suite 809
files / 9979 tests green. /ship review army (5 specialists + Claude
adversarial + Codex x2) drove the hardening below; device verify PENDING
(Xiaomi). Not yet in any release tag (latest v0.12.1); ships with #5665.**

Review-driven rules now in `src/utils/cache.ts` (all tested):
- Scan `Books/` via `resolveFilePath('', 'Books')` + base `'None'`: a
  base-relative read resolves to a Tauri baseDir and MISSES the Rust WalkDir
  fast path (one IPC per entry). `getCacheEntries` for Cache/Temp still has
  that slow path (pre-existing, small dirs).
- `cover.png`/`config.json`/`nav.json` and `audiobook/**` are NEVER
  reclaimed in any unowned dir (transient "Open with" progress lives in a
  rowless dir; config.json references paired audio and only
  `removePairedAudiobook` clears that association).
- Freshness guard: dirs with mtime < 1h (`ORPHAN_SETTLE_MS`) are skipped,
  via new `AppService.stats()`; unknown/failed stat = skip. Covers the
  files-before-row window of importBook, OPDS per-catalog persistence, and
  restore. No importer exposes an in-flight signal.
- Zero-row library = UNKNOWN, not empty: `safeLoadJSON` returns `[]` on a
  corrupt library.json, so Manage Cache offers no orphans and backup falls
  back to exporting every dir (restore's orphan import rebuilds it).
- Any live row protects its dir (Set, not last-wins Map) against duplicate
  hashes in legacy library.json.
- Clear deletes the SCANNED set (state), minus dirs that gained a live row
  by confirm time (`withoutLiveBookEntries`), and surfaces `failed > 0` via
  the existing `Failed to delete {{count}} file(s)` key.

**Original commit (superseded details kept for history):**
- Backup exports only files under dirs of `!deletedAt` library books
  (`liveHashes`); `LIBRARY_META_FILES` removed (root files fall out
  naturally). Restore's orphan import is untouched so old zips still recover.
- New `getOrphanedBookEntries(appService, books)` in `src/utils/cache.ts`:
  all files of hash dirs with no row, plus only BOOK-format files in a
  tombstoned row's dir (cover/config kept by design). Returns `CacheEntry[]`
  with base `'Books'`.
- `CacheManagerWindow` (Advanced Settings > Manage Cache, mobile-only) folds
  those into scan/clear, gated on `libraryLoaded` (an unloaded library would
  flag every book), shows "Includes N orphaned book file(s) not in your
  library" and a stronger confirm sentence. Clearing leaves empty
  `Books/<hash>/` dirs (AppService has no removeDir); harmless.
- Tests: `backup-orphan-files.test.ts` (new), `cache.test.ts`
  (`getOrphanedBookEntries`), `backup-windows-paths.test.ts` fixture now owns
  `BOOK_HASH`. i18n: 2 keys x 34 locales appended by script mirroring each
  locale's `{{count}} files` plural suffix set; en got `_one`/`_other`.

**Open / not done:** no startup reconciliation of `Books/` vs library (the
"should not remain indefinitely" ask); desktop has no Manage Cache entry so
desktop users still cannot reclaim orphans in-app; a reporter diagnostic is
to grep an orphan hash in the zip's `library.json` (present with `deletedAt`
= path 1/3, absent = path 2).

Related: [[opds-autodownload-tombstone-5658]], [[backup-windows-zip-paths-4703]],
[[in-place-delete-wiped-originals]], [[opds-fixes]].
