---
name: ios-sim-pwa-webclip-cli-recipe
description: "Run Readest as a Home Screen web app (standalone PWA) in the iOS simulator and drive it with no computer use - install a .webclip bundle by hand, tap with a file-fed XCUITest runner, inspect with iwdp"
metadata:
  node_type: memory
  type: reference
  originSessionId: 574e78aa-e8fe-4e82-925f-5be5891f9544
  modified: 2026-11-25T07:56:10.792Z
---

Worked 2026-11-25 verifying PR #7888 (iOS PWA top scroll-edge blur) on an iPhone 18 Pro sim, iOS 27.0, while computer use was locked by another session.

- **Runtime**: the iOS 27.1 sim runtime only accepts the iPhone Duo (`simctl create` with any other type fails "Incompatible device"); use 27.0 for a normal iPhone.
- **Web clip without tapping Share**: copy a `.webclip` bundle into `~/Library/Developer/CoreSimulator/Devices/<UDID>/data/Library/WebClips/<UPPERHEX32>.webclip/` (Info.plist with `URL`, `Title`, `FullScreen=true`, `PlaceholderBundleIdentifier=com.apple.WebKit.PushBundle.<ID>`, plus `icon.png` and `ApplicationManifest`), then reboot the sim. A template from an earlier session lives on sim 67FB533F (iPhone 17 Pro 7770). The icon lands on Home Screen page 2.
- **Launching it**: `simctl openurl webapp:<ID>` fails (LSApplicationWorkspace error 115, the scheme is private). Tap the icon instead.
- **Tapping without computer use**: xcodegen project with an empty host app plus a `bundle.ui-testing` target (needs `GENERATE_INFOPLIST_FILE: YES`). Its one test loops, reading commands from a host file (seq id on line 1, then `tap x y`, `swipe x1 y1 x2 y2`, `home`, `sleep s`, `quit`) and acks to another file. Taps go through `XCUIApplication(bundleIdentifier: "com.apple.springboard").coordinate(...).withOffset(...)`, so they work over any foreground app. Build with `CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO`, then run `test-without-building` in the background. Never enumerate `sb.icons`: web clip icons (SBBookmarkIcon) fail the snapshot and end the test.
- **JS in the web app**: `ios_webkit_debug_proxy -s unix:<webinspectord_sim.socket> -F`; the clip's page is at `:9222/json`. Route with `window.next.router.push(...)`; a search-param-only change to `/reader` needs `location.href` to reinit. iwdp also exposes the owner's physical iPhone on 9223: don't touch it, and stop iwdp when done.
- **Before/after on one clip**: run `dev-web -H 0.0.0.0 -p 3000` in the PR worktree and swap files with `git checkout origin/main -- <files>` / `git checkout HEAD -- <files>`, then `location.reload()` (HMR alone sometimes kept the old module). Don't run the full suite while files are swapped. Both checkouts overwrite uncommitted edits in those files: `git status --short -- <files>` must be empty first, so commit (not stash: [[feedback-stash-shared-across-worktrees]]), or compare in a clean worktree.
- **Measuring the PWA top band**: the web viewport starts below the status bar (innerHeight 812 of 874pt), so the top ~186px of a screenshot is WebKit's painted extension. Sample `p{600,20}` with `magick` to read its colour. Catch 300ms fades with `simctl io recordVideo` + `ffmpeg fps=30`, or a rAF recorder in the page.

Related: [[ios-sim-webview-drive-via-iwdp]], [[ios-sim-drive-via-dev-server-relay]].
