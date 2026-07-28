---
name: gdrive-delete-locally-wiped-cloud-5084
description: "#5084/#5265 Delete-locally wiped the Google Drive copy; PR #5087 fixed the index but not already-poisoned local rows (stale filePath -> no-source), residue fixed by PR #5376 MERGED"
metadata:
  node_type: memory
  type: project
  originSessionId: b616ba37-dbf6-48e5-95b9-34fd2c642626
  modified: 2026-07-28T14:09:33.760Z
---

Issue #5084, fixed by PR #5087 (commit 5834bbccf, merged 2026-07-13 — AFTER v0.11.18 shipped, so 0.11.18 fleets still have it; it caused the mass-deletion half of [[gdrive-untitled-root-files-5147]]). Reopened as **#5265** ("still reproducible in v0.11.20", which DOES contain #5087).

Mechanics on the broken versions: the file-sync engine published Book rows to the shared library.json VERBATIM (including the writer's device-local `filePath`/`downloadedAt`) and never stamped `uploadedAt` for provider-synced books. Peers adopting those rows read them as purely-local books whose file is missing; useOpenBook's stale-record cleanup then showed "Book file no longer exists. Confirm deletion..." and the confirm dispatched `handleBookDelete('both')` → `deletedAt` tombstone → engine deletion propagation removed the book on every device and `dirsToGc` GC'd its Drive hash dir. "Remove from Device Only" hit the same trap via cleared `downloadedAt`.

Fix (#5087): `stripDeviceLocalFields` on index publish AND on row adoption (heals poisoned indexes from older clients); engine stamps `uploadedAt` via `stampCloudCopy` + batch `LocalStore.markBooksUploaded` (live-row stamping so a long sync can't roll back concurrent progress); makeBookAvailable probes the file instead of trusting `downloadedAt`; third-party cloud deletes no longer route through the Readest Cloud transfer queue.

## #5265 — why #5087 was not enough (fixed by PR #5376, MERGED 2026-07-28)

`stripDeviceLocalFields` heals rows on **adoption** (the discovery path, `!allBooksMap.has(hash)`). A row already sitting in the LOCAL library, poisoned before the upgrade, is never healed — and `mergeBookMetadata` deliberately preserves local `filePath`. So the foreign path lives on forever, and:

1. `appLocalStore.loadBookFile` / `resolveLocalBookPath` used `book.filePath ?? getLocalBookFilename(book)` — **filePath won unconditionally**. A poisoned row resolves to a path that cannot exist, so `pushBookFile` returns `no-source` for a book whose managed copy `Books/<hash>/…` is right there. → never uploaded from that device, never added to `uploadedHashes`, `stampCloudCopy` never runs, `uploadedAt` stays null.
2. `uploadedAt` null + `filePath` set is exactly the "purely-local book" classification. Once "Remove from Device Only" deletes the managed copy, the next tap hits useOpenBook's stale-record cleanup → 'both' → tombstone → Drive GC.

Fixed by:
- `resolveLocalSource(appService, book)` in `appLocalStore.ts` — managed copy first, `filePath` only as fallback, matching the precedence `resolveBookContentSource` already documents. (`filePath` is set ONLY by in-place/transient imports — `bookService.ts:678` is the only assignment — so on a normal-import device any `filePath` is by definition foreign.)
- `hasFileSyncMirror()` gate in `useOpenBook`: the stale-record cleanup is the ONLY automatic route into `handleBookDelete('both')`; with a file mirror on it is skipped entirely, and `makeBookAvailable` no longer early-returns on `!uploadedAt` so the book is re-fetched from the mirror instead.

Invariant to keep: **a missing LOCAL file must never escalate to a REMOTE deletion.** Only two call sites can delete a remote book dir — `dirsToGc` (tombstone GC) in `engine.ts` and `WebDAVBrowsePane`.

Tests: `src/__tests__/app/library/useOpenBook.test.tsx`, plus the `#5265` describe in `src/__tests__/services/sync/file/appLocalStore.test.ts`.
