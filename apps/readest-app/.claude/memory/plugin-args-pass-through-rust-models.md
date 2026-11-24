---
name: plugin-args-pass-through-rust-models
description: "New Kotlin/Swift plugin command args or reply fields must also be added to the plugin's Rust models.rs structs, or serde silently drops them; JS tests that mock invoke never notice"
metadata:
  node_type: memory
  type: project
  originSessionId: 9edf62d7-0f97-4d63-a2e4-8e7190abf35e
  modified: 2026-11-18T05:19:22.868Z
---

Tauri plugin commands go JS → Rust (`src/models.rs` typed request) → Kotlin/Swift, and the reply comes back through a typed Rust response. Serde drops any field the structs don't declare. PR #7602 (A-B repeat on Android) added `loopStartMs`/`loopEndMs` to the Kotlin `PlayoutControlArgs` and an `armed` reply field, but not to `PlayoutControlRequest`/`PlayoutControlResponse`. Kotlin got null bounds, JS always read "not armed", and the feature never ran on a device, while every JS and Kotlin unit test passed. Fixed in 3cfd7543a with a serde round-trip test in models.rs.

**How to apply:** when reviewing a plugin change that adds a Kotlin/Swift arg or reply field, grep `src/models.rs` for it. The native-tts plugin also has `tests/linux_lifecycle.py`, which compiles the Linux worker against its own stub of these structs. CI rust_lint runs it, so new response fields go there too (f5356a963).

**Device recipe (Xiaomi 13):** within about a minute of the screen going off, WebView JS timers fire only once a minute, on the minute (:58 in logcat). A-B loop jumps show as `MediaCodec ... FLUSHING` on the narration decoder (Qin ~270 per 5 s), and the keep-alive silence decoder flushes every 10 s. A release APK has no debuggable run-as, so to see state, build with temporary `Log.i` probes. See [[media-overlay-android-rewind-stall]] and [[feedback-always-verify-on-xiaomi]].
