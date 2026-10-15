---
name: sentry-iframe-shared-listener-dead
description: "Android/Windows: Sentry runs in every book-page iframe; a listener fn shared across page docs goes silently dead once the first page unloads (PDF image long-press menu, 2026-10-14)"
metadata:
  node_type: memory
  type: project
  originSessionId: 6b326d7b-f148-41f8-9997-578c540967db
  modified: 2026-10-13T16:17:10.257Z
---

Root cause of "PDF image long-press menu never opens on Android" (2026-10-14, verified on the Xiaomi via CDP):

- wry's Android backend injects EVERY Tauri init script with `WebViewCompat.addDocumentStartJavaScript(script, setOf("*"))` (RustWebView.kt), ignoring `for_main_frame_only`; wry docs say Windows also injects into subframes. So tauri-plugin-sentry's `@sentry/browser` runs inside each section/page iframe (`iframe.contentWindow.__SENTRY__` is set) and patches THAT iframe's `EventTarget.prototype.addEventListener`.
- Sentry's `wrap(fn)` caches the wrapper on the function (`fn.__sentry_wrapped__`), created in the realm of the FIRST page that registered it. The same fn attached to page B reuses page A's wrapper. When page A's iframe is removed, Blink silently skips that listener on page B: `getEventListeners` still lists it, no error, breakpoint inside never hits.
- Intermittent by design: works after a fresh reload (first page still alive), dies after the first-loaded page is evicted (scroll mode, page turns, reopen).
- MERGED #6771 (354f90341) UNRELEASED; Android verified on device, iOS `no-context-menu` change NOT device-verified. Fix: Annotator onLoad attaches a fresh closure per doc for the formerly shared `handleContextmenu`, `handleTouchStart`, `handleMouseDown`, `handleTouchCancel`. `.bind(null, doc, index)` handlers were already per-doc.

**How to apply:** never `doc.addEventListener(type, sharedFn)` across section docs; wrap per doc. Debug signature for "listener listed but not firing in a reader iframe": check `fn.__sentry_wrapped__ instanceof otherIframe.contentWindow.Function`. Follow-up NOT done (user chose the per-page fix): patch the packages/tauri fork to guard main-frame-only scripts on Android, which also drops per-iframe Sentry overhead.

Debug tooling that cracked it: CDP over `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`; evaluate in iframe contexts via `Runtime.enable` + `contextId` + `includeCommandLineAPI` (getEventListeners from the main context returns nothing for iframe docs); `DOMDebugger.setEventListenerBreakpoint('contextmenu')` shows which listeners actually run. adb screencap is black on this Xiaomi; `Page.captureScreenshot` works but omits iframe content.
