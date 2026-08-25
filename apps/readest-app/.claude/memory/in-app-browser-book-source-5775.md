---
name: in-app-browser-book-source-5775
description: "#5775 in-app web browser as a book source (Calibre-web/Kavita/ABS): feasibility verdict, which Tauri/wry hooks exist per platform, and that the existing clip_url controllers are the base"
metadata: 
  node_type: memory
  type: project
  originSessionId: b342c1d2-631c-47ca-aa3b-5efe47d946df
  modified: 2026-08-25T14:20:36.630Z
---

Issue #5775 (2026-08-18) asks for a MapleRead-style "From Web Browser" import: in-app browser with
persistent login whose downloads land in the library. MERGED as PR #5870 (merge commit f45036556,
2026-08-25); worktree `/Users/chrox/dev/readest-feat-in-app-browser-5775` removed and branch
`feat/in-app-browser-5775` deleted. Desktop chrome
= pill injected via `initialization_script` (NOT multiwebview: `unstable` flips every window to
WebviewKind::WindowChild). Live desktop run blocked while the user's production Readest.app runs
(single-instance identifier); Android/iOS device verification pending.

**Verdict:** possible and proper, but it is TWO mechanisms behind one JS API, not one Tauri
`WebviewWindow` everywhere:
- Desktop: `WebviewWindowBuilder::new(app, "browser-*", WebviewUrl::External)` +
  `.on_download()` (wry download_started/completed handlers, implemented on macOS/Windows/Linux)
  + `.on_new_window()` + `.on_navigation()`. Cookies already persist: macOS default
  `WKWebsiteDataStore`, Win/Linux forced `data_directory` = app LocalData (tauri
  manager/webview.rs) and WebKitGTK persistent cookie file (wry web_context.rs). Shared jar
  with the main window. Remote windows get no IPC (no `dangerousRemoteDomainIpcAccess`;
  capabilities list only main/updater/reader-*). macOS `DownloadEvent::Finished.path` is
  always None (wry limitation) — track the destination we set in `Requested`.
- Mobile: tauri 2.11.0 added multi-window on Android (activity embedding, `activity_name`)
  and iOS (scenes), BUT wry's Android WebView has NO DownloadListener (RustWebView.kt /
  RustWebViewClient.kt) so `on_download` is inert there, `on_new_window` is documented
  unsupported on Android/iOS, and iOS scenes are not a modal sheet. Use the native
  controllers instead.

**Base to extend (already in repo):** `clip_url` infra — `src-tauri/src/clip_url.rs`
(desktop hidden window + localhost bridge), `ClipUrlController.swift` (WKWebView modal,
app-default persistent data store, Chrome UA, Cancel/Capture bar), `ClipUrlController.kt`
(Dialog + WebView, app-wide CookieManager + flush()). Its interactive sign-in mode is what
the reporter accidentally hit via "From Web URL". Missing pieces: WKDownloadDelegate
(iOS >= 14.5, target is 15.0), `WKUIDelegate.createWebViewWith` for target=_blank,
Android `setDownloadListener` (+ download ourselves with `CookieManager.getCookie(url)`),
`onCreateWindow`. Import via `ingestFile({ file: path, books })` in
`src/services/ingestService.ts` (same as OPDS `appService.importBook`).

**Known gaps to design around:** blob: downloads on Android need a JS shim; Basic-auth
sites need HttpAuthHandler; only intercept book MIME/extensions (`src/services/opds/formats.ts`);
Google SSO blocks embedded webviews (keep the Chrome UA spoof).

Related: [[opds-fixes]], [[feedback-always-verify-on-xiaomi]].

**Device lesson (Boox Leaf5, 2026-08-25):** first APK crashed the library page with React #185
because `useSettingsStore((s) => s.settings.webSources ?? [])` returned a fresh `[]` each render;
zustand 5 + useSyncExternalStore loops on unstable selector snapshots. Use a module-level
`NO_SOURCES` constant; regression test `web-sources-dialog-store.test.tsx` renders with the REAL store.
The native chrome + DownloadListener + banner were verified working before the crash was found.

