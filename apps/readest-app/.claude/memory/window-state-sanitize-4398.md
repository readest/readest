---
name: window-state-sanitize-4398
description: Windows launch crash (WebView2 0x80070057) from invalid .window-state.json; defensive sanitizer plugin
metadata: 
  node_type: memory
  type: project
  originSessionId: 40a168fd-c90e-4f00-9fbc-7effe7c0c45f
---

Issue #4398 (PR #4401) — Windows app fails to launch ("WebView2 error 0x80070057 / The parameter is incorrect") when `%APPDATA%\com.bilingify.readest\.window-state.json` holds the minimized sentinel (`x/y = -32000`) or `0×0` size.

Non-obvious facts:
- Our `tauri-plugin-window-state` (2.4.1, and every shipped 2.2.1+) ALREADY contains the upstream fix for [tauri-apps/plugins-workspace#253](https://github.com/tauri-apps/plugins-workspace/issues/253): `update_state` + the Moved/Resized handlers skip saving while `is_minimized()`, and restore only re-applies position if it `intersects()` a monitor. So current builds shouldn't generate bad state — a bad file is almost certainly stale from an old build. The version-inquiry comment is on the issue.
- Fix = **defense-in-depth**, NOT a behavior change: `src-tauri/src/window_state.rs` — a tiny `window-state-sanitizer` Tauri plugin whose `setup` strips window entries with invalid geometry (`width<=0 || height<=0 || x<=-30000 || y<=-30000`) from the file before window-state reads it. Pure `sanitize_json(&str)->Option<String>` is unit-tested (`cargo test -p Readest window_state`).
- **Plugin init order matters**: Tauri's `PluginStore::initialize_all` iterates the store in registration order (Vec push), and window-state loads the file in its `setup` (runs during `initialize`). So the sanitizer plugin MUST be registered BEFORE `tauri_plugin_window_state` in `lib.rs` (it is). The app-level `.setup()` closure runs AFTER all plugin setups → too late to sanitize there.
- Coord threshold is `-16000` (sentinel is exactly `-32000`; ~halfway). Real desktops sit a few thousand px off origin (4K-left = `-3840`, 3×4K ≈ `-11520`), so `-16000` is well past normal use yet clearly the sentinel zone; a legit negative like `-1920` is kept. Do NOT justify by extreme N-monitor walls (user pushed back on that). The size check (`<=0`) is the real WebView2-crash guard; this coord check is secondary (the plugin already refuses to restore an off-screen position via its `intersects()` monitor check). Missing fields default to valid so a schema change never drops a good entry.

Repo Rust testing reality: zero pre-existing `#[cfg(test)]` modules; CI only runs `cargo fmt --check` + `cargo clippy -p Readest --no-deps -D warnings` (NOT `--all-targets`, so it won't compile test code). `generate_context!` tolerates a missing `frontendDist` (`../out`), so `cargo test`/clippy build without a frontend build. See [[tauri-parser-parity-tests]].
