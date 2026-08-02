---
name: bulk-download-select-mode-5244
description: "#5244 bulk Download in the library select-mode bar; group ids expand to books, silent option suppresses per-book toasts"
metadata: 
  node_type: memory
  type: project
  originSessionId: 25987f79-29a8-498b-9595-eadcc70ae71f
  modified: 2026-08-02T15:05:25.829Z
---

Issue #5244 (bulk download by group), MERGED 2026-08-02 as PR #5445
(merge commit fbeb29093). Worktree and branch have been removed.

Shape of the change:

- `selectDownloadableBooks(ids, items, books)` in `libraryUtils.ts` — reuses
  `expandBookshelfSelection` (group id → rendered rollup, nested folders
  included) then filters to `uploadedAt && !downloadedAt && !isFeedBook`. Same
  predicate as the per-book "Download Book" context-menu item, so the bar and
  the badge agree.
- `SelectModeActions` gained `canDownload` + `onDownload`. The button sits
  after Details and carries `max-[500px]:col-start-1`, so it heads the wrapped
  second row (8 items = 2 full rows of 4 when Send is present; on
  web/Linux/Windows the row is `{Download, Delete, Cancel}` and col 4 is
  empty — a 4-col grid cannot centre 3 items). This let the old
  `!sendEnabled && col-start-2` hack on Delete go away.
- `handleBookDownload` gained `silent?: boolean`: queuing 300 books would
  otherwise fire 300 toasts. Bulk path emits one `Downloading {{count}}
  book(s)` up front (true for both the queued Readest Cloud path and the
  synchronous file-backend path) plus an error summary if any call returns
  false. Batched 20-at-a-time like `confirmDelete` so a WebDAV/Drive backend
  isn't hit with hundreds of parallel fetches.

**Verifying select mode on the web dev server** (no Tauri build needed): the
demo books are local-only, so Download renders disabled. Patch
`AppFileSystem` → `files` → `Readest/Books/library.json` in IndexedDB
(`content` is a JSON *string*), set `uploadedAt` and drop `downloadedAt`,
reload, and the cloud-only state appears. Select mode itself can't be entered
with a synthetic click — dispatch `pointerdown`, wait >500ms, then
`pointerup` on `[data-book-hash]` to trip `useLongPress`.

Related: [[i18n-extract-prunes-keys]], [[feedback_en_plurals_manual]] (both
new keys are plurals, so `en/translation.json` needed hand-written
`_one`/`_other`), [[select-mode-actions-overlap-last-book-5175]].
