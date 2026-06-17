---
name: koplugin-note-deletion-sync
description: "koplugin deleting a note didn't sync to Readest — push only walked live annotations; fixed with persisted tombstones"
metadata: 
  node_type: memory
  type: project
  originSessionId: f3f6e25e-1bde-4e08-9fc9-c8184d1ef457
---

readest.koplugin deletions of highlights/bookmarks never reached the server (#4119 push direction; the pull direction was already handled by `removeDeletedAnnotations`).

**Root cause:** `SyncAnnotations:push` builds its payload from `getAnnotations`, which walks `ui.annotation.annotations` (the *live* list). A deleted note is already removed from that list, so it can never appear in a push — the server never gets a `deleted_at`, and the next pull resurrects it.

**Fix (all in `apps/readest.koplugin/`):**
- `readest_syncannotations.lua`: extracted `buildNoteDescriptor(item, book_hash, meta_hash)` (shared by `getAnnotations` and the new deletion path). Added `recordDeletion(doc_settings, item)` — stamps `deletedAt = os.time()*1000` on the descriptor and persists it under `doc_settings.readest_sync.deleted_notes` (per-book sidecar, survives restart/offline). `push` folds `deleted_notes` into the payload (re-stamping current book/meta hash) and clears them in the success callback only (failed push retries).
- `main.lua` `onAnnotationsModified(items)`: detects a removal via `items.index_modified < 0` (additions use positive index_modified; note-text edits / type-changes carry no index_modified — see KOReader `ReaderBookmark:removeItemByIndex`). Records the tombstone when `access_token` is set (independent of `auto_sync`, so a later manual/close push still carries it).

**Key facts:** note id is deterministic — server-created notes keep their stored `item.id` (pulled in), koplugin-created ones derive `generateNoteId(hash, type, pos0, pos1)`; both match the server row, so the tombstone targets it. Server `sync.ts` POST picks the tombstone via `clientDeletedAt > serverDeletedAt` (deletedAt wins even when updatedAt is stale). Missing `text`/`note` in the payload is fine (`sanitizeString(undefined)` returns undefined; plain highlights already push `note=nil`). Tests in `spec/syncannotations_spec.lua` (recordDeletion + push-folds-tombstones, UI-glued push driven by stub client/doc_settings). Related: [[custom-fonts-reincarnation-4410]] (CRDT remove-wins).
