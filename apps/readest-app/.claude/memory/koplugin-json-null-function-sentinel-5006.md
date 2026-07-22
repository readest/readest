---
name: koplugin-json-null-function-sentinel-5006
description: "koplugin push crash \"type 'function' is not supported by JSON\" — LuaJSON null sentinel is a function; dkjson (Spore) rejects it"
metadata: 
  node_type: memory
  type: project
  originSessionId: deaa9622-cd2f-40d4-8b9e-8855cfbe8167
---

Issue #5006: koplugin auto-sync push crashes with
`ReadestSyncClient:pushChanges failure: common/Spore/Middleware/Format/JSON.lua:26: type 'function' is not supported by JSON.`
Every push of a changed book whose metadata had any `null` field failed.

**Root cause (non-obvious):**
- KOReader's `require("json")` is **LuaJSON** (harningt/luajson) at `common/json.lua`, NOT rapidjson (the spec_helper.lua:150 comment claiming rapidjson is WRONG — the `type 'function'` error proves LuaJSON, since rapidjson null is lightuserdata and dkjson null is a table).
- LuaJSON decodes JSON `null` to `json.util.null`, which is a **function**: `local function null() return null end`.
- `syncbooks.row_to_wire` decodes server `metadata_json` (which `librarystore` round-trips WITH nulls via LuaJSON encode) → parsed table holds the function sentinel.
- The `/sync` push payload is re-encoded by Spore's `Format.JSON` middleware, which uses **dkjson** (`require'dkjson'.encode`). dkjson raises `type '<t>' is not supported by JSON` for functions → whole pushChanges fails.

**Fix (MERGED #5186, both halves of #5006 in one PR):** `sanitize_json_nulls` in `syncbooks.lua` recursively converts function values → `require("dkjson").null` (dkjson's null has `__tojson` → re-encodes as JSON `null`, byte-faithful, zero metadata churn). Applied to decoded `out.metadata` and `out.progress` in `row_to_wire`. Exported as `M._sanitize_json_nulls`.

**Testing gotcha:** busted harness stubs `require("json")` → dkjson (spec_helper.lua:154), which drops null → nil, so the bug does NOT reproduce through the stub. The regression test in `syncbooks_spec.lua` stubs `package.loaded["json"]` with a LuaJSON-mimicking decoder (returns a function sentinel), then asserts the wire payload is `dkjson.encode`-able and null is preserved as `dkjson.null`.

Only the **books** push path decodes server JSON; notes (annotations) / configs (DocSettings) / statBooks/statPages come from KOReader Lua tables / SQLite rows, so no sentinel there.

#5006 SECOND HALF (UI-thread block on open/close), also MERGED #5186: sync HTTP is synchronous on the UI thread because the Turbo async path is DEAD — `DUSE_TURBO_LIB` defaults to false (koreader defaults.lua), so `UIManager.looper` is nil and Spore's AsyncHTTP middleware bails to blocking socket HTTP. KOReader's own KOSyncClient has the identical vestigial `if not UIManager.looper then return end`. Real background = subprocess fork (`Trapper:dismissableRunInSubprocess`/`ffiutil.runInSubProcess`) but it can't write the parent's ljsqlite3 store, so it's a poor fit for the pull. `NetworkMgr:goOnlineToRun(cb)` runs cb INLINE when already online → blocks close. Fix = mirror KOSync (tiny payload on hot path, defer rest): CLOSE path now `pushOpenBook` (targeted single-book push via `syncbooks.pushBook(touchOpenBook())`, no full library pull; touched row keeps cloud uploaded_at/metadata/group_id so no #4138 wipe); OPEN path (`onReaderReady`) pull is deferred via `scheduleIn(READER_READY_PULL_DELAY=1)` and stored as `reader_ready_pull_task`, cancelled in `onCloseWidget` so rapid book switching coalesces. Library-wide `"both"` reconciliation still runs on Library-widget open (`librarywidget.lua`). Specs: `main_close_spec.lua`, `main_open_spec.lua`. Related: [[koplugin-library-stale-synced-cursor-4934]], [[sync-deleted-at-cursor-invariant]].
