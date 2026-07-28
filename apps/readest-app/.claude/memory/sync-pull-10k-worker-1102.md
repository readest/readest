---
name: sync-pull-10k-worker-1102
description: "10k-book library broke GET /api/sync full pull with CF Worker error 1102 (calibre plugin + app devices wedged); MERGED #5364 = paged books pull with synced_at ASC + tie-completion"
metadata: 
  node_type: memory
  type: project
  originSessionId: 200e29f2-dff3-41fb-9720-f05fef01e806
  modified: 2026-07-27T15:12:44.091Z
---

**User report 2026-07-27**: 10k-book calibre library pushed via the 0.11.20 plugin; a later single-book push failed with CF **error 1102 "Worker exceeded resource limits"**, and devices stopped pulling (mac stuck ~4k, phone ~800) while Manage Storage showed everything uploaded. **FIXED — MERGED #5364** (squash commit 78bb5df6f, 2026-07-27).

**Root cause**: `GET /api/sync?type=books&since=…` (`src/pages/api/sync.ts`) accumulated the ENTIRE delta in memory — paged Supabase at 1000/req but concatenated all rows, then `NextResponse.json` + the pages/api wrapper buffered the serialized body twice more (arrayBuffer → Buffer). Fanfic rows carry KBs of `metadata` (comments/tags/custom columns) → 10k rows = tens of MB × several copies → 128 MB Worker memory (or CPU; no `[limits]` in wrangler.toml). Books had NO `limit` support — only `type=stats` had the paged pattern.

- Plugin: `worker.py::_load_cloud_state` starts every push/status run with `pull_books()` = full pull since=0 (stateless by design) → the OP's exact error prefix "Could not reach Readest:". #5325/#5332 fixed storage listing/blob-verify, NOT this.
- App: `useSync.ts` pulls `since = lastSyncedAtBooks+1` (−1 day on init; **since=0 if >3 days idle**). Bulk import bumps `synced_at` on all rows → delta = whole library → 1102 → cursor never advances → devices wedge permanently.

**The fix (#5364)**:
1. Server: `type=books&limit=N` (gated on explicit `typeParam === 'books'`) returns one page ordered `synced_at` **ASC** with **tie-completion** — batch upserts stamp one `now()` per 100-row statement, so many rows share a millisecond; a strict `>` cursor would skip the rest of a batch at a page boundary (same trick as stats `fetchPagedPages`). No-limit default response unchanged for old clients (capping it was deliberately rejected: old plugins would mis-plan unpulled books as 'new'; koplugin cursor semantics under a capped default unverified). `statsLimit` renamed `limit`, shared by stats + books.
2. Plugin `api.py::pull_books`: walks pages advancing `since` to max synced_at ms; dedupes ms-truncated boundary re-reads via last-wins dict; terminates on short page OR non-advancing cursor (µs-tail guard — >1000 rows inside one ms would otherwise loop). Legacy server ignoring `limit` costs one extra empty request.
3. App `pullBooksPaged` (exported from `useSync.ts`): same walk; persists `lastSyncedAtBooks` per page via the store (disk write stays in the `finally` saveSettings) so an interrupted initial sync resumes; **keeps the partial delta when a LATER page fails** — the persisted cursor has already advanced past those rows; discarding them would skip them forever — and rethrows only on first-page failure so auth handling still works.

Tests: `sync-books-paged-pull.test.ts` (thenable mock supabase builder with QUEUED per-query data — richer than the stats test's static mock; per-`from()` call chains distinguish page vs tie query), `useSync-paged-books-pull.test.ts`, plugin `test_client.py` paged-pull cases.

Residual gaps: old app installs stay wedged until a release ships the paged pull (server deploy alone doesn't help no-limit clients); configs/notes (heavy annotators) still full-delta — same wall eventually; legacy `queryTables` DESC+`range()` paging is unstable under concurrent writes (ASC cursor pages fixed this for books only). Scale facts: bulk storage listing at 10k books ≈ 21 pages × ~1s (fine, #5332).

Related: [[calibre-plugin-push-4863]], [[sync-synced-at-cursor-4678]], [[koplugin-library-stale-synced-cursor-4934]]
