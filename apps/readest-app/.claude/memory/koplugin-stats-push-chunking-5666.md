---
name: koplugin-stats-push-chunking-5666
description: "#5666 'Push stats now' wedged forever — koplugin pushed the whole stats backlog in ONE request under a 10s socket timeout; fixed with per-chunk cursor advance"
metadata: 
  node_type: memory
  type: project
  originSessionId: 68563545-16fe-4464-94a7-87e1c49b29e0
  modified: 2026-08-13T06:01:18.537Z
---

Issue #5666 (2026-08-13): "Failed to push reading statistics" on every "Push stats now" tap, Kindle + Kobo, started after the user upgraded Readest storage. MERGED PR #5670 (b25a2a88c, 2026-08-13); worktree + branches cleaned up. Reporter-device verify pending after the next koplugin release.

**Root cause:** `SyncStats:push` sent the ENTIRE backlog since `stats_push_cursor` in one `/api/sync` POST. `readest_syncclient.lua` sets `socketutil:set_timeout(5, 10)` — 10s TOTAL. After the storage upgrade the user pulled the full multi-device history (koplugin stats pull is deliberately unpaginated, sync.ts ~line 441), so a fresh/behind push cursor collected tens of thousands of page events; the server alone processes stat_pages in sequential 500-row select+upsert batches, so the request can never finish in 10s. Cursor only advanced on success → every retry re-sent the same payload → wedged forever. The app already had the fix pattern in `src/services/statistics/statsSync.ts` (PUSH_CHUNK=500, cursor per chunk); the koplugin never got it.

**Why:** any unbounded single-request sync + success-only cursor + hard timeout = permanently wedged once the backlog crosses the timeout threshold. The failure is silent-looking (generic toast); logger.dbg lines don't appear in user crash.logs.

**How to apply:** chunk to 500 page events per request, never split a shared start_time across chunks (cursor would drop same-second events on resume), advance + save `stats_push_cursor` after EACH successful chunk, chain chunks via `UIManager:nextTick` — chaining inside the callback nests a coroutine.resume per chunk on the synchronous (non-Turbo) HTTP path and can blow the C stack at ~200 chunks.

Gotchas learned:
- Crash.log red herring: `WebDavApi 404` + `statistics open income DB failed ... notadb` via `cloudstorage.koplugin` = KOReader's OWN stats cloud sync (user also has it configured), nothing to do with the Readest plugin.
- Spec preload race: `syncannotations_spec.lua` registers a private `package.preload["ui/uimanager"]` (show = no-op) that wins `package.loaded` in full-suite busted runs. Never assert toasts via `koreader_stubs.UIManager._shown` in syncstats specs — patch `show`/`InfoMessage.new` on the `require()`d instance and restore (existing toast test's pattern). syncstats_spec now uses shared [[koreader_stubs]] preloads (its private ones were dead code).
- Koplugin stats pull remains unpaginated by design; pull works because the pull cursor advances on success and the server assembles one response.

Related: [[koplugin-metahash-parity]], [[kosync-conflict-reprompt-5527]]
