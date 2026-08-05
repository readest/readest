---
name: book-details-page-count-5516
description: "#5516 Pages field in Book Details rides on book.progress[1]; the reader's bookData.book is a stale open-time snapshot"
metadata: 
  node_type: memory
  type: project
  originSessionId: 8228c408-05d0-4798-8db8-f0a1d5c75551
  modified: 2026-08-05T16:32:00.719Z
---

#5516 "Add page count in book details" — MERGED as PR #5523 (2026-08-06, merge
commit `d7ad9fe56`); worktree and branch cleaned up.
The Book Details **Pages** cell reads `book.progress?.[1]`. Metadata grid
order (user's call): Publisher, Published, Updated, Added, Language, Format,
File Size, **Pages**, Identifier, calibre columns, File Path, then Subjects and Tags
last — the two chip lists are full-width, so mid-grid they pushed every later cell
onto a fresh row and holed the 2-col layout. Mobile end-alignment
(`pe-1 text-end sm:text-start`) alternates by position, so reordering means moving
that class too: it now sits on Published, Added, Format, Pages.

**Where the number actually comes from** (I got this wrong at first and had to
correct it): it is NOT layout-dependent and nothing re-paginates. foliate's
`SectionProgress` (constructed in `view.js` during `open()`, `new SectionProgress(
book.sections, 1500, 1600)`) returns `location.total = ceil(sizeTotal / 1500)`,
where `sizes[i]` is each linear spine item's **uncompressed byte size** from the zip
(`size: this.getSize(item.href)` in `epub.js`). So it is a Kindle-style *locations*
count — one unit per 1500 bytes — stable across font size, margins, and screen. For
fixed layout `readerStore.setProgress` uses `section.total = sizes.length` instead,
which is the true page count. Consequence: a CJK novel reads ~500 chars per "page"
(3 bytes/char) and can show five-digit counts. It is the same total the footer bar
counts against, so the field is at least self-consistent with the rest of the app.

**Why the field is still deferred:** `SectionProgress` only exists once the book has
been opened, and `book.progress` (`[current, total]`, 1-based) is written on the
first relocate by `readerStore.setProgress` — which fires on open, before any page
turn. It is already persisted + synced, so no new Book field or migration was
needed. Unopened books show `Unknown`.

**Pages known while File Size is Unknown** is expected, not a bug:
`getBookFileSize` returns null unless `resolveBookContentSource` yields `managed` or
`external` (the file must be on this device), whereas `progress` is synced library
metadata. A book read on another device and not downloaded here shows a page count
and no file size.

**The trap:** the reader's `bookData.book` (bookDataStore) is the Book snapshot
captured when the book was *opened*, so its `progress` is last session's — absent
entirely on a first read. The live value is `bookData.config.progress`. `BookCard`
(reader sidebar "More Info") therefore merges it in at dispatch time via
`useBookDataStore.getState().getConfig(sideBarBookKey)?.progress` rather than in
the render path — passing a freshly spread `{...book}` down would break
`BookCover`'s `memo` and re-decode the cover on every page turn (see
[[cover-stale-inplace-mutation-memo]]). The library path needs no such fix:
`libraryStore.updateBookProgress` refreshes the library copy immutably on every
relocate.

Verified with throwaway Playwright specs at 1280px and 400px (per
[[settings-panel-screenshot-via-playwright]]) and live in Chrome against the real
710-book library. Note the reader sidebar's `Toggle Sidebar` button is not clickable
at a 400px viewport, so drive the narrow case from the library shelf instead. Chrome
MCP gotchas hit here: `resize_window` silently no-ops on a maximized window, and the
shelf is Virtuoso-virtualized so `find` refs go stale between calls — click via
`javascript_tool` (`cards.find(...).querySelector('button[aria-label="Show Book
Details"]').click()`) instead of coordinates.
