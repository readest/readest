---
name: vocabulary-builder-789-6613
description: "#789 + #6613 Vocabulary builder & Word Lens Learning/Mastered marks — PR #7284 OPEN (branch feat/vocabulary-builder, worktree readest-feat-vocabulary-builder; local main fast-forwarded to it 2026-11-03); migration 032 + /api/sync/vocabulary must deploy before clients; PostgREST keyset quoting never run against a DB"
metadata:
  node_type: memory
  type: project
  originSessionId: 0a332389-f619-447a-ae82-745f84de29e7
  modified: 2026-11-03T06:23:19.920Z
---

Owner decisions (2026-11-03): Kindle-style auto-capture of every popup lookup; header chips (layout B, labeled) Learning = always hint, Mastered = never hint, plain lookup = pack decides; hint from pack / dictionary / AI context dictionary / typed; Vocabulary window (layout B list+detail) for review + Anki/CSV export; sync via a dedicated `vocabulary` table (owner asked replica overhead: ~1.6 KB/word and boot pulls re-fetch every kind with a silent 1000-row cap, so a table was chosen, ~0.8 KB/word).

**Why:** non-obvious state that lives outside the code.

**How to apply:**
- Rollout order: migration `docker/volumes/db/migrations/032_add_vocabulary.sql` on prod → web deploy (route `src/pages/api/sync/vocabulary.ts`) → client release. 031 was taken by `031_add_book_original_filename.sql`.
- Never verified: keyset pull `or(updated_at.gt."ts",and(updated_at.eq."ts",id.gt."id"))` against real PostgREST; Word Lens with a downloaded pack (dev-web manifest fetch failed); Ask AI; export download; native builds.
- Lookups create entries with `modifiedAt: 0` so a first lookup on a device never overrides a mark from another device (reviewer Critical); don't "fix" that to Date.now().
- Deferred minors: non-atomic server merge, clock skew, Escape closes window in hint edit, CSV formula injection, no row cap.
- Related: [[dialog-keydown-capture-phase]] (hint Enter needed onKeyDownCapture).
