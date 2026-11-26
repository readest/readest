---
name: sync-books-push-body-limit-7814
description: "#7814 \"Body exceeded 1mb limit\" / \"Unexpected token 'B'\" in sync history = books push over the Pages API 1 MB bodyParser; bulk-imported ~800+ book library; MERGED #7815: 8 MB server limit + client batches of 100; retry gap #7824"
metadata:
  type: project
---

`Unexpected token 'B', "Body excee"... is not valid JSON` under "Books uploaded" in
sync history is Next's Pages Router `bodyParser` default (`'1mb'`) rejecting
`POST /api/sync` with a plain-text 413 that `SyncClient` then `res.json()`s. Pull
paging (`BOOKS_PULL_PAGE_SIZE`, after Worker error 1102) never had a push counterpart.

- A pushed Book (client shape, metadata object included) is ~1.3 KB median for
  Cyrillic FB2, ~5 KB max, so ~800 books in one push break 1 MiB.
- Why it repeats: `useSync` starts `lastSyncedAtBooks` one day back on every load,
  so for 24 h after a bulk import each session's first sync re-sends the whole
  library. Books without `syncedAt` (only set when a pull returns their row) are
  always re-sent.
- Uploaded files still land in storage + Manage Storage, so the report reads as
  "storage used but books missing on other devices".
- MERGED #7815 (623df7bd8, 2026-11-23): `/api/sync` `bodyParser.sizeLimit: '8mb'` (owner wanted old clients
  fixed without upgrading; ~4x body in heap, 8 MB ≈ 32 MB) + `SyncClient.pushChanges`
  batches books 100/request and returns all batches' rows as one result.
- A cursor cap after failed pushes was tried and dropped: CodeRabbit found gap after
  gap (pull-only, restart, overlap, in-flight pull). Root cause is the cursor doubling
  as the push filter → #7824 (needs a persisted per-book marker; `syncedAt` can't,
  updateLibrary stamps it on pulled rows even when local is newer).
- Not fixed: `res.json()` on non-JSON errors in `libs/sync.ts`; notes push is still
  one request per book.
- Repro without writing data: POST the payload unauthenticated to `next dev`
  `/api/sync`; 413 = parser rejected, 403 = reached the handler.
- Live on web.readest.com 2026-11-23: unauthenticated synthetic push 1.5 MiB -> 403,
  8.1 MiB -> 413 "Body exceeded 8mb limit". Reporter emailed the same day (sync on the PC
  that added the books, no app update needed). Owner confirmed fixed 2026-11-23; thread archived.
- Reporter-account numbers live in ~/Documents/books/issues/7814/README.md (local).

Related: [[pagebound-sync-6511]] [[books-sync-inflight-change-dropped]]
