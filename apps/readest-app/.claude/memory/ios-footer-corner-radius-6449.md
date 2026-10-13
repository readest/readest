---
name: ios-footer-corner-radius-6449
description: "#6449 iPhone footer clipped by rounded corners; #6429 corner clearance only had an Android radius source; iOS 26 public-API radius probe; sim WebView inspector recipe (no computer-use needed)"
metadata:
  node_type: memory
  type: project
  originSessionId: 85759705-d3a5-4146-bc4d-b6fe417b5612
  modified: 2026-09-29T15:05:57.332Z
---

**#6449 (2026-09-29):** footer ends clipped by iPhone display corners. #6429 (ff6ef5430) added
`getCornerClearance` + `bottomCornerRadius` in `get_safe_area_insets`, but only Kotlin reported it;
Swift never did, so `screenCornerRadius` stayed 0 on iOS. Fix = Swift-only, commit 4575f988e on branch
`fix/ios-footer-corner-radius` (worktree readest-fix-ios-footer-corner-radius), MERGED #6474 (37edd27c5) 2026-09-29, UNRELEASED; no review comments. Worktree + branch removed, ios-sim release ModuleCache cleared after.

- iOS 26 public API: `window.effectiveRadius(corner:)` = 0, but a window-sized CHILD with
  `cornerConfiguration = .corners(radius: .containerConcentric())` returns the display radius
  (62 on iPhone 17 Pro, same as private `_displayCornerRadius`). Pre-26: no public API, left at 0.
- Default margins (44px, gap 5%) already clear the arc (18px pad); the clearance binds only on tight
  layouts (16px margin + 0% gap -> 27.7px pad). VERIFIED on iOS 26.3 sim with a masked screenshot, A/B on ONE build: forcing radius 0 -> 8px pad, '9'/'3' clipped by the corners (the reported bug); real radius -> 27.7px, fully visible.

**Sim WebView inspector recipe (when computer-use isn't granted):**
`lsof -aUc launchd_sim | grep webinspectord_sim.socket` -> `ios_webkit_debug_proxy -s unix:<sock> -c null:9221,:9222-9322`;
connect ws `/devtools/page/N` (N changes per launch), pick the `Target.targetCreated` with type `page`
(NOT the frame), wrap calls in `Target.sendMessageToTarget`; `awaitPromise` is IGNORED -> stash
promise results on `window` and read back. `__TAURI_INTERNALS__.invoke` is NON-WRITABLE; to fake a native response, wrap `window.fetch` (iOS IPC = fetch ipc://) and dispatch `focus` to make useSafeAreaInsets re-query. Library cover tap needs pointerdown+pointerup+click (useLongPress).
Settings live in the sim data container `Library/Application Support/com.bilingify.readest/settings.json`
(edit with the app terminated). `xcrun simctl io booted screenshot --mask=black` shows the real corners.

**Traps:** `until ! pgrep -f "<pattern>"` never exits because pgrep matches the waiting shell's own
command line. Build failing with `Bundle has no member 'main'` in untouched plugins = poisoned swift-rs
ModuleCache, see [[swift-rs-module-cache-shared-target-worktrees]].
