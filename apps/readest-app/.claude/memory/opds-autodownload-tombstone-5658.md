---
name: opds-autodownload-tombstone-5658
description: "#5658 OPDS auto-downloaded books erased on iOS restart: importBook resurrects tombstoned rows in place but the hook's uniqueNewBooks hash filter skipped persistence; knownEntryIds already saved -> gone forever; NOT a checkpoint (#5615) regression"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2c5271d4-7e20-4f29-b698-646337323134
  modified: 2026-08-13T02:57:03.703Z
---

Issue #5658 (iPadOS 26, Readest 0.12.1): OPDS auto-downloaded books vanish on
every restart and are "never sync'd again"; unreproducible after reinstall.
Reporter guessed 0.11->0.12 migration; the user asked if it was a regression
from the library checkpoint change.

**Not the checkpoint change**: PR #5615 (`createThrottledCheckpoint`) is NOT in
v0.12.1 (`git merge-base --is-ancestor 4bcfcddf2 v0.12.1` = no; release cut at
f3e1df7e0 on 2026-08-08, #5615 merged 08-11). The checkpoint also only wraps
the folder-import loop in library/page.tsx and always flushes at end. No
buffered library.json writes exist in 0.12.1; `saveLibraryBooks` is direct
(merge-floor, `safeSaveJSON` backup-then-main).

Root cause chain (all code-verified):
1. Deleting a book keeps a tombstoned row (`deletedAt` set) in library.json
   (library/page.tsx handleBookDelete) — the trap is armed by ANY deletion.
2. Re-adding a feed mints a new catalog `id` -> fresh subscription state ->
   all entries re-download.
3. `importBook` finds `existingBook` by hash, RESURRECTS it in place
   (`existingBook.deletedAt = null`, bookService.ts ~line 542) and returns the
   existing row — the same object reference as the store's library array row
   (the hook passes `[...library]`, a shallow copy).
4. `syncCatalog` (autoDownload.ts) persists `knownEntryIds` BEFORE the hook
   ever saves the library.
5. `useOPDSSubscriptions` built `existingHashes` from the FULL library
   (including tombstoned rows), filtered the resurrected book out of
   `uniqueNewBooks`, and skipped `setLibrary`/`saveLibraryBooks` entirely.
   Resurrection lived only in mutated memory; disk still had `deletedAt`.
6. Restart -> row loads tombstoned (invisible) AND entry is in knownEntryIds
   -> never downloaded again. Reinstall wipes tombstones -> unreproducible.

The latent bug shipped with auto-download itself (#3844, 0.11); the "0.12
migration" impression is a red herring — any deletion in the install's history
arms it.

Fix (MERGED PR #5665, merge commit 34922b172): mirror
the manual download path (opds/page.tsx saves unconditionally): always
`setLibrary` + `saveLibraryBooks` when `totalNewBooks > 0`, dedupe
`newBooks` by hash (two feed entries can resolve to one file -> same row
twice), and queue cloud uploads from all imported books (`!uploadedAt`), not
just genuinely-new ones. Test:
`src/__tests__/hooks/useOPDSSubscriptions.test.tsx` — mock
`syncSubscribedCatalogs` mutates the snapshot row like importBook does;
verified failing pre-fix, passing post-fix; full suite + lint + format green.

Test-harness gotcha: a `useTranslation` mock returning a NEW function per
render makes `checkOPDSSubscriptions` unstable -> effect refires -> with a
mock that always returns totalNewBooks>0 the setLibrary loop OOMs node. Use a
stable translate fn + `mockImplementationOnce` with a zero-result default (the
real service returns 0 next pass via knownEntryIds).

Kill window FIXED too (same PR): `syncCatalog` now takes
an `onBooksImported` callback invoked with the catalog's imported books BEFORE
`saveSubscriptionState`; the hook merges into the store and AWAITS
`saveLibraryBooks` there. Callback failure aborts the catalog run -> entries
stay unknown -> retried next sync (imports idempotent). Order invariant:
library rows on disk before knownEntryIds records the entries.

Service-test gotcha: opds-auto-download.test.ts's module-level
`loadSubscriptionState` mock resolves ONE SHARED state object; syncCatalog
reassigns `state.knownEntryIds` on it, so ids ACCUMULATE across tests
(clearAllMocks clears calls, not mockResolvedValue). Tests asserting on saved
state must install a fresh-state-per-call mockImplementation.

Related: [[bulk-folder-import-exhaustion-5601]] (same end-only-persistence
class), [[opds-fixes]], [[opds-download-format-filter-5583]].
