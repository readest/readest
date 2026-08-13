---
name: longpress-contextmenu-double-fire-5596
description: A touch long press fires useLongPress's timer AND the WebView contextmenu; wiring both to one action double-toggles it (#5596 book deselects itself)
metadata:
  type: project
---

`#5596` — on a Samsung Galaxy Tab S11 Ultra (Android 16), long-pressing a book selected it and
then deselected it ~200ms later **while the finger was still down**. MERGED 2026-08-11 as
`d843df6b6` (PR #5621). Device verify on an affected tablet PENDING; no Galaxy Tab on hand,
so ask the reporter to confirm on a nightly.

CI note: `build_tauri_app` failed the first run with `Timed out waiting for WebDriver on
port 4445` at 835/1064 crates. That is a **cold Rust cache on a fresh branch**, not your
change; it passed on re-run. Same family as [[web-e2e-local-devserver-cold-compile-flake]].

A touch long press emits **two** independent signals:
1. `useLongPress`'s own `threshold` timer (500ms) -> `onLongPress`
2. the WebView's native `contextmenu` event

`BookshelfItem` wires both to the same `handleSelectItem`. Whichever arrives first
cancels the other — `handleContextMenu` calls `reset()`, which clears `timerRef` — so
on most devices exactly one runs. **But that only works in one direction.** When the
device's long-press gesture is detected *after* our 500ms timer, `onLongPress` has
already run, and `handleContextMenu` used to schedule `onContextMenu` anyway
-> two toggles from one press. Chrome's own long-press timeout is also ~500ms, so
this is a dead heat decided by scheduling jitter and the device's touch-and-hold
delay. That is why it reproduced on one tablet and not on the maintainer's phone.

Fix: `handleContextMenu` snapshots `isLongPressTriggered.current` and skips
`onContextMenu` when the timer already handled this press (it still calls
`preventDefault`, so the native callout stays suppressed).

**The throttle was never a guard.** `handleSelectItem` is
`useCallback(throttle(fn, 100), [isSelectMode])`, so the *first* toggle flips
`isSelectMode` and React mints a **brand-new throttle closure with `lastCall = 0`** —
the second call fires unconditionally. Even on a shared instance the contextmenu's
100ms `setTimeout` exactly equals the 100ms throttle window (`remaining = 0` passes
the `<= 0` test). Never rely on `throttle`/`debounce` for de-duplication when the
wrapper's `useCallback` deps include state the callback itself changes.

**How the video pinned it:** `ffmpeg -vf fps=20,crop=...` on the issue's screen
recording showed selection appear at t=1.60s and vanish at t=1.80s with the finger
still visibly pressed. Finger-still-down at both transitions is what ruled out the
pointerup/tap path and proved two calls inside one press. See
[[browser-verify-readest-web-recipe]] for the other end of this (live) toolkit.

Related, NOT fixed: `RecentShelf` uses `useLongPress` with `onLongPress` but **no**
`onContextMenu`, so on Android a `contextmenu` that wins the race calls `reset()` and
cancels the select outright — long-press-select on the recent shelf should be flaky
in the same conditions. Unverified on device.
