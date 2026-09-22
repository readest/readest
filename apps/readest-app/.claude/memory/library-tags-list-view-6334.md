---
name: library-tags-list-view-6334
description: "Book tags in list rows + select-mode Tag Books dialog MERGED #6334 (2a9aceba8); no library-wide tag delete by design; list padding + import button fixes; useKeyDownActions stale-closure fix"
metadata: 
  node_type: memory
  type: project
  originSessionId: 9b92eff7-1e6b-44ff-bc12-0af040925cb3
  modified: 2026-09-21T14:31:31.432Z
---

MERGED #6334 as 2a9aceba8 (2026-09-21). Xiaomi-verified on dev-android builds.

- **No library-wide tag delete in Tag Books.** chrox rejected a per-tag × that stripped the tag from every book: too easy to mis-tap. Edits reach ONLY the selected books (`applyBookTagEdits` returns unselected books untouched). Don't re-add it to this dialog.
- Tag chips in list rows: strip is `w-0 min-w-0 flex-1`. Without `w-0` the chips' min-content widened the whole text column and pushed the cloud icon out of the row (overflow-hidden hid it). Start margin via `[:not(:empty)+&]:ms-1.5` because ReadingProgress renders an EMPTY div for unread books.
- Regression from #6329 (configurable bookshelves) fixed here: BookshelfStream put the grid's `px-4 sm:px-2` on list shelves too (32px inset everywhere). List shelves now use the standalone LibraryImportButton like carousel (chrox's choice); only grid keeps the in-grid + tile.
- `useKeyDownActions` used to call the FIRST render's onConfirm/onCancel (effect deps omit them). Now refs. Any dialog whose confirm closes over state was silently broken before.
- CodeRabbit asks declined: await saveLibraryBooks before closing (library-wide fire-and-forget pattern), Radix Dialog (Tag Books mirrors GroupingModal chassis).
- Device trick: inject tags in memory via the React fiber (`memoizedProps.book`) + dispatch a useState queue to re-render; `?view=list` switches view without saving settings.
