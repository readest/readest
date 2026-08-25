---
name: koreader-highlight-deletion-dedupe-5818
description: "#5818 KOReader highlight deletions never reached Readest: /api/sync GET id-dedupe ranked rows on updated_at only (KO tombstones keep the highlight's original updated_at) so a live duplicate row under Readest's book_hash beat the tombstone; useNotesSync also never cleared overlays for pulled tombstones and dropped unconvertible ones. Fix = dedupeLatest (max(updated_at, deleted_at), ties to tombstone) + overlay removal + cfi preservation + re-push stamp + latest-change merge on the client. MERGED #5853 (e6bb03f05) 2026-08-25, worktree removed; emulator A/B verified; server half live only after the web deploy; reporter device verify pending"
metadata: 
  node_type: memory
  type: project
  originSessionId: bf4f8380-2c46-4b09-9aff-4233393e3ad1
  modified: 2026-08-24T17:48:34.604Z
---

Issue #5818 (2026-08-25): highlight deleted in KOReader stays in Readest; adds sync both ways.

**Root cause (server, the total-loss case):** the same note lives as TWO `book_notes` rows when the two apps hold different file bytes (KO's `partial_md5_checksum` vs Readest's `book.hash`; `meta_hash` bridges them): KO pushes `(K, id)`, Readest pulls it, converts xpointer->cfi and re-pushes under `(R, id)` with `updatedAt = now`. KO's tombstone (`recordDeletion`) keeps the highlight's ORIGINAL `updatedAt` (`datetime_updated or datetime`), and the POST upsert writes it back so the KO row's `updated_at` regresses. `GET /api/sync?type=notes` orders `updated_at DESC` and dedupes on `id` keeping the first row -> live `(R, id)` beat the tombstone. Readest's reopen pull uses `since = lastSyncedAtNotes - 1 day` (useSync.ts init), so both rows are in the window and the tombstone was dropped every time. Readest's own deletions also don't bump `updatedAt` (only `deletedAt = Date.now()`), so the plugin is not the odd one out.

**Root cause (app, the same-hash case):** `useNotesSync.processSyncedNotes` only ever `view.addAnnotation`'d live notes; a pulled tombstone merged `deletedAt` into config but the overlay drawn on mount stayed until a re-render. And `convertXPointersOnPull` discarded any note whose xpointer->cfi conversion failed, tombstones included (`transformBookNoteFromDB` turns null cfi into `''`).

**Fix = PR #5853, MERGED as e6bb03f05 on 2026-08-25 (branch and worktree removed; commits efa8d0331 server + d3d2933f2 app + 588e3f317/810d30389 review follow-ups):**
- `src/pages/api/sync.ts`: exported `dedupeLatest(records, keys)`: single pass, keeps query order, winner per key = greatest `max(updated_at, deleted_at)`, exact tie -> tombstone; module-level `ms()` replaced the 3 local copies. Only `book_notes` passes dedupeKeys.
- `src/app/reader/hooks/useNotesSync.ts`: tombstones bypass conversion; overlays cleared via `getViewsById` (+ `removeGlobalAnnotationOverlays` for global notes) using the LOCAL note (it holds the cfi); `processNewNote` keeps `existingNote.cfi` when the pulled cfi is '' (else `setConfig`'s `discardUnanchoredBooknotes` drops the tombstone entirely); an applied tombstone gets `updatedAt = Date.now()` so the next push tombstones the duplicate row under this device's hash.
- Review follow-up 588e3f317 (CodeRabbit, 2026-08-25): the reader now resolves a pulled note against the local copy by latest change too (`incomingWins`: max(updatedAt, deletedAt), tie -> tombstone), gating the overlay teardown/stamp AND `processNewNote`. Pitfall: the pre-existing "existing wins" merge `{ ...note, ...existingNote }` leaks the incoming `deletedAt` because a live note has no such key; pin `deletedAt: existingNote.deletedAt`.
- Round 2 810d30389: incoming-wins branch pins `deletedAt: note.deletedAt` (latent: server rows always carry `deletedAt: null`, so only key-less sources leaked). CodeRabbit re-reviews within ~2 min of each push; reply in-thread via `gh api .../comments/<id>/replies`.
- Tests (18): `sync-notes-tombstone-dedupe.test.ts`, `sync-notes-tombstone-pull.test.ts` (route-level via the thenable PostgREST builder mock from `sync-books-paged-pull.test.ts`), `useNotesSync-tombstone.test.tsx`.
- No plugin change; server half covers old plugins once the web deploy lands. Known/unchanged: latest-change-wins (edit after delete on the other hash keeps the note), client clocks trusted, id-only dedupe with 7-hex KO ids, dogear bookmark removals fire no `AnnotationsModified` in KOReader (bookmark deletions still don't propagate).

**Verification 2026-08-25:** KOReader emulator (seeded sidecar annotation, `removeItemByIndex/1`, auto-sync pushed `deletedAt`) + curl duplicate row under fake hash `0000000000000000000000000005818a`; Readest-style pull A/B: production (unfixed) returned the live duplicate, local `pnpm dev-web` (fixed) returned the tombstone. Test rows cleaned up (both tombstoned). See [[koreader-emulator-headless-verify]] for the recipe.

**Why:** deletes are changes; any LWW ranking that ignores `deleted_at` silently resurrects. **How to apply:** whenever adding a dedupe/merge over sync rows, rank on `max(updated_at, deleted_at)`; whenever applying pulled tombstones in the reader, also tear down the drawn overlay. Related: [[sync-deleted-at-cursor-invariant]].
