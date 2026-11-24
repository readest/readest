---
name: dynamic-island-home-indicator-7471
description: "#7471 iPhone Dynamic Island blank in Readest: SpringBoard suppresses the island while the foreground app hides the status bar OR the home indicator; the cause was the readest/tauri fork hiding the home indicator in every window, not the Info.plist key. Headless island-state recipe."
metadata:
  node_type: memory
  type: project
  originSessionId: f044d97d-3a41-4747-a7a6-1c05ef7f2f6c
  modified: 2026-11-20T13:33:06.850Z
---

Reproduced 2026-11-20 on the iPhone 18 Pro sim (iOS 27.0) with the 0.12.20 build.

**Rule (SpringBoard, verified with a probe app):** the island hides other apps' Live Activities whenever the foreground scene has `statusBarHidden` OR `homeIndicatorAutoHidden`. Only both visible keeps the island. Re-evaluated at runtime when either changes.

**Readest cause:** the readest/tauri fork commit bfc0c89a2 ("enhance: auto hide home indicator on iOS", 2025-04-19, with #911) calls `window.set_prefers_home_indicator_hidden(true)` in `crates/tauri-runtime-wry/src/lib.rs`, so the scene reported `homeIndicatorAutoHidden = YES` on every page: island blank in the library and with Always Show Status Bar. The `UIHomeIndicatorAutoHidden` Info.plist key the reporter blamed is ignored (tao's TaoUIViewController answers `prefersHomeIndicatorAutoHidden` itself); removing it from the bundle changed nothing.

**Fix, MERGED #7717 (4de43e5fc, 2026-11-20; reviewed head 57feddcd3):** `set_system_ui_visibility` sets `setPrefersHomeIndicatorAutoHidden:` to `!visible` alongside the status bar; ignored plist key removed. The fork line stays, per the owner ([[feedback-leave-tauri-fork-unless-needed]]): it leaves the island blank ~0.8 s at cold launch until the first page call. Sim-verified: library, reader toolbar shown and Always Show Status Bar give NO (were YES); immersive reader stays YES, which is iOS behavior for any app hiding the status bar. Insets unchanged.

**Separate, unfixed:** every reader mount sends `set_system_ui_visibility` true, true, false (seen in native logs on 0.12.20 and the fix build), so Always Show Status Bar is lost after a cold launch or reload into the reader until the first tap. JS-side order is unknown: the WebKit `Page.setBootstrapScript` fetch wrapper did not capture iOS IPC.

**Sim build from a worktree, extra gotchas:** besides copying the ignored gen/apple files, create an empty `gen/apple/assets` dir, and remove `UIHomeIndicatorAutoHidden`-style stale keys from the copied `Readest_iOS/Info.plist` (direct xcodebuild skips the CLI's plist merge). The shared `target/` needed `rm -rf target/aarch64-apple-ios-sim/release/{build,.fingerprint}/tauri*` (SwiftShims pcm from another worktree path).

**Headless recipe (no computer use needed):**
- `simctl io screenshot` and Device Hub do NOT show the island. Read SpringBoard instead: `log show --predicate 'process == "SpringBoard" AND category == "SystemApertureViewController"'`, message "system chrome suppression YES/NO"; ZStack logs `suppressSystemApertureForSystemChromeSuppression`.
- Live Activity source: the sim has no Clock app. An xcodegen probe (app + widgetkit extension, `NSSupportsLiveActivities`, extension bundle id prefixed by the app's) starts one via `Activity.request` on launch.
- App scene state: `lldb --batch -p <pid> -o 'expr -l objc -O -- (id)[[[[[[UIApplication sharedApplication] connectedScenes] allObjects] firstObject] _FBSScene] clientSettings]'` shows `statusBarHidden`, `homeIndicatorAutoHidden`.
- Pitfall: the Bash tool runs zsh, which does not word-split `$args`; `launch ... $args` passed "-a -b" as one argument and produced a false "both hidden = not suppressed" result. Use `bash -c` or `${=args}`.

Related: [[ios-sim-webview-drive-via-iwdp]], [[ios-sim-build-without-matching-runtime]], [[ios-worktree-device-build-gotchas]].
