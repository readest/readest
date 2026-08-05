---
name: native-db-close-all-not-loaded
description: "iOS/native \"[stats] ... database sqlite:<path> not loaded\" — NativeDatabaseService.close() closes ALL turso connections app-wide, killing statistics.db forever"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6829a052-2c04-4e73-8871-54e0c6a53ee7
  modified: 2026-08-04T16:39:24.294Z
---

**Symptom (seen 2026-08-05, `pnpm dev-ios` on device):** every stats op logs `[stats] failed to persist reading events / TTS listening events / median page duration failed: "database sqlite:/private/var/.../Library/Application Support/.../statistics.db not loaded"` repeatedly for the rest of the session. Same class of error as Sentry READEST-6 (was attributed to app-teardown races — many events are probably really this).

**Status:** MERGED #5497 (2026-08-05); iOS device re-verify pending: `this.db.close(this.db.path)` + tauri integration test `src/__tests__/database/native-close-isolation.tauri.test.ts` (verified RED then GREEN over real IPC). Note: the tauri lane's vitest browser session times out if the unit suite runs concurrently; run `pnpm test:tauri` alone. Test sandbox paths must live under `**/.readest-test-sandbox-tauri/**` (fs scope in `src-tauri/capabilities-extra/webdriver.json`).

**Root cause:** `NativeDatabaseService.close()` (`src/services/database/nativeDatabaseService.ts:52`) calls guest-js `Database.close()` with **no argument**. guest-js `close(db?: string)` forwards `db: undefined` → Rust `plugin:turso|close` with `db: None` → `instances.drain()` closes **every** turso connection in the app (`src-tauri/plugins/tauri-plugin-turso/src/commands.rs:112`). So any service closing "its own" DB nukes statistics.db, opds.db, reedy.db, search.db, tts cache.db too. Footgun inherited from tauri-plugin-sql's close(db?) API shape.

**Triggers in prod:** TTS `bookCacheStore.close()` at client shutdown; `librarySearchService` LRU eviction + `librarySearchIndex` background index completion (`indexDb.close()`); OPDS `sourceMap.ts` open→op→close on EVERY call; reedy `instrumentation.ts` close.

**Why it never recovers:** `StatisticsDb.open` memoises `sharedDb` on success and only resets on open-FAILURE; JS `Database` objects and the drizzle proxy `loaded` flag never re-invoke `load`. Dead until webview reload. Web unaffected (`webDatabaseService.close()` closes only its own WASM connection).

**Fix direction:** `this.db.close(this.db.path)` in NativeDatabaseService (one line); better: make guest-js `Database.close()` default to `this.path` (arg-less close-all is the API bug). Optionally self-heal on `DatabaseNotLoaded` by re-loading. See [[turso-concurrent-use-forbidden]] for the plugin's other connection-sharing hazard; plugin tests are NOT in the repo gate (run `cargo test --manifest-path src-tauri/plugins/tauri-plugin-turso/Cargo.toml`).
