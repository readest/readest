---
name: ios-sync-command-run-mobile-plugin-deadlock
description: "iOS 0x8BADF00D watchdog kill on every in-app-browser download: a synchronous #[tauri::command] calling run_mobile_plugin parks the MAIN thread; rule + guard test"
metadata:
  type: project
---

**MERGED #5947 (squash 8d24f5925, 2026-08-29), branch cleaned up.** Reporter verify pending;
the fix is UNRELEASED (0.12.6 predates it), so shipped iOS builds still deadlock.

**Rule: on iOS a `#[tauri::command]` that reaches `native_bridge()` (or any
`run_mobile_plugin`) MUST be `async fn`.** Breaking it is a hard deadlock, not a slowdown.

Why: `invoke()` on iOS is a `fetch("ipc://…")` (`ipc-protocol.js` — `canUseCustomProtocol =
osName !== 'android'`), WKWebView runs `webView:startURLSchemeTask:` on the **main thread**,
and a non-`async` command compiles to `ExecutionContext::Blocking`, whose body runs *inline*
there (`tauri-macros/command/wrapper.rs` `body_blocking`; `ipc/protocol.rs` calls
`webview.on_message` inline). `run_mobile_plugin` then does `rx.recv()` on an std channel,
while the Swift handler replies from `DispatchQueue.main.async` -> the block can never run ->
watchdog SIGKILL at 10s. Tauri's `ipcDispatchQueue` is *serial*, so every later plugin call
wedges behind it too.

**Reading the crash:** `_dispatch_semaphore_wait_slow` under app frames is **Rust, not Swift** —
there is no `DispatchSemaphore` anywhere in this repo; Rust `std`'s thread parker on Apple
targets is built on libdispatch semaphores (`std/src/sys/sync/thread_parking/darwin.rs`), so
that frame means `thread::park()` / a blocking `recv()`. The `sentry-transport` thread is the
sentry-**rust** transport (not sentry-cocoa) parked through the same frame — a useful landmark.

**Instance (2026-08-29, .ips from an iPhone on 0.12.6, iOS 18.7.10):** mobile
`set_web_browser_status` in `src-tauri/src/web_browser.rs` was the app's only sync command
touching the bridge, so EVERY finished in-app-browser download killed the app
(`useWebBrowserDownloads.ts` calls it on all three outcomes). Fix = `pub async fn` + move
Swift's `invoke.resolve()` outside the `DispatchQueue.main.async` hop in
`NativeBridgePlugin.swift` (Kotlin already resolved outside `runOnUiThread`). Guard test
`commands_reaching_the_native_bridge_are_async` in `web_browser.rs` scans `src/**/*.rs` —
a *source* scan because `pnpm test:rust` builds for the host where `#[cfg(mobile)]` code is
never compiled, so nothing type-level could see it.

**VERIFIED on the iOS 18.5 simulator (iPhone 16, release build w/ --features devtools):** added
`https://www.gutenberg.org/ebooks/1342.epub.noimages` as a web source, opened it -> banner went
Downloading -> "Added to library · pg1342.epub", [Open] dismissed into the library with the book
imported, and `launchctl list` showed the SAME pid throughout (no watchdog kill, no crash report).

**Build-env trap hit on the way:** `target/aarch64-apple-ios*` was full of swift-rs `ModuleCache`
PCHs whose absolute paths pointed at the `readest-feat-localsend` / `readest-feat-in-app-browser-5775`
worktrees, so EVERY iOS build died with `missing required module 'SwiftShims'` /
`Failed to compile swift package <X>`. Fix: `find target/aarch64-apple-ios* -type d -name ModuleCache
-prune -exec rm -rf {} +` plus `cargo clean -p <pkg> --target aarch64-apple-ios-sim --release` for the
14 swift-rs packages (tauri, tauri-plugin-{biometric,clipboard-manager,device-info,dialog,haptics,log,
native-bridge,native-tts,opener,sharekit,shell,sign-in-with-apple,turso}). Also: the plugin's Swift is
built by XCODE, not cargo, so `cargo check --target aarch64-apple-ios` does NOT type-check it — use
`swift build --sdk "$(xcrun --sdk iphoneos --show-sdk-path)" --triple arm64-apple-ios15.0` in the
plugin's `ios/` dir. And in Simulator.app `cmd+left/right` ROTATES the device — never use it to move a
text caret; set text with `xcrun simctl pbcopy <udid>` + cmd+v instead (host typing triggers the
press-and-hold accent popup).

~30 `DispatchQueue.main.async { … invoke.resolve() }` sites remain in
`NativeBridgePlugin.swift` / `NativeTTSPlugin.swift`; they are safe only because every one of
their Rust commands is `async`. The guard test is what keeps that true.

`range_file.rs` documents the same main-thread hazard for custom URI schemes and dodges it with
`spawn_blocking`.

Related: [[in-app-browser-book-source-5775]], [[platform-compat-fixes]].
