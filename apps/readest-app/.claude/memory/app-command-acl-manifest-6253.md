---
name: app-command-acl-manifest-6253
description: "#6253 set_window_title was dead at runtime: app commands need build.rs AppManifest + allow-* in capabilities; guard test now covers every generate_handler entry"
metadata:
  type: project
---

`src-tauri/build.rs` declares a `tauri_build::AppManifest` command list, so EVERY
`#[tauri::command]` in lib.rs's `generate_handler!` must also be (1) in that list and
(2) granted as `allow-<kebab-name>` in `capabilities/default.json` (and
`webdriver-remote.json` unless deliberately local-only). Otherwise the webview gets
`"<cmd> not allowed. Command not found"` and the call silently dies as an
unhandledRejection. #6253 (030f9c025, traffic-light title re-apply) shipped
`set_window_title` that way; found 2026-09-18 via Next 16's `[browser]` console
forwarding in the dev log, MERGED in #6260 (4dcfbd1a3).

**Why:** `#5632` added the manifest for the webdriver remote origin; from then on local
windows resolve app commands through the ACL too (comment in build.rs). Nothing in
`cargo build`/clippy/tsc catches a missing entry.

**How to apply:** `src/__tests__/tauri/app-command-acl.test.ts` now asserts every
registered command is declared + granted (regex anchors on `generate_handler![ ... ])`
because `#[cfg(...)]` lines contain `]`). Adding a command = 3 files. See
[[traffic-lights-library-orphan-hide-6222]] for the feature that exposed it.
