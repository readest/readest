---
name: deeplink-coldstart-hijacks-spawned-windows-6104
description: "#6104 every bookshelf click re-opened the URL-launched book: getCurrent() is process-global and each new reader window re-read it"
metadata: 
  node_type: memory
  type: project
  originSessionId: d348f44e-279a-4d7d-98cd-a86fcf364f51
  modified: 2026-09-07T08:13:39.108Z
---

MERGED #6111 (2026-09-07); NOT device-verified on macOS/Android/iOS.

#6104 (macOS, reported 2026-09-07): after `open readest://book/<hash>`, every
bookshelf click opened that same book instead of the clicked one, until the app
was quit.

**Root cause.** `tauri-plugin-deep-link` stores the launch URL in
PROCESS-global state and never clears it — macOS `RunEvent::Opened` does
`current.replace(urls)` (plugin `src/lib.rs` `.on_event`), Windows/Linux do the
same in `handle_cli_arguments`. So `getCurrent()` keeps returning
`readest://book/<hash>` for the whole session. Both JS consume-once guards are
PER-WEBVIEW: the module-scoped `coldStartConsumed` flag and the
`consumedColdStartBookUrl` sessionStorage key. `openBookInNewWindow` defaults to
**true** (`services/constants.ts`), so every library tap calls
`showReaderWindow` → a brand-new `WebviewWindow` (`reader-N`) with a fresh JS
context and empty sessionStorage → `useOpenBookLink` re-reads the stale URL →
`window.location.pathname` starts with `/reader` → dispatches
`open-book-in-reader` → `useBooksManager.openBookInReader` does
`setBookKeys([newKey])`, which REPLACES the clicked book. Quitting "fixes" it
only because the process dies.

**Mobile is a SECOND path, same root cause.** chrox confirmed Android + iOS
reproduce, but only after a background/resume. Android's `activity.intent` is
STICKY, so `DeepLinkPlugin.load()` re-reads it and re-emits it as a FRESH
delivery on every Activity recreation -> lands on `app-incoming-url`, the LIVE
path, which is deliberately never deduped. iOS: WebKit recycles the WebContent
process on resume, the document reloads, `coldStartConsumed` + sessionStorage
both die while `getCurrent()` still holds the URL. Checked and RULED OUT:
`onOpenUrl` does NOT replay getCurrent (2.4.9/2.4.10 just `listen`), and the
native bridge's pending-event queue drains once.

**Fix 2** (`src/utils/deeplinkConsume.ts` `markLaunchUrl(scope, url)` +
`app_run_id` in the lib.rs init script): the marker was scoped to the DOCUMENT,
the deep link lives as long as the PROCESS. Rust mints `__READEST_APP_RUN_ID__`
once per run; the marker is localStorage keyed on it, ONE key per scope holding
`{run, urls[]}` (a per-run SET capped at 16 - a single last-seen stamp lets a
replayed A through once B was opened; CodeRabbit caught that). Cold-start reads
(`getCurrent()`) skip a URL already in the set; LIVE deliveries are ALWAYS
processed and only RECORDED, so a reload re-reporting them is a replay.
Re-tapping the same bookmark still works (that IS the reporter's workflow).

**Dead end, do not repeat:** a 10s "launch replay window" on the live path.
CodeRabbit flagged it, and it was guarding a path that does not exist: on
Android `register_android_plugin` (-> Kotlin `load()`) runs BEFORE
`setEventHandler`, so `channel` is null in `load()` and the re-emit is a no-op;
the launch URL reaches JS ONLY via `getCurrent()`. Tauri does not buffer emits
either (the native bridge's pending-event queue exists for exactly that).

**Fix 1** (`src/utils/window.ts` `isMainAppWindow()`, gated into the
`if (!coldStartConsumed ...)` branch of `useOpenBookLink`,
`useOpenAnnotationLink`, `useOpenShareLink`): only the window labelled `main`
consumes a cold-start URL. Windows the app spawns itself carry their own intent
in their URL (`/reader?ids=`, `/library?file=`) and never need it. Live taps
(`app-incoming-url`) are untouched — those are genuine user actions.

**Gotchas.**
- The Rust `WebviewWindowBuilder::new(app, "main", ...)` in `src-tauri/src/lib.rs`
  is NOT `#[cfg(desktop)]`-gated, so mobile webviews are labelled `main` too and
  keep working.
- `useOpenWithBooks` already had the same idea as `isFirstWindow()` for the LIVE
  path — precedent, not a new pattern.
- Unit-testing this needs `vi.resetModules()` (the guard is module state) plus a
  static `import '@/hooks/useOpenBookLink'` to warm the graph, or the first case
  times out under parallel load.

Related: [[bug-patterns]]
