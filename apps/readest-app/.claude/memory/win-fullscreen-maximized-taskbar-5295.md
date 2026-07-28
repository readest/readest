---
name: win-fullscreen-maximized-taskbar-5295
description: "#5295 Windows fullscreen from maximized leaves taskbar visible/unclickable; tao keeps WS_MAXIMIZE, app-level unmaximize-first fix"
metadata: 
  node_type: memory
  type: project
  originSessionId: dcecc394-85ed-4aac-9bab-7b5c91203237
  modified: 2026-07-28T16:05:07.117Z
---

Issue #5295: on Windows, toggling fullscreen while the window is maximized left
the window clamped to the work area; the taskbar stayed visible but unclickable.

Root cause is in tao (0.35.3), not Readest: `set_fullscreen` in
`platform_impl/windows/window.rs` sets `MARKER_BORDERLESS_FULLSCREEN` via
`set_window_flags`, and `apply_diff` (`window_state.rs:377`) re-issues
`ShowWindow(SW_MAXIMIZE)` whenever the flags still contain `MAXIMIZED` — even
with no diff. `to_window_styles` also keeps `WS_MAXIMIZE`, so Windows clamps
the window to the work area and the later monitor-bounds `SetWindowPos` never
sticks. `taskbar_mark_fullscreen` is why the visible taskbar ignores clicks.

Fix (MERGED PR #5380, 2026-07-29):
in `tauriHandleToggleFullScreen` (`src/utils/window.ts`), on Windows only,
unmaximize before `setFullscreen(true)` and remember it in a module-level
`wasMaximizedBeforeFullscreen`; re-`maximize()` after `setFullscreen(false)`.
Non-Windows must keep entering fullscreen straight from maximized — Phosh
windows are always maximized (#4034). Unit tests for the call sequence were
added then removed per user feedback ([[feedback-no-mock-only-platform-tests]]);
real verification needs a Windows machine.

Related: [[window-state-sanitize-4398]]
