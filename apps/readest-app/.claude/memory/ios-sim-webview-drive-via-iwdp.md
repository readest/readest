---
name: ios-sim-webview-drive-via-iwdp
description: "Drive and time Readest inside the iOS Simulator without computer use - ios_webkit_debug_proxy + a WebKit-protocol script, simctl openurl imports a book, IPC is timed by wrapping window.fetch"
metadata:
  node_type: memory
  type: reference
  originSessionId: 91cc707d-2a99-4d44-a5e7-2f3dcc03470d
  modified: 2026-10-23T09:47:02.425Z
---

Worked 2026-10-23 measuring narration start on PR #7019 (iPhone 17 Pro sim, iOS 26.3, `pnpm dev-ios-sim` build, which has devtools):

- Inspector: `ios_webkit_debug_proxy -s unix:$(lsof -aUc launchd_sim | grep webinspectord_sim.socket | awk '{print $NF}') -F`; pages at `http://127.0.0.1:9222/json`. A second booted sim has its own socket: add `-c null:9321,:9322`.
- curl needs `--noproxy '*'` (the shell exports an HTTP proxy; without it localhost returns "Empty reply").
- WebKit `Runtime.evaluate` doesn't await promises: park the result on a window global and poll it. Messages go through `Target.sendMessageToTarget` once `Target.targetCreated` names the page.
- Import with no UI: copy the book into the app's data container (`xcrun simctl get_app_container booted com.bilingify.readest data`), then `xcrun simctl openurl booted file://<path>`. Readest imports it and opens the reader.
- Shortcuts dispatched as `window.dispatchEvent(new KeyboardEvent('keydown', {key:'t'}))`: `t` toggles Read Aloud, space play/pause, alt+ArrowDown next chapter.
- `__TAURI_INTERNALS__.invoke` is non-writable. On iOS IPC is `fetch('ipc://localhost/<cmd>')`, so wrap `window.fetch` to log commands and timings. Memory: `ps -o rss= -p` for the Readest pid and the `WebContent` pid.
- Backgrounding: `xcrun simctl launch booted com.apple.Preferences`. The sim doesn't suspend like a device, and it has no lock-screen controls from the CLI.

Build gotchas the same day: a bare `dotenv` resolves to a global CLI that only prints its version (use `pnpm exec dotenv`). The worktree's first sim and device builds both failed with phantom Swift errors until `target/<triple>/release/{build,.fingerprint}/tauri*` was cleared (see [[ios-worktree-device-build-gotchas]]).

Tapping by hand (2026-10-25, #7080): Xcode 27 has no Simulator.app; its GUI is `/Applications/Xcode.app/Contents/Applications/DeviceHub.app` ("Device Hub" for computer use). Zoom out once so the phone clears the Dock. The software keyboard shows on a real tap (JS `focus()` doesn't raise it). An invisible UserNotificationCenter window can block clicks near the top of the phone: reopen the book with `simctl openurl` instead of tapping a dialog's back button.

Related: [[ios-device-screenshot-and-install-recipe]].

iPhone Duo sim (2026-10-30, PR #7137, iOS 27.1): Device Hub's bottom bar has rotate plus three posture buttons (folded/cover, part way open, flat) — the sim DOES fold part way (`UIHinge` status `partial`, active 40pt `.division` region). Button icons swap with orientation; plain clicks there are sometimes swallowed, use mouse down/up. With `-s unix:<socket>`, `:9222/json` lists the pages directly. Tap the page centre to toggle the toolbars.
When Device Hub swallows every click (even the menu bar), a mouse button is stuck from an interrupted down/up: `left_mouse_up` + Escape fixes it. Page taps can be replaced by posting the reader's own message: `window.postMessage({type:'iframe-single-click', bookKey: <foliate-view id minus "foliate-view-">, screenX: innerWidth/2, ...}, '*')` toggles the toolbars. Verify "no layout shift" with a MutationObserver on `foliate-view.renderer` attributes plus per-frame button rects (PR #7137).

Device Hub posture/rotate stall (2026-10-31, PR #7146): after several rotate + posture changes, Device Hub's rotate and posture buttons, menu bar and search field all stopped responding, to computer use and to the user's own clicks alike, while the sim and the inspector kept working. The mouse-up + Escape fix didn't help. Quitting Device Hub SHUTS DOWN the booted sim (`simctl boot` + relaunch to recover). After relaunch the posture buttons stalled again within a minute. There is no simctl command for rotate or posture. Plan fold/unfold checks first, before many rotations.
