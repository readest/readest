---
name: appstore-review-crash-0121-aswebauth-anchor
description: "iOS 0.12.1 App Review crash rejection traced via Sentry to ASWebAuthenticationSession's presentationAnchor returning UIApplication.shared.windows.first ?? UIWindow(); also: how to identify Apple's review device in Sentry"
metadata: 
  node_type: memory
  type: project
  originSessionId: 292f3090-5ed8-4ef1-aad1-51312279e3d6
  modified: 2026-08-09T03:16:48.980Z
---

App Review rejected iOS **0.12.1** ("app crashed after the initial launch", 2026-08-09).
Not reproducible locally on fresh TestFlight installs (iOS 18.7, 26.5). Sentry had the
crash all along — `READEST-4A1`, `EXC_BREAKPOINT: Invalid condition not satisfying:
processHandle` in `__85-[_UIRemoteViewControllerSceneHostingImpl
_viewServiceHostSessionDidConnectToClient:]_block_invoke`.

**How to spot Apple's review device in Sentry** (reusable): filter
`release:"com.bilingify.readest@<ver>+<ver>"` before public rollout — a build still in
review has ~1 event, and it is the reviewer. Confirmers on this one: `os.build 23G71`
iOS 26.6 whose `kernel_version` says **`xnu_development ... DEVELOPMENT_ARM64_T8140`** —
a development kernel is an Apple-internal build, not something a normal user runs. Plus
geo US, `environment: production`, iPhone17,2. `dist`/`release` carry the version twice
(`0.12.1+0.12.1`). Note `os.version` comes back empty in aggregate queries — read the
`os` tag or the `os` context instead.

**Reading the session from breadcrumbs** (Sentry Cocoa records `ui.lifecycle` per VC):
app_start 18:58:37 → crash 19:01:20, so ~2m43s into the FIRST launch. In between: six
keyboard show/hide cycles (`UIInputWindowController` / `UIRemoteKeyboardWindow`), a
`_done` accessory-bar tap, multi-tap gestures, then
**`WebValidationBubbleViewController`** presented on `TaoUIViewController` — that is
WebKit's native HTML5 form-validation popover, i.e. the reviewer was failing validation
on a **sign-in form**. Crash 4s later while a remote view service was connecting.

**Root cause** — `NativeBridgePlugin.swift` (~2124), unchanged since PR #433, so LATENT
not a 0.12.1 regression:

```swift
func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
  return UIApplication.shared.windows.first ?? UIWindow()
}
```

Two defects. `UIApplication.shared.windows` is deprecated since iOS 15, returns windows
across all scenes in arbitrary order, and during a keyboard teardown the app really does
have `UIRemoteKeyboardWindow` + `UITextEffectsWindow` alive (the breadcrumbs prove it) —
anchoring the auth sheet to a system-owned window is what starves scene hosting of a
`processHandle`. The `?? UIWindow()` fallback is worse: a scene-less window can never
host a remote VC. Discriminator that IS public API: system keyboard/text-effects windows
sit above `UIWindow.Level.normal`, so filter `windowLevel == .normal` after going through
`connectedScenes.compactMap { $0 as? UIWindowScene }`. `set_system_ui_visibility` in the
same file already uses the correct `connectedScenes` pattern — copy it.

Reachability confirmed: `src/app/auth/page.tsx:125` → `authWithSafari` →
`plugin:native-bridge|auth_with_safari`, the OAuth path on the sign-in screen.

**Caveat:** attribution to ASWebAuthenticationSession is inference, not symbols — the
stack was garbage (`__cxa_throw` x3, `__isPlatformVersionAtLeast` above
`UIApplicationMain`) because **no dSYM was uploaded for this build**. Upload dSYMs so the
next native crash symbolicates; see the `sentry:sentry-fix-stack-traces` skill.

