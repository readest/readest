---
name: webdav-group-membership-sync-4942
description: File-sync mergeBookMetadata dropped groupId/groupName so group changes on already-synced books never propagated
metadata:
  node_type: memory
  type: project
  originSessionId: b97634b0-ccf4-4663-b8c3-895f8e8aed4a
---

MERGED as PR #4946 into `origin/main` (issue #4942, from discussion #4922). WebDAV/file sync only propagated group membership for NEWLY imported books, not for books already present on both devices.

**Root cause**: `src/services/sync/file/merge.ts` `mergeBookMetadata` overlaid a fixed field subset (title/author/metadata/primaryLanguage/updatedAt) and DROPPED `groupId`/`groupName`. Adding a book to a group bumps `book.updatedAt` (`GroupingModal.tsx handleConfirmGrouping`) and pushes the full book (with group fields) into `library.json`. On a peer, an already-present book is reconciled via `mergeBookMetadata` (the `isRemoteBookMetadataNewer` LWW pass in `engine.ts` ~line 445), which won the `updatedAt` race but discarded the group change. New books instead arrive via `addBookToLibrary` with the full remote object, so their group travels on first import — that asymmetry is exactly what the reporter saw.

**Fix**: carry `groupId`/`groupName` in `mergeBookMetadata`, assigned RAW (not `?? local`) so a group removal (undefined on the newer side) also propagates. Matches native cloud sync, which already maps `group_id`/`group_name` in `src/utils/transform.ts`. Deprecated `group` field intentionally left out (native sync doesn't carry it either).

Tests: `merge.test.ts` (add + removal cases), `engine-metadata-sync.test.ts` (full reconcile delivers group into `updateBookMetadata` + re-pushed index). Extends the field subset first documented in [[webdav-metadata-sync-4756]].
