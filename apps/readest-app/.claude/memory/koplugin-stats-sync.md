---
name: koplugin-stats-sync
description: KOReader readest.koplugin reading-stats sync (push on close / pull on open); 3-bug chain fixed in PR
metadata: 
  node_type: memory
  type: project
  originSessionId: 9b3eaf27-8688-4293-ab42-f635af2e1905
---

`readest.koplugin` reading-statistics sync (KOReader `statistics.sqlite3` page events) — fixed in PR #4666 (`readest_syncstats.lua`, `main.lua`, `readest-sync-api.json`).

**Trigger model (fully automatic, no menu/gesture):**
- **Pull** on book OPEN: `onReaderReady` → `pullBookStats(false)` (via `nextTick`).
- **Push** on book CLOSE: `onCloseDocument` → `pushBookStats(false)` (wrapped in `goOnlineToRun`).
- Both gated on `self.settings.auto_sync and self.settings.access_token`, `interactive=false` (silent on failure).
- NOT per-book: `collectSince` queries the whole `statistics.sqlite3` (`page_stat_data JOIN book`, no book filter). Open/close is just the trigger; it syncs the entire stats delta. Incremental via `stats_push_cursor` (max `start_time`) / `stats_pull_cursor` (max `updated_at_ms`); cursor advances only on full success.

**3 stacked bugs (each hid the next):**
1. `push`/`pull` called `settings:readSetting/saveSetting` on `self.settings`, which is the PLAIN `readest_sync` data table (from `G_reader_settings:readSetting("readest_sync", default)`), NOT a `LuaSettings` object → `attempt to call method 'readSetting' (a nil value)` on every open. Fix: field access + persist via `G_reader_settings:saveSetting("readest_sync", settings)` (mirrors `readest_syncauth.lua`). Field-access pattern is used everywhere else (`self.settings.access_token`, etc.).
2. `pushChanges` requires `books/notes/configs` (`required_params`); stats sent only `statBooks/statPages` → Spore `books is required`. Fix: send empty `books={},notes={},configs={}` alongside. Server (`src/pages/api/sync.ts`) defaults each to `[]` and processes `statBooks`/`statPages` independently (gated only on their own `.length`).
3. `statBooks/statPages` were in the spec's `payload` but not `optional_params` → Spore `statBooks is not expected`. **Spore's expected-param set = `required_params ∪ optional_params`; `payload` only controls body serialization, NOT acceptance** (`common/Spore/Request.lua` `validate()`). Fix: add `optional_params:["statBooks","statPages"]` to `readest-sync-api.json`. Must be optional not required (library/config/annotation pushes legitimately omit them).

**Spore client:** `readest_syncclient.lua` `_dispatch` runs the RPC in a coroutine with Turbo `AsyncHTTP` (network is non-blocking, yields to event loop); `Format.JSON` encodes the body synchronously first. `SYNC_TIMEOUTS={5,10}` (block/total).

**Large-backlog blocking risk (UNFIXED, potential follow-up):** push sends the WHOLE backlog in one request (no client chunking; only pull is paginated). For ~10k `page_stat_data` rows: `collectSince` builds a 10k-entry Lua table + ~1MB JSON encode SYNCHRONOUSLY on the main thread → ~1-2s UI stall on weak e-ink CPUs at book close (network part is async, doesn't freeze). Worse: 10s timeout + no chunking + all-or-nothing cursor → if it can't finish in time it fails silently, cursor stays 0, and every later close re-collects/re-encodes/re-uploads the same backlog (server upserts are idempotent but wasteful). Fix idea: chunk push (~500-1000/req, matching server `BATCH=500`), advance cursor per successful chunk.

**Testing gap that hid it:** `spec/syncstats_spec.lua` originally tested only `collectSince`/`applyRemote`, never `push`/`pull`. Added tests: cursor advance on success (mock client enforces `required_params`), pull cursor from newest `updated_at_ms`, and a spec-level check parsing `readest-sync-api.json` to assert every stats-push key is an expected param (reproduces bug 3). Busted runs with `cwd=KOPLUGIN_DIR` so `io.open("readest-sync-api.json")` works; `require("json")`→dkjson via spec_helper shim. Debug logging kept (`ReadestStats` prefix). Related: [[koplugin-note-deletion-sync]], [[kosync-cfi-spine-resolution]].