**Resume state (2026-08-25 15:43, session cut mid-rebuild):** device 368b0948 still has the PRE-fix APK
(md5 2c89c4b6, built 15:32, before the NO_SOURCES commit b1dfa7e95 at 15:42); the post-fix
`pnpm tauri android build -t aarch64 -- --features devtools` was restarted at 15:42:22 and never
finished (no APK newer than 15:32). Full `pnpm test` / lint / fmt / clippy last ran at ~15:13, i.e. 4
commits before HEAD -> re-run on HEAD before PR. Desktop `cargo check` printed a `warning: unused`
at 15:25 (check clippy). Device flow at 15:38 on the old APK: download link clicked but `books:0`,
then React #185 crash (the selector bug). macOS manual run + iOS compile still untouched.

**Verification 2026-08-25 (second session, HEAD b1dfa7e95):** ALL automated checks GREEN on HEAD:
`pnpm test` 820 files/10089 tests, `pnpm lint`, `pnpm fmt:check`, `pnpm clippy:check`, `pnpm test:rust`
(120), `cargo test -p tauri-plugin-native-bridge` (web_browser_models 2). iOS sim compile GREEN
(`pnpm exec dotenv -e .env.tauri -- tauri ios build --target aarch64-sim -- --features devtools`; the
worktree needed the gitignored `gen/apple/{Readest_iOS/Info.plist,ExportOptions.plist,...}` copied from
the main repo first; a bare `dotenv` outside pnpm resolves to the Ruby gem). Android post-fix APK
(md5 84c1dbc2, 16:07) INSTALLED on 368b0948 but the phone was SECURE-LOCKED (deviceLocked=1) the whole
session -> library renders + WebSourcesDialog opens with no React #185 (probe via CDP), but the
download->import flow is still UNVERIFIED on Android; behind the keyguard page timers stall so any
CDP evaluate that awaits a timeout hangs. macOS release build (`pnpm dev-macos`, shares the prod data dir)
VERIFIED: Import menu entry, dialog add/list/remove, WebviewWindow + injected pill, download intercept
(pill "Downloading · <Content-Disposition name>"), pill ✕ closes and resolves. NOT verified on macOS:
import->Added->[Open] (skipped on purpose, real library), e-ink pill.

**OPEN DEFECTS found:**
1. macOS: clicking a `target=_blank` link (W3Schools try-it `tryhtml_a_target`, link inside the result
   iframe) made the browser window DISAPPEAR (Window menu listed only `Readest`; process alive, no crash
   report, `openWebBrowser` resolved with no hash). Expected: `on_new_window` -> Deny + navigate same
   window. Cause NOT found by reading wry 0.55.1 ui_delegate (Deny -> None), tauri fork wrappers,
   chrome.js (close only on ✕/Cmd+W), lib.rs (handlers only on `main`). Needs a live repro with
   `log::` in on_navigation/on_new_window/Destroyed. Single observation; also untested on Android
   (`onCreateWindow`).
2. Cancelled/failed downloads leave a partial file in `browser-downloads/` on desktop (web_browser.rs
   `DownloadEvent::Finished{success:false}` emits but never deletes) and iOS (`didFailWithError`);
   Android `dest.delete()`s. Closing the window mid-download aborted a 24 MB .mobi at 12 MB and left it.
3. Gutenberg's Kindle link is served as `pg1342-images-kf8.mobi` (Content-Disposition), i.e. a SUPPORTED
   ext, so there is no "unsupported" download on that page for a side-effect-free desktop test.

Side effects left on the user's machine: two test web sources (gutenberg.org, w3schools.com) in the
prod settings `webSources` (remove via the dialog ✕), my release build instance still running with a
reader window on "Alice's Adventures in Wonderland" (accidental click while the user was Cmd+Tabbing).

