---
name: readera-imported-highlight-tap-6160
description: "#6160 imported ReadEra highlights did nothing on tap (Android) - stale null `progress` in the once-registered show-annotation listener threw on page-less notes"
metadata:
  node_type: memory
  type: project
  originSessionId: 88f86351-5ba8-41dd-b529-7e8117b5abe4
  modified: 2026-09-30T17:07:41.287Z
---

Issue #6160 (2026-10-01): tapping a highlight imported from ReadEra did nothing on Android; native ones worked.

**Root cause:** `useFoliateEvents` registers `onShowAnnotation` once per `[view]`, so the
`progress` (`useBookProgress(bookKey)!`) it closes over is null until the first relocate.
`page: annotation.page || progress.page` threw `Cannot read properties of null (reading 'page')`
for any note WITHOUT a `page`. Every imported note (ReadEra, likely mrexpt too) lacks one, so
the listener died before `handleUpToPopup()`, and the tap fell through to the toolbar / page
turn. The conversion itself was correct: all CFIs resolved to the right text. The web build did
NOT reproduce it; only the device did.

**Fix:** read live progress: `annotation.page || getBookProgress(bookKey)?.page || 0`. Branch
`fix/readera-annotation-tap-6160` (worktree `~/dev/readest-fix-readera-annotation-tap-6160`),
test `AnnotatorShowImportedAnnotation.test.tsx`. Xiaomi-VERIFIED on a dev-android build.
MERGED #6515 as db51eb343 (2026-10-01), UNRELEASED; worktree + branch removed.

**Device recipe:** a real ReadEra backup (3 highlights on sample-alice.epub, 1 with a note)
is at `~/…/scratchpad` only - regenerate by making highlights in ReadEra (org.readera is
installed on the Xiaomi) and Settings → Backup & Restore → Create a backup; the file lands in
`/sdcard/ReadEra/Backups/`. `getEventListeners(foliateView)['show-annotation']` over CDP
(`includeCommandLineAPI: true`) prints the minified handler, which exposed the bug instantly.
Another Claude session was driving the same Xiaomi at the same time; check `ps` for other
`adb -s 368b0948` commands before tapping.