**Also visible in the same 30d cocoa sweep** (0.11.20, separate issues): App Hanging
x1020, `NSGenericException: Application does not implement CarPlay template application
lifecycle methods in its scene delegate` x733, `SIGABRT: TaoUIWindow` x38,
`NSPhotoLibraryAddUsageDescription` x26 (supposedly fixed by #5405 — verify), and
`VolumeKeyHandler` KVO remove-observer NSRangeException.

**App Hang x519/138 users (READEST-1MC + ~9 sibling groups) — FIXED same pass.**
`range_file.rs`'s `handle()` responded inline behind the comment "The handler runs off the
UI thread ... so blocking file I/O here is fine." True on Android
(`shouldInterceptRequest` = WebView worker), FALSE on iOS/macOS: WKWebView calls
`WKURLSchemeHandler` on the MAIN thread. Hang stack is the proof —
`WebURLSchemeHandlerCocoa::platformStartTask` -> app frames -> `realpath` +
`__getattrlist`, i.e. the asset scope's `is_allowed` canonicalize plus the range read,
all on the main run loop. Fix: `tauri::async_runtime::spawn_blocking`; the scheme is
already registered via `register_asynchronous_uri_scheme_protocol` so the responder may
outlive the call. Verified: cargo check + fmt:check + clippy:check + test:rust (91 pass).

**CarPlay x726/326 users (READEST-1T9) — ROOT-CAUSED, FIXED, REPRODUCED BOTH WAYS.**
"CarPlay works in the simulator" was FALSE and is the trap that hid this for a month: the
app launches from the CarPlay home screen and dies before drawing, so the CarPlay screen
looks unchanged and reads as "fine". What actually worked was audio + Now Playing, which
is `MPNowPlayingInfoCenter` and NEVER creates a `CPTemplateApplicationScene`. Verify
CarPlay by TAPPING THE APP ICON on the CarPlay display and confirming the list template
renders - absence of a visible change proves nothing.

Repro recipe (no car needed, ~2 min): `xcrun simctl boot <iPhone>` ->
`xcrun simctl install booted <app>` -> `open -a Simulator` -> enable via
`osascript -e 'tell application "System Events" to tell process "Simulator" to click menu
item "CarPlay" of menu 1 of menu item "External Displays" of menu 1 of menu bar item
"I/O" of menu bar 1'` -> read window bounds with System Events (the CarPlay window MOVES
between runs, re-read them) -> `screencapture -x -R x,y,w,h`. System Events
`click at {x,y}` FAILS with -25204; post a real CGEvent instead (a 15-line
`swift click.swift` using `CGEvent(mouseEventSource:mouseType:mouseCursorPosition:
mouseButton:)` + `.post(tap: .cghidEventTap)` works). Crash evidence:
`xcrun simctl spawn booted log show --last 5m --predicate 'process == "Readest"'`.
Confirmed 0.11.20 -> exact production exception; 0.12.1 + patched tao -> title "Readest"
+ "Open a book on your phone to start" renders and the process survives.

Root cause was NOT in Readest: `packages/tao` (submodule, fork `readest/tao`, wired by
`[patch.crates-io]`) `configuration_for_connecting_scene_session`
(`src/platform_impl/ios/view.rs:629`) IGNORED the connecting session's role and always
returned a `UIWindowSceneSessionRoleApplication` config with `TaoSceneDelegate`.
**Implementing that selector makes UIKit stop reading `UIApplicationSceneManifest`
entirely, so the callback must answer for EVERY role.** Fix: read
`msg_send![session, role]`; for any non-window role return
`configurationWithName(None, role)` so UIKit resolves the config AND delegate class from
the manifest. Registration is gated on `multiple_scenes_enabled()` (reads the manifest),
so the latent tao bug only arms once an app declares a CarPlay scene - which is why the
CarPlay PR (#5085) also had to patch a use-after-free in this same function. Ships as a
tao submodule commit + pointer bump, NOT an app-repo change.

Dead ends that cost time (all disproven): entitlements/AMFI (TestFlight fresh install was
clean); Swift availability floors (SPM `platforms:` are compiler-enforced); the CarPlay
scene manifest being untracked/regenerated (`src-tauri/gen` IS gitignored and
`Readest_iOS/Info.plist` IS untracked, and Tauri merges the tracked `src-tauri/Info.plist`
into it - but iOS is built ONLY locally, so the hand-edit ships, and the 0.12.1
`.xcarchive` provably carries the manifest with `$(PRODUCT_MODULE_NAME)` resolved to
`Readest.CarPlaySceneDelegate`).

**`pnpm dev-ios-sim` fails with `failed to rename app ...: Directory not empty (os error
66)`** when `gen/apple/build/arm64-sim/Readest.app` already exists - `rename` returns
ENOTEMPTY for the DESTINATION, so `rm -rf` that dir (and the regenerated
`Readest_iOS.xcarchive`) before rebuilding. Also: `pnpm ... | tail` reports tail's exit
code, so a FAILED build looks like exit 0 - redirect to a log and echo `$?` instead.

**Superseded (kept for the reasoning trail):**
Spans iOS 15.5 -> 27.0, so it is not a UIKit strictness change. The delegate exists
(`gen/apple/Readest_iOS/CarPlaySceneDelegate.swift`, tracked), is compiled (4 pbxproj
refs), and the manifest DOES ship — the 0.12.1 `.xcarchive` carries
`UIApplicationSceneManifest` with `Readest.CarPlaySceneDelegate` correctly substituted.
Leading mechanism: `packages/tao` (submodule, fork `readest/tao`, wired via
`[patch.crates-io]`) `configuration_for_connecting_scene_session`
(`src/platform_impl/ios/view.rs:629`) IGNORES the connecting session's role and always
returns a `UIWindowSceneSessionRoleApplication` config with `TaoSceneDelegate`;
implementing that selector makes UIKit skip the Info.plist. Registration is gated on
`multiple_scenes_enabled()` (reads the manifest), so it only arms when CarPlay is
declared. Fix would be: honor `session.role`, and for other roles return
`configurationWithName(nil, role)` so UIKit resolves from the manifest. UNCONFIRMED —
does not explain why the CarPlay *simulator* reportedly works; user re-testing whether
tapping the Readest icon on the CarPlay home screen shows the list template, or whether
only audio/Now Playing was ever exercised (that path is MPNowPlayingInfoCenter and never
creates a scene).

**Two traps that cost time here.** (1) `build/Payload/Readest.app` is a STALE 0.11.1
artifact from 2026-05-30 — reading its Info.plist "proved" the manifest was missing on
device; always check `CFBundleShortVersionString` + mtime before drawing conclusions from
anything under `gen/apple/build/`. The live archive is
`build/Readest_iOS.xcarchive/Products/Applications/Readest.app`. (2) `pnpm test:rust`
failed with `failed to read plugin permissions ... /Users/chrox/dev/readest-pr-5562/...`
— build-script output caches in `target/debug/build/*/{output,root-output}` pin absolute
paths into DELETED worktrees, and `cargo clean -p` does NOT clear them. Fix:
`grep -rl <dead-path> target/debug/build | sed 's#\(target/debug/build/[^/]*\).*#\1#' |
sort -u | xargs -I{} rm -rf {}` (108 dirs here). Extends
[[worktree-shared-target-stale-plugin-cache]]. Note zsh does NOT word-split unquoted
`$VAR`, so `for d in $DIRS` over a newline list is a silent no-op — use xargs.

Related: [[window-title-book-name-a11y-5547]], [[ios-photos-add-usage-description-5397]],
[[feedback-no-mock-only-platform-tests]], [[worktree-shared-target-stale-plugin-cache]].
