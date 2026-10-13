---
name: desktop-capture-webview-cdp-6380
description: "#6380 PDF/comic page turns instant on Windows: capture_webview_region was macOS-only; fixed with CDP Page.captureScreenshot on WebView2 + Linux CEF, MERGED #6506"
metadata:
  node_type: memory
  type: project
  originSessionId: 659baeda-8be1-4f9e-8148-a6ec323a2d18
  modified: 2026-09-30T13:28:55.851Z
---

#6380: fixed-layout books (PDF, CBZ/CBR, FXL EPUB) animate ONLY via the captured page turn; `capture_webview_region` rejected on Windows/Linux, first failure sets `captureBroken` for the session, so every turn was instant. Reflowable EPUB fell back to paginator View Transitions (why only those animated).

Fix (MERGED #6506 (6bcd170de) 2026-09-30, worktree + branch removed; CodeRabbit caught the observer/registration cycle, fixed via agent-detach + timeout drop on UI thread): both are Chromium, so `Page.captureScreenshot` with a clip (JPEG q90, `scale: 1`, `captureBeyondViewport: false`). Windows = `controller().CoreWebView2().CallDevToolsProtocolMethod`; CEF = downcast `R::Webview` via `&dyn Any` to `tauri_runtime_cef::Webview` (feat/cef has `type Webview: 'static`), observer via `tauri_runtime_cef::cef::*` (runtime does `pub use cef`, so no direct cef dep). Plugin `cef` feature is enabled by the app's `cef` feature.

Verified facts: with a REAL HiDPI surface, clip `scale: 1` already gives device pixels (scale=dpr would be 4×); headless DPR emulation misreports CSS size. JPEG ~35 ms vs PNG ~86 ms per full cell.

**Why:** no Windows/Linux device run yet; the CEF path is only partly compiled (full cross-build dies on GTK sys crates on Mac; `cef` `dox` feature lets a scratch crate type-check the observer code).
**How to apply:** CEF check needs Rust ≥1.95 (installed side by side as `+1.95`). `try-appimage.yml` (workflow_dispatch) is the full CEF compile. Expect a cargoHash bump from fod-hashes ([[nix-fod-hash-staleness]]).

**Follow-up 2026-09-30 (MERGED #6509 (6e567ef31)):** with the sidebar open every turn flashed left over a black right strip = sidebar width. Cause (Chromium `page_handler.cc` CaptureScreenshot): a `clip` sets emulation `viewport_offset = clip.xy` AND `GetView()->SetSize(clip size)` on the LIVE view, restored after capture. Never pass `clip` on a visible window. Fix = no clip (no emulation path), bridge.ts crops at decode via `createImageBitmap(blob, rect*dpr)` on windows/linux; host `capture` now returns `ArrayBuffer | ImageBitmap`. Rust crop rejected: `image` jpeg decode+crop+re-encode = ~75 ms/turn on M-series.
