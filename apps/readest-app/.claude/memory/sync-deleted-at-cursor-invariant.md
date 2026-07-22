---
name: sync-deleted-at-cursor-invariant
description: Which /api/sync pull tables can drop the deleted_at OR (server-stamped updated_at) vs where it is load-bearing
metadata: 
  node_type: memory
  type: project
  originSessionId: ba4f6b55-ec46-46e7-bc54-9ddb45cba971
---

`/api/sync` GET pulls filter changes since a cursor. Two families with OPPOSITE `deleted_at` semantics:

- **Server-monotonic `updated_at` → `deleted_at` OR is REDUNDANT.** `stat_pages`/`stat_books` push handlers stamp `updated_at = new Date()` on EVERY write incl. deletes (sync.ts ~636/677); `books` uses trigger-bumped `synced_at` (#4678). A delete always lands with cursor-column > any peer's `max(updated_at)` cursor, so `updated_at > since` alone catches it.
- **Client `updated_at` → `deleted_at` OR is LOAD-BEARING.** `book_notes`/`book_configs` preserve the client's `updated_at` on update (sync.ts merge `toUpdate.push(dbRec)`, no `now()` overwrite; only inserts get `now()`). Note deletion bumps ONLY `deletedAt`, NOT `updatedAt` (`Notebook.tsx` if-delete branch; `Annotator.tsx` toggle-off 1169 + clear-all 1614; `annotatorUtil.ts` placeholder 291). Dropping `OR deleted_at>since` = deleted highlights resurrect on peers.

**Perf win (2026-07):** the `(updated_at>since OR deleted_at>since)` OR defeats the `(user_id, updated_at)` index range scan — the planner can't use `updated_at>since` as a bound, so it walks the user's whole history + filter. For `stat_pages` (one row per page-turn, NOT book-scoped) this was the #1 query at 43% of DB time. Fix: drop the redundant OR → `.gt('updated_at', sinceIso)`. Reliable where an added index isn't (avoids the ORDER BY+LIMIT planner trap). `book_notes` has the same shape but is per-book scoped (`book_hash`/`meta_hash`), so cheap (31ms, #3 by call volume); leave its OR alone. If ever optimizing notes: index `(user_id, meta_hash) WHERE meta_hash IS NOT NULL` (meta_hash is unindexed; PK is `(user_id, book_hash, id)`).
