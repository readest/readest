---
name: ""
metadata: 
  node_type: memory
  originSessionId: e1238bc7-0b80-4036-b949-f9a2cf0045bc
---

Sentry READEST-1 (Android, `tauri.localhost/reader`): unhandled promise rejection `Non-Error promise rejection captured with value: concurrent use forbidden`.

**Root cause.** `TursoError::Misuse("concurrent use forbidden")` comes from `turso_sdk_kit-0.6.x`'s per-**connection** `ConcurrentGuard` (an `AtomicU32` `compare_exchange(0,1)` in `try_use`, acquired inside every synchronous `step()`/`execute()` poll). turso forbids concurrent use of a single `Connection`. The local plugin `src-tauri/plugins/tauri-plugin-turso` (`wrapper.rs::DbConnection`) holds ONE `turso::Connection` per DB path in `DbInstances` (`Arc<Mutex<HashMap<path, Arc<DbConnection>>>>`). Each `#[command] async fn` (`execute`/`select`/`batch` in `commands.rs`) locks the HashMap only to clone the `Arc<DbConnection>` out, RELEASES it, then `await`s `conn.execute/query` with NO serialization. Tauri dispatches commands on its multi-threaded async runtime, so two overlapping IPC calls for the same path (from `Promise.all`, or independent reader flows — progress save + stats write + annotation query) drive the same connection; whichever hits `step()` on the 2nd thread while the 1st holds the guard gets rejected. The guard is per-*synchronous-step* (released between async IO polls), so the collision is timing-dependent (needs true parallelism), which is why it was rare (2 events/1 user).

**Fix (PR-pending).** Serialize per-connection ops at the layer that owns the connection: added `op_lock: futures::lock::Mutex<()>` to `DbConnection`; `execute`/`select`/`batch` each `let _op = self.op_lock.lock().await;` first. This is the single choke point for ALL same-path callers (nativeDatabaseService, drizzle proxy, migrate.ts, statisticsDb/ReedyDb) regardless of JS entry point — a JS-only queue in `NativeDatabaseService` wouldn't cover the others or multiple service instances sharing one Rust connection. Bonus: holding the lock across the whole `batch` keeps BEGIN/COMMIT atomic vs interleaved writes, and pins `last_insert_rowid()` to the `execute` that produced it. `batch` calls `self.conn.execute` (not `self.execute`) so no re-entrant deadlock.

**Test.** `wrapper.rs` `#[cfg(test)] mod tests::concurrent_ops_on_one_connection_do_not_collide` — `#[tokio::test(flavor="multi_thread", worker_threads=8)]`, opens `:memory:`, fans out 64 concurrent INSERTs + 64 SELECTs on one `Arc<DbConnection>`. Deterministically fails pre-fix with `Turso(Misuse("concurrent use forbidden"))` (~0.02s), passes post-fix (5/5 stable). Needed `[dev-dependencies] tokio = { features = ["macros","rt-multi-thread"] }` (runtime tokio features lacked `macros`).

**Gotchas.**
- `DbConnection` is module-private (`mod wrapper` not `pub`), so the test must live INSIDE `wrapper.rs`, not `tests/`.
- Plugin tests are NOT in the repo gate: `pnpm test:rust`/`fmt:check`/`clippy:check` are all `-p Readest` only. Run plugin checks explicitly: `cargo test/clippy --manifest-path src-tauri/plugins/tauri-plugin-turso/Cargo.toml` (clippy needs `--no-deps` — the vendored `tauri-runtime-wry` fork emits warnings that `-D warnings` would otherwise promote to errors). Shared cargo target is `/Users/chrox/dev/readest/target`, not `src-tauri/target`.
- Pre-existing fmt debt in the plugin: `cargo fmt --check` flags `decode.rs` import ordering (unrelated; left untouched).

See [[sentry-crash-reporting-4914.md]] (this is the first real issue it caught) and [[bug-patterns]].