**third-party book site verification 2026-08-25 (user request, HEAD + pill fix):** the site WORKS end-to-end on
BOTH platforms via the in-app browser.
- Xiaomi 368b0948 (feature APK md5 84c1dbc2 reinstalled; the phone had reverted to a stock 0.12.1
  build md5 3cf9d1b9 from 16:33 -> ALWAYS md5-check + reinstall before device verify): added a third-party book-site source (the FIRST url input in the dialog is the ADD-SOURCE field, placeholder
  `https://calibre.example.com`; there are 4 `input[type=url]` on the page, the naive `querySelector`
  grabbed the wrong one), opened it (no Cloudflare challenge, `cf:false`), searched "Pride and
  Prejudice" (102 results), opened a book, clicked the logged-out `/dl/` link -> file downloaded +
  IMPORTED, library 70->71, "Pride & Prejudice" (Jane Austen, public-domain) now book #1. This also
  finally VERIFIES the Android download->import flow that was the last open item.
- macOS release build (`pnpm dev-macos`): same flow, pill showed "Added to library · Pride Prejudice
  (Jane Austen) (<long site-suffix filename>).epub [Open]" and imported the book.

**PILL LAYOUT BUG (user-reported from the the site run) FIXED:** the long the site filename pushed the [Open]
button off the pill's right edge (clipped to "Ope"). Root cause in `web_browser_chrome.js`:
`text-overflow:ellipsis` sat on the `.status` FLEX CONTAINER (a no-op there) and the text lived in a
bare `<span>` with no shrink/min-width, so it grew to full width and shoved `.open` past the clipped
edge. Fix: text span now has class `.status-text{overflow:hidden;text-overflow:ellipsis;white-space:
nowrap;min-width:0;flex:0 1 auto}`, `.open` + `.btn` got `flex:none`, `.status` got `min-width:0;
flex:0 1 auto`, `.pill` got `max-width:calc(100vw - 24px);box-sizing:border-box`. Regression test
`chrome_script_keeps_open_button_from_clipping` (asserts `.status-text{` + ellipsis + `flex:none` in
the `.open` rule). The MOBILE native banners were ALREADY correct (Android `bannerText`
maxLines=1/ellipsize=MIDDLE/weight=1f + fixed Open TextView; iOS `.byTruncatingMiddle` + low
compression resistance) -> desktop-only fix. NOT one more macOS commit yet; rebuild in progress to
visually re-confirm the fixed pill.

Extra side effect on the user's Mac: a public-domain "Pride Prejudice (the site...).epub" was
imported into the real library during the macOS verify; (test web sources since removed from prod `webSources`)
alongside the earlier gutenberg.org/w3schools.com test sources (all removable via the dialog x).

**PR #5870 review handled (2026-08-25, commit c5d7b0c2f):** CodeRabbit posted 6 inline findings.
FIXED 4: (1) Android `uniqueFile` now reserves atomically via `createNewFile()` retry loop (TOCTOU race
on concurrent same-name downloads); (3) partial-file cleanup on failed downloads for desktop
(`DownloadEvent::Finished` !success -> `remove_file`) + iOS (`didFailWithError` -> `removeItem`), Android
already deleted; (4) mobile `open_web_browser` wrapped in `tauri::async_runtime::spawn_blocking` (the
native call blocks until the browser closes, was parking an async worker); (5) `.catch` on the download
subscription promise. SKIPPED 2 as misfires (replied on-thread): #2 wanted the plugin `default.toml` to
grant `open_web_browser`/`set_web_browser_status`, but JS `invoke()` hits the APP commands granted in
`capabilities/default.json:236-237`; the plugin command runs Rust-internal via `run_mobile_plugin` (not
JS-ACL-gated), and Android device flow works. #6 wanted `TTSCapabilities` gating -> that rule is scoped
to Read Aloud/TTS only; the `isMobileApp` split here is a real event-transport difference (desktop window
event vs mobile plugin listener), not client-identity gating. Verified: desktop cargo fmt/clippy/test:rust
+ full `pnpm test` (10098) + lint all green; iOS sim build SUCCEEDED; Android build+install SUCCEEDED
(md5 774db55e). BUILD RACE LESSON: running `pnpm dev-android` and `pnpm dev-ios` CONCURRENTLY both
regenerate `out/` (next export) -> one clobbers a hashed asset (`jieba_rs_wasm_bg...wasm`) mid
`generate_context!()` read -> spurious "failed to read asset" build failure; run mobile builds SEQUENTIALLY.
Device smoke-test of the download happy-path PENDING (Xiaomi secure-locked; behind keyguard the browser
WebView timers stall so CDP evals that await hang).
