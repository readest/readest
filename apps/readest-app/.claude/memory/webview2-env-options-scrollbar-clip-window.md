---
name: webview2-env-options-scrollbar-clip-window
description: "Windows 'Import from Web URL' (and the new in-app web browser) died with WebView2 HRESULT 0x8007139F because the extra WebviewWindow didn't set ScrollBarStyle::FluentOverlay like the main window; WebView2 rejects a second webview whose environment options differ"
metadata: 
  node_type: memory
  type: project
  originSessionId: 1d7320e8-6722-4560-8ab9-11e1f60374ab
  modified: 2026-08-25T15:48:31.595Z
---

**Symptom (reported 2026-08-25):** on Windows, Import from Web URL shows
"Could not create clip webview: runtime error: failed to create webview:
WebView2 error: WindowsError(Error { code: HRESULT(0x8007139F), message:
"The group or resource is not in the correct state to perform the requested
operation." })" for ANY url (reporter used a Substack post). Nothing the user
did wrong; the clip window never opened on Windows since the feature shipped
(#4241, 2026-05-21) because #3868 (2026-04-15) had already pinned the main
window to `ScrollBarStyle::FluentOverlay`.

**Root cause:** 0x8007139F = ERROR_INVALID_STATE. MS docs for
`CreateCoreWebView2EnvironmentWithOptions`: "As a browser process may be
shared among WebViews, WebView creation fails with
HRESULT_FROM_WIN32(ERROR_INVALID_STATE) if the specified options does not
match the options of the WebViews that are currently running in the shared
browser process." wry 0.55 `create_environment` puts `scroll_bar_style` into
`ICoreWebView2EnvironmentOptions8` (environment-level, like
`additional_browser_args`, `browser_extensions_enabled`, data dir). Vendored
tauri docs say the same: "must be given the same value for all webviews that
target the same data directory". `lib.rs` sets FluentOverlay on `main`; the JS
windows (`nav.ts` reader/main, `updater.ts`) pass `scrollBarStyle:
'fluentOverlay'` on Windows; `clip_url.rs` and `web_browser.rs` (#5775) did
not. Same class as tauri-apps/tauri#11144.

**Fix (worktree `fix/clip-webview-scrollbar-windows`, from origin/main):**
`#[cfg(target_os = "windows")] let b = b.scroll_bar_style(ScrollBarStyle::FluentOverlay);`
before `.build()` in both `src-tauri/src/clip_url.rs` and
`src-tauri/src/web_browser.rs`, plus `#[cfg(target_os = "windows")] use
tauri::webview::ScrollBarStyle;`. MERGED as #5873 (d213af033) on 2026-08-25; worktree and branch removed 2026-08-26. Gates: fmt/clippy/test:rust/vitest green on macOS.

**How to apply:**
- Every new `WebviewWindowBuilder` (Rust) or `new WebviewWindow` (JS) on
  Windows MUST pass FluentOverlay, or it fails with 0x8007139F. Same rule for
  any future `additional_browser_args` / `data_directory` / proxy /
  `browser_extensions_enabled` divergence.
- `ScrollBarStyle::FluentOverlay` is `#[cfg(windows)]` in tauri-runtime, so
  the call CANNOT be left un-gated (tried; E0599 on macOS). The Windows-only
  block is therefore NOT compiled by PR CI (only nightly.yml/release.yml build
  Windows Rust) and no Windows rustup target is installed here; the call is
  byte-identical to `lib.rs:706` which Windows CI compiles.
- Not reproducible on this Mac; Windows verification by the reporter pending.

Related: [[in-app-browser-book-source-5775]] (web_browser.rs had the same gap
the day it merged), [[feedback-no-config-mirror-tests]] (no vitest for a
builder flag; toolchain gates instead).
