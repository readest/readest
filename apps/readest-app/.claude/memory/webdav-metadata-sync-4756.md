---
name: webdav-metadata-sync-4756
description: WebDAV syncLibrary never refreshed metadata for already-local books; LWW reconciliation on book.updatedAt
metadata: 
  node_type: memory
  type: project
  originSessionId: a9e2f86a-c773-4f5d-95d7-4451d332de5d
---

MERGED as PR #4776 (squash commit `cd3a53f50`) into `origin/main` on 2026-06-25. See [[webdav-filesync-refactor-plan]] for the follow-up refactor.

Issue #4756: after a device already holds a book, mobile's later cover/title edits never reached it.

**Root cause** in `services/webdav/WebDAVSync.ts` `syncLibrary`: the pull/download path only processed hashes NOT already in the local library (`!allBooksMap.has(...)`). Already-local books were push-only, so a peer's metadata edit never came down. Worse, the final `pushLibraryIndex` re-wrote `library.json` from `allBooksMap` (still the stale local book), clobbering the peer's newer metadata on the remote.

**Fix**: added an LWW reconciliation pass keyed on `book.updatedAt` (driven by the shared `library.json` index, NOT the per-hash `config.json`). For books present BOTH locally and in the remote index, when `remote.updatedAt > local.updatedAt`: merge metadata (`mergeRemoteBookMetadata` = title/author/metadata/primaryLanguage/updatedAt only — preserves `sourceTitle`/`filePath`/`coverImageUrl`/progress), re-pull `cover.png`, persist via a NEW `updateBookMetadata` option callback, and `allBooksMap.set(hash, merged)` so the index re-push keeps the newer copy. New `SyncLibraryResult.metadataUpdated` counter surfaced in toast + SyncHistoryPanel.

**Key facts**:
- Metadata edits (cover/title) bump `book.updatedAt` via `getBookWithUpdatedMetadata` (utils/book.ts) — that's the LWW signal. `mergeRemoteBookMetadata` mirrors exactly that field list.
- Title edits are a pure metadata op: remote book file is named by `sourceTitle||title` (`buildBookFileName`) inside a hash dir, so a title change never renames the remote file. Don't merge `sourceTitle` (it ties to the on-disk filename).
- No push-side cover clobber: after pulling the cover, the push-loop `pushBookCover` HEAD/size short-circuit matches (local now == remote) and skips.
- `updateBookMetadata` is distinct from `addBookToLibrary` (which no-ops on an existing hash). Wired in `WebDAVForm.tsx` via `useLibraryStore.updateBook`.
- Reconciliation gated on `canPull` so `strategy:'send'` stays push-only.

**Wire format / merge model** (`RemoteBookConfig` envelope): the remote `config.json` is NOT a blob-LWW'd `BookConfig`. `buildRemotePayload` hoists `booknotes` to a top-level sibling of `config` (which is trimmed to progress/location/xpointer/updatedAt). In `pullBookConfig` the `config.updatedAt` LWW decides ONLY the scalars; `mergedConfig.booknotes = mergeNotes(...)` runs unconditionally (element-set CRDT: union by `id`, per-note `updatedAt`, `deletedAt` tombstones). So co-located in one file, merged by two strategies. Library membership in `library.json` = union-by-hash + tombstones (CRDT); per-book metadata = `book.updatedAt` LWW.

**Follow-up fix (same branch, 2nd commit): config merge before push in `syncLibrary`.** `pushBookConfig` is a blind PUT (no server merge). The reader hook (`useWebDAVSync`) pull-merges before pushing, but the library "Sync now" push loop pushed local config blind → could drop a peer's notes or regress newer remote progress until a device opened the book. Fix: push loop now does `pullBookConfig` → `saveBookConfig`(merged) → `pushBookConfig`(merged superset), gated on `canPull` (`silent` converges, `send` stays blind/authoritative, `receive` never pushes). Convergence works on a lossy single-file transport because notes are a state-based CRDT (each replica holds full state + re-merges).

Related: [[grimmory-native-sync]], [[koplugin-note-deletion-sync]]. WebDAV sync is self-contained (own cover.png + HEAD/size model), separate from native cloud sync's `coverHash`/`coverUpdatedAt` content-addressed signal (#4544).
