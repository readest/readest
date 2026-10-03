---
name: ios-system-brightness-sync-6374
description: "#6374 iOS swipe brightness in System Screen Brightness mode snapped back on Control Center/Home and next swipe jumped; MERGED #6502 (4eb7b6d7c)"
metadata:
  node_type: memory
  type: project
  originSessionId: 8fe0aa53-2980-434d-9b72-7d9ad4e92ee8
  modified: 2026-09-30T12:03:35.709Z
---

#6374 (2026-09-30): with System Screen Brightness on, iOS swipe/slider was a temporary override restored on willResignActive (#4885 hand-back); next swipe started from stale `lastScreenBrightness` because Control Center only resigns active and never fires `visibilitychange`.

Fix (MERGED #6502 as 4eb7b6d7c; worktree + branch removed): `set_screen_brightness` gained `persist` flag (system mode = write-through, no capture); gesture re-reads device brightness on touchstart in system mode; manual mode re-applied natively in appDidBecomeActive. Android ignores `persist`. chrox approved the design choice that system-mode swipes change the real iOS brightness.

**Why:** simulator doesn't emulate brightness; NOT device-verified.
**How to apply:** verify on a real iPad/iPhone before calling it done. Swift plugin compile-check recipe: symlink main checkout's `plugins/tauri-plugin-native-bridge/.tauri` into the worktree, then `xcodebuild -scheme tauri-plugin-native-bridge -destination 'generic/platform=iOS Simulator' build` in `ios/`.
