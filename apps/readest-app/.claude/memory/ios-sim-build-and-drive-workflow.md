---
name: ios-sim-build-and-drive-workflow
description: "Working recipe for building/installing/driving Readest on the iOS simulator without tauri ios dev - xcarchive gotcha, UIFileSharingEnabled plist patch, computer-use click technique"
metadata: 
  node_type: memory
  type: project
  originSessionId: c9c46722-9268-4656-ab01-f08e56c55d1c
  modified: 2026-08-12T05:50:15.072Z
---

Verified working 2026-07-26 (iPhone 17 Pro, iOS 26.3). Avoids `tauri ios dev`, so it does **not** conflict with an already-running `pnpm dev` on port 3000 (see [[ios-sim-drive-via-dev-server-relay]] for that failure mode).

```bash
xcrun simctl boot <UDID>; open -a Simulator
pnpm build                     # static export; do NOT let beforeBuildCommand run
pnpm tauri ios build --debug --target aarch64-sim \
  --config '{"build":{"beforeBuildCommand":""}}'   # skips `pnpm upload-sourcemaps`
```

**Gotcha that cost a full cycle:** the CLI ends with `failed to rename app ... Directory not empty (os error 66)` and exits non-zero, leaving `build/arm64-sim/Readest.app` **stale**. The fresh bundle is at `build/Readest_iOS.xcarchive/Products/Applications/Readest.app`. Always check the binary mtime before installing.

**Root cause (traced 2026-08-09, tauri-cli 2.11.4):** `mobile/ios/build.rs` does `create_dir_all(out_dir)` then `fs::rename(xcarchive/Products/Applications/Readest.app -> build/arm64-sim/Readest.app)` with **no cleanup of the destination**. POSIX `rename` returns `ENOTEMPTY` (66) when the destination is a non-empty *directory*, so a sim build succeeds exactly once and fails on every rebuild after. `dev-ios` (device) is immune only because `Readest.ipa` is a regular *file* and rename silently replaces files.

So the earlier advice to `rm -rf` the **xcarchive** was wrong-target — the xcarchive is the source and is fine. Delete the **destination**. `dev-ios-sim` in `package.json` now prefixes `rm -rf src-tauri/gen/apple/build/arm64-sim/Readest.app &&`. If it ever recurs on another target, delete that target's stale output bundle, not the archive. Recovery without a 10-min rebuild: the failed run already archived the app, so just remove the destination and `mv` the xcarchive bundle into place (`vtool -show-build-version` should say `IOSSIMULATOR`).

- App container Documents is not visible in Files by default (`UIFileSharingEnabled` unset). Patch the built bundle, not the repo: `plutil -replace UIFileSharingEnabled -bool true "$APP/Info.plist"` before `simctl install`. Data container survives reinstall, so pushed fixtures persist.
- `xcrun simctl addmedia booted foo.heic` seeds Photos for PHPicker tests.
- `simctl launch`/`listapps` can hang if the sim wedges (clock frozen is the tell): `pkill -f "simctl launch"; xcrun simctl shutdown all; killall Simulator`, then reboot.

**Driving:** `simctl` has no tap. computer-use on Simulator works (native app = full tier), but a plain `left_click` is often swallowed - use `mouse_move` + `left_mouse_down` + `wait 0.15` + `left_mouse_up`. If computer-use is locked by another session there is NO headless fallback (2026-08-12): Simulator.app can run with ZERO windows (System Events sees none, Window-menu click doesn't materialize one) while `simctl io booted screenshot` still captures the framebuffer fine; System Events does NOT expose the iOS AX tree; `brew install idb-companion` refuses without Command Line Tools. `simctl openurl` works headless (custom schemes hit a SpringBoard "Open in ...?" alert that needs one tap); serving a test page from the host and opening it in sim Safari via `openurl http://127.0.0.1:PORT/` renders fine even windowless — good for pure-WebKit rendering experiments. Wheel `scroll` does nothing inside the webview; use `left_click_drag` to scroll modals. Console: Safari Web Inspector (ios_webkit_debug_proxy still does not attach).

Android equivalent for the same task is far easier - real CDP over `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`, then `Runtime.evaluate` for DOM rects. Convert CSS px to device px with `* devicePixelRatio` (2.75 on Xiaomi 13) and drive with `adb shell input tap`; do NOT eyeball coordinates off screenshots. CDP `Input.dispatchTouchEvent` does **not** trigger the app's long-press, so use `adb shell input swipe x y x y 800`.
