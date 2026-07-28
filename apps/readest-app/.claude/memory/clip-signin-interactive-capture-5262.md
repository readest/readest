---
name: clip-signin-interactive-capture-5262
description: "#5262 login-walled article capture: interactive sign-in clip mode (Android+iOS) + iOS share-ext Safari DOM capture; browser cookies are unreachable, app cookie jar is the fix"
metadata: 
  node_type: memory
  type: project
  originSessionId: 4af4f927-b772-4650-bb93-26ccd73ba1cb
  modified: 2026-07-28T15:05:02.559Z
---

Issue #5262: Bloomberg article behind a login clipped only the free preview.
MERGED PR #5377 (2026-07-28; includes the i18n pass for all 33 locales).
On-device verification of the native controllers was still pending at merge.

Key facts (non-obvious):

- **You cannot reuse the external browser's session.** Android/iOS sandboxing
  hides Chrome/Edge/Safari cookies; Custom Tabs have the cookies but no DOM
  access. The only paths are (a) sign in inside the app's own clip WebView, or
  (b) iOS Share Extension JS preprocessing which runs inside the Safari page.
- The clip WebView's cookie jar (`CookieManager` / default
  `WKWebsiteDataStore`) is **app-wide and persistent** - one interactive
  sign-in authenticates every later headless clip, including RSS tap-to-open
  (`articleIngest.ts`). Android needed `setAcceptThirdPartyCookies` + `flush()`.
- Flow: `convertToEpub.ts` quality-floor rejection now throws `ConversionError`
  code `login_wall` -> `clipPageWithSignInFallback` (`clipSignIn.ts`) asks via
  sync event `clip-signin-confirm` ([[ClipSignInAlert]] mounted in library +
  reader pages) -> re-invokes `clip_url` with `interactive: true` ->
  `ClipUrlController.kt` / `.swift` show the page with a Cancel/Capture bar,
  no timeout, no auto-capture. Cancel message is the shared string
  `"Capture cancelled"` (`isClipCancelled`), kept quiet in all callers.
- iOS Share Extension: `NSExtensionJavaScriptPreprocessingFile`
  (`GetPageContent.js`) + `NSExtensionActivationSupportsWebPageWithMaxCount`
  deliver the signed-in Safari tab's DOM. HTML (<=10 MB) goes to App Group
  `SharedClips/<uuid>.html`; `PendingSave.htmlFile` -> host command
  `plugin:native-bridge|read_share_clip_html` (read+delete, bare-filename
  validated) -> direct `convertToEpubWithWorker`, falling back to `clip_url`.
  Chrome/Firefox iOS share only a URL; only Safari runs the JS preprocessor.
- `AppGroupBridge.swift` exists twice (plugin + ShareExtension target) and must
  stay code-aligned; verified with a comment-stripping diff.
- **Worktree + xcodegen:** `gen/apple` lacks generated dirs (Sources, assets,
  Assets.xcassets, Externals, LaunchScreen.storyboard) so `xcodegen generate`
  fails; symlink them from the main checkout, generate, remove symlinks.
  `src-tauri/gen` is gitignored: new files there need `git add -f`
  (GetPageContent.js). project.yml is the Info.plist source of truth; the
  checked-in ShareExtension Info.plist was a stale artifact (still had the
  forbidden `NSExtensionActivationSupportsText`).
- `kind: 'page'` conversions always run on the MAIN thread (worker cannot reach
  `__TAURI_INTERNALS__`), so typed errors survive; no worker serialization
  concern.

Not done: desktop interactive mode (browser extension covers desktop), i18n
locale extraction for the new strings, on-device verification of the native
controllers.
