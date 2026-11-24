---
name: ios-device-screenshot-and-install-recipe
description: "Seeing the user's iPhone = iPhone Mirroring via computer-use (idevicescreenshot is dead on iOS 17+); pnpm dev-ios install can hang at \"Installing\" after the app already updated"
metadata:
  node_type: memory
  type: reference
  originSessionId: b174d860-b0a7-4d4f-a0ca-d23740834e49
  modified: 2026-11-12T10:08:09.443Z
---

**Screenshots WITHOUT Mirroring (2026-11-04, iPad Air M2 on iPadOS 27, Xcode 27):** `xcrun devicectl device capture screenshot --device <UDID> --destination out.png` saves a full-res PNG (1640x2360) in ~2 s; `capture screen-record` exists too. Pair with `ios_webkit_debug_proxy -c <UDID>:9322 -F` + a WebKit-protocol eval script (see [[ios-sim-webview-drive-via-iwdp]]) to drive a devtools build headlessly. Untested on iOS 18 iPhones.

**Screenshots of the user's iPhone (2026-10-14, iPhone XS Max on iOS 18.7):**
- `idevicescreenshot` fails with "Invalid service" even after `xcrun devicectl device info ddiServices` mounts the DDI: iOS 17+ moved screenshotr behind RemoteXPC tunnels (pymobiledevice3 + sudo tunneld, not installed).
- What works: computer-use `request_access(["iPhone Mirroring"])`, open it, screenshot/zoom. The user must unlock the phone and pass Touch ID / Mac password in the Mirroring window themselves; never type the password. Mirroring also shows live app state (TTS mini player, sheets), good for verifying UI fixes.

**iPhone XS Max (iOS 18.7) update, 2026-11-12 (PR #7418):**
- `xcrun devicectl device capture screenshot` DOES work on it (unlocked or locked; locked = black frame). Install/launch: `devicectl device install app` / `device process launch --terminate-existing`.
- Mirroring connects only while the phone is LOCKED ("iPhone in Use" otherwise); ask the user to press the side button.
- Mirroring click wedge: after a few plain `left_click`s every click (menu bar too) is swallowed. Fix: `mouse_move` onto the Mirroring window, `left_mouse_up`, Escape; then send EVERY tap as `mouse_move` + `left_mouse_down` + `left_mouse_up`. Sheet swipe-to-dismiss doesn't work; use the picker's Cancel (at its Browse root).
- Never type through Mirroring on this phone: the Chinese IME garbles it into endless "aaaa" / accent popups. Change inputs on the Mac side instead (e.g. make fixtures pass the import 20 KB min-size filter).
- Read app state without UI: `devicectl device copy from --domain-type appDataContainer --domain-identifier com.bilingify.readest --source "Library/Application Support/com.bilingify.readest/Readest/Books/library.json"`. Inspector on device: `ios_webkit_debug_proxy -c <UDID>:9322 -F`, pages at `localhost:9322/json`.
- To test the App Store gate on device: `NEXT_PUBLIC_DIST_CHANNEL=appstore pnpm exec dotenv -v KEEP_SOURCEMAPS=1 -e .env.tauri -- tauri ios build -- --features devtools` (dev-ios alone leaves the channel unset); confirm `canCustomizeRootDir=!1` in `out/_next/static/chunks`.

**`pnpm dev-ios` (tauri ios build + `ideviceinstaller install`):**
- Takes several minutes (Next build + Xcode). Watch the log for `BUILD SUCCEEDED`, then `Install: Complete`.
- The install step sometimes hangs at `Installing 'com.bilingify.readest'` with no progress although the new build is already running on the phone (seen with Readest open and playing TTS). Confirm via Mirroring, then kill the `ideviceinstaller` pid; don't wait on it.
- Each `dev-ios` bakes the web bundle at the start of the build: changes made while it compiles are NOT in that install. Check the ipa mtime vs. the edit time before telling the user a fix is on the device.

Related: [[ios-worktree-device-build-gotchas]], [[build-ci-recipes]].
