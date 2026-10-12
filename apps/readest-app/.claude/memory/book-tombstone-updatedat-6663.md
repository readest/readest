---
name: book-tombstone-updatedat-6663
description: "Book deletes must stamp updatedAt or the books pull merge undeletes them; ABS + duplicate-retirement tombstones still don't"
metadata:
  node_type: memory
  type: project
  originSessionId: 35bf4a31-830c-48c2-a4aa-56538b00489e
  modified: 2026-10-09T16:26:11.864Z
---

#6663 "Purge all reading data" did nothing: MERGED #6682 (e969cc54f, 2026-10-10). A user delete never bumped `updatedAt`, and the books pull merge in `useBooksSync` hands the row to the cloud on `matchingBook.updatedAt >= oldBook.updatedAt` (ties go to cloud). Any pull that returned the row before the tombstone push landed reset `deletedAt` to null. The server's configs→books progress piggyback often leaves the cloud `updated_at` ahead of the local one. Fix: `markBookDeleted` in `utils/book.ts` stamps `updatedAt = max(deletedAt, old + 1)`, never lowering a future-dated (clock-skewed) stamp.

**Why:** the same race applies to every book tombstone that leaves `updatedAt` alone.

**How to apply:** still UNFIXED follow-ups that set `deletedAt` without bumping `updatedAt`: duplicate retirement in `bookService.ts` (~line 913) and Audiobookshelf tombstones in `services/audiobookshelf/librarySync.ts` (`syncAbsServer` + `removeAbsServerBooks`). Route them through `markBookDeleted`-style stamping if they resurrect. Related: [[sync-clock-skew-lastsynced-5661]], [[note-edit-clock-skew-sync-wipe-6544]].
