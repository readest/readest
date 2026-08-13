---
name: bulk-folder-import-exhaustion-5601
description: "#5601 bulk TXT folder import exhausts WebKit/vnodes on macOS; root-cause map (leaked source handles, barrier batches, end-only library.json save) and the two-PR fix"
metadata: 
  node_type: memory
  type: project
  originSessionId: b979fe4b-bab6-491d-8fa1-62277fd95d96
  modified: 2026-08-10T16:32:13.000Z
---

Issue #5601: importing 428 TXT books (2.17 GiB) from a OneDrive File Provider
dir on macOS drove WebContent to ~3 GB, WebKit.Networking +1.4 GB, free vnodes
to 3.58%, Jetsam kills, and left 815 library rows for 428 files after
crash-restart cycles.

Root causes (confirmed by code reading, 2026-08-10):

1. **TXT source handle leak** — `importBook` replaced `fileobj` with the
   converted in-memory EPUB, so `finally` closed the wrong object; every TXT
   import leaked a `NativeFile` (real Tauri `FileHandle` = OS fd/vnode + up to
   50 MB chunk cache) or `RemoteFile` (16 MB cache). Fixed by contributor PR
   **#5607** (early close after convert + chapter-HTML release in
   `createEpub`) — reviewed, correct, full suite green.
2. **macOS reads go through WebKit.Networking**: desktop plain paths open as
   `RemoteFile` over the asset protocol (`nativeAppService.ts` openFile last
   arm, kept because RemoteFile is ~2x faster than NativeFile, tauri#9190),
   so import reads churn the Networking process + CFNetwork cache files.
   `RemoteFile.close()` only clears the JS LRU. UNFIXED; documented residual.
3. **Barrier batches, end-only persistence** (`library/page.tsx importBooks`):
   batches of 4 via `Promise.all`, `updateBooks(..., {skipSave:true})` per
   batch, `saveLibraryBooks` ONCE after all N files. Kill mid-run = book dirs
   on disk, no index rows; partial rows leak in via other savers (sync
   updateLibrary, bookDataStore 30 s throttle) + merge-floor
   `saveLibraryBooks` accumulates rows across crash loops → 815-for-428.
   Copy-mode imports set NO `Book.filePath`, so restart re-imports everything.
4. **Races**: manual Import-from-Folder (`importBooks` not awaited) can
   overlap the watched-folder auto-scan (each builds its own lookupIndex);
   and within one batch two same-hash files both read `byHash` before either
   writes it (write happens only after createDir/writeFile/cover awaits).

My fix — **PR #5615, MERGED 2026-08-11** (`fix/import-pipeline-5601`, rebased onto main after
#5607 squash-merged as dae1783ac; issue comment posted on #5601):
- true worker pool via existing `runWithConcurrency` (concurrency 4), store
  update per completed book;
- `createThrottledCheckpoint` (`src/utils/checkpoint.ts`, 15 s) persists
  library.json during the run; `flush()` at end. Leading-edge + trailing,
  saves never overlap, failed touch-save re-dirties for flush retry;
- `createSerialRunner` (`src/utils/concurrency.ts`) single-flights whole
  importBooks runs;
- byHash re-check in `importBook` right before `books.push` (after last
  await) — raced loser adopts winner row via `existingBook = raced` so the
  normal tail records its path (`displaceSourcePath`). byMetaKey twin race
  (different bytes, same metadata) deliberately left: next sequential scan
  merges them.
Tests: `import-hash-race.test.ts` (barrier on partialMD5 forces both misses),
`checkpoint.test.ts`, serial-runner cases in `concurrency.test.ts`.

Verification: unit suite + lint green. **Xiaomi 13 verified 2026-08-11**
(release+devtools APK, 170 synthetic TXT, drive via CDP): import ~35 s at
concurrency 4, PSS peak ~282 MB settling ~236 MB; force-kill mid-run left a
VALID library.json with 94 rows (old code would have lost all); relaunch +
re-run finished at exactly baseline+170 rows, 0 dupe hashes/metaKeys; third
run added 0 rows (idempotent). Corpus must live under the app's custom root
(`/storage/emulated/0/Books/Readest/TxtImport`) — see quirks below.

Pre-existing Android quirks found while driving (NOT from this change):
1. `allow_paths_in_scopes` invoke returns Ok but does NOT extend fs/asset
   scope for a path never granted by the SAF picker — the "restored last
   folder from localStorage, user hits OK" flow then fails EVERY file open
   (rangefile 403 + fs "forbidden path") with only a FailedImports dialog.
   runFolderImport's re-grant comment claims this works; it doesn't.
2. Watched-folder auto-scan can silently never run: mount trigger no-ops when
   the library page's `loading` is true, refires only on focus/visibility.
3. Import-from-Folder dialog persists format chips in localStorage
   (`readest:lastImportFolderFormats`); a stale "epub,pdf" selection silently
   filters a TXT folder to zero ("No matching books found" toast only).
CDP driving recipe: settings.json via `plugin:fs|read_text_file`/`write_text_file`
(baseDir 13); app code caches `invoke` at init so wrapping
`__TAURI_INTERNALS__.invoke` sees nothing; console.* is stripped in prod
builds — use a MutationObserver on document.body to catch toasts.

Related: [[auto-import-duplicate-files-reimport]], [[pdf-metahash-filename-salt-5411]].
