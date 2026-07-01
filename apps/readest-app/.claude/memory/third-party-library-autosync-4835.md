---
name: third-party-library-autosync-4835
description: Third-party cloud sync (WebDAV/Drive) library.json auto-sync on import/delete/close — parity with useBooksSync; delete propagation needs full library
metadata: 
  node_type: memory
  type: project
  originSessionId: 50e2c2b8-ca61-4c33-acae-cd5d2c9aa93f
---

PR #4835 (`feat/third-party-library-autosync`). Adds library-scoped auto-sync for the active third-party file-sync provider so `library.json` stays current without a manual "Sync now".

**Architecture split (important):**
- `library.json` (the remote index) is written ONLY by `engine.syncLibrary` (`src/services/sync/file/engine.ts`). Before this PR that was called from exactly ONE place: the Settings → "Sync now" button (`FileSyncForm.tsx`).
- The reader's `useFileSync` (`app/reader/hooks/`) is PER-BOOK (progress/notes/cover/file) and NEVER touches `library.json` — it's the analogue of `useProgressSync`, not `useBooksSync`.
- So nothing auto-updated `library.json` on import/delete/book-close. Native sync didn't have this gap because `useBooksSync` is library-scoped.

**Fix:** `useLibraryFileSync()` (`app/library/hooks/useLibraryFileSync.ts`), mounted once on the library page next to `useBooksSync()`. Parity counterpart of `useBooksSync`:
- Single `useEffect([library])` → debounced (5s) `engine.syncLibrary`. import (adds row), delete (sets `deletedAt`), book-close (bumps `updatedAt`) all mutate `library`, so one effect covers all three + initial-load pull.
- Builds engine async (Drive keychain probe), keyed on connection-relevant settings (NOT lastSyncedAt). Stable debounced trigger via `runSyncRef` so it isn't lost on re-creation.
- Gated on global file-sync mutex (`fileSyncStore.beginSync` — skip if a manual Sync now holds it), Sync Strategy, Upload Book Files, and `isCloudSyncAllowed`.
- MUST gate on `libraryLoaded` — syncing a transient empty pre-load library would push an empty index and clobber remote.

**Delete propagation gotcha (the key insight):** `engine.syncLibrary` tombstones a deleted book in `library.json` ONLY if the deleted book (with `deletedAt`) is in the `books` arg → it stays in `allBooksMap` → final index carries the tombstone. If filtered out (the old `FileSyncForm` passed `eligibleBooks = filter(!deletedAt)`), then (1) no tombstone AND (2) the discovery books-dir scan (`!allBooksMap.has(hash)`) RE-DOWNLOADS the just-deleted book (its remote hash dir lingers until the separate GC sweep). So BOTH the hook and `FileSyncForm` now pass the FULL library incl. soft-deleted. Engine tests in `engine-metadata-sync.test.ts`.

**Scope:** pushes the deletion tombstone to the index (peers won't re-pull it). Does NOT auto-remove the book from a peer's LOCAL library — engine reconcile skips `rb.deletedAt` entries (`engine.ts` ~line 430). Peer-side local deletion is a future, riskier change.

See [[gdrive-provider-multipr-status]] · [[webdav-metadata-sync-4756]] · [[webdav-filesync-refactor-plan]].
