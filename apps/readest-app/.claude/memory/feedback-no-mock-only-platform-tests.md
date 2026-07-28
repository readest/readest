---
name: feedback-no-mock-only-platform-tests
description: "Don't add unit tests that only assert mocked Tauri call sequences for platform windowing behavior that cannot really be tested"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: dcecc394-85ed-4aac-9bab-7b5c91203237
  modified: 2026-07-28T15:31:51.543Z
---

For #5295 (Windows fullscreen-from-maximized), the user asked to remove the
unit tests I added around `tauriHandleToggleFullScreen` because "you cannot
actually test the windows behavior" — they mocked the whole Tauri window API
and only mirrored the implementation's call order (unmaximize before
setFullscreen, re-maximize on exit).

**Why:** such tests restate the implementation rather than verify the actual
OS windowing outcome; they add maintenance weight without catching real
regressions. The test-first rule still applies where behavior is genuinely
observable in the test environment.

**How to apply:** when a fix's correctness lives in OS/window-manager
behavior reachable only through mocked IPC (Tauri window calls, native
plugins), ship the fix without call-sequence unit tests unless the user asks.
Existing mock-based tests in a file are not license to add more. Related:
[[feedback_no_test_seams_in_prod]], [[win-fullscreen-maximized-taskbar-5295]]
