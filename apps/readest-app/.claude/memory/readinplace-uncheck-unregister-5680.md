---
name: readinplace-uncheck-unregister-5680
description: "#5680: 'Read books in place' was locked ON for registered folders; fix = editable toggle + symmetric unregister; drag-drop ingress must pass real registration state"
metadata: 
  node_type: memory
  type: project
  originSessionId: cb9cba90-40a8-4eec-b48d-e1f0e1840381
  modified: 2026-08-13T16:22:08.128Z
---

Issue #5680 (Android, 0.12.1): the "Read books in place" checkbox in ImportFromFolderDialog
could never be unchecked for an already-imported folder. Root cause was intentional v1 design:
`readInPlaceLocked` forced the box ON+disabled when the folder was in
`settings.externalLibraryFolders`, with a note "until the user removes it from Settings, which
v1 doesn't expose" — and nothing ever exposed it. Related: the Watched Folders pane only lists
`autoImportFolders`, so a folder imported with read-in-place but NOT auto-import had zero
management surface anywhere (user confirmed this on Android).

Fix: MERGED PR #5685 (2026-08-13, merge commit 130813a07). Android device verify pending:
- Dialog: `readInPlaceChoice: boolean | null` state; derived
  `readInPlace = choice ?? (isRegisteredRoot || initialReadInPlace)`; choice resets to null on
  directory pick so the box snaps to the picked folder's real state. Uncheck + OK reports
  `readInPlace: false`.
- page.tsx: new `unregisterExternalLibraryFolder` (mirror of register); `runFolderImport` now
  has an else-branch calling it.

**Why:** two traps make this fix non-obvious:
1. `runFolderImport` is ALSO called by URL-ingress/drag-drop (`handleImportBooksFromDirectory`)
   with SYNTHETIC values. Its old `readInPlace: false` relied on ingest-layer prefix matching to
   keep registered roots in-place. With the unregister else-branch, a blanket `false` would
   silently unregister a dragged registered root — the synthetic value must be
   `isRegisteredExternalRoot(dirPath)`.
2. Conversion back to copy mode is safe because `resolveBookContentSource` (bookContent.ts)
   prefers the managed `Books/<hash>/` copy over `book.filePath` by design ("filePath can
   outlive a prior in-place/import mode"). Re-importing after unregistration hits byHash dedup,
   `willWriteBookFile` copies the file (no managed copy exists yet), and the stale
   `book.filePath` on the entry is harmless.

**How to apply:** any future per-import in-place opt-out should use the existing
`forceCopy` option in `IngestFileOptions` — the old dialog comment claiming the ingest layer
"ignores any per-import opt-out" was wrong. Sub-paths of a registered root still import
in-place regardless of the checkbox (prefix match, exact-root lock only ever covered the root).
Pre-existing quirk left alone: drag-dropping a watched folder unwatches it
(synthetic `autoImport: false` → `setAutoImportFolder(dir, false, ...)`).
See [[opds-autodownload-tombstone-5658]] for the neighboring auto-import scan machinery.
