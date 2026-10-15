---
name: ios-device-screenshot-and-install-recipe
description: Seeing the user's iPhone = iPhone Mirroring via computer-use (idevicescreenshot is dead on iOS 17+); pnpm dev-ios install can hang at "Installing" after the app already updated
metadata:
  type: reference
---

**Screenshots of the user's iPhone (2026-10-14, iPhone XS Max on iOS 18.7):**
- `idevicescreenshot` fails with "Invalid service" even after `xcrun devicectl device info ddiServices` mounts the DDI: iOS 17+ moved screenshotr behind RemoteXPC tunnels (pymobiledevice3 + sudo tunneld, not installed).
- What works: computer-use `request_access(["iPhone Mirroring"])`, open it, screenshot/zoom. The user must unlock the phone and pass Touch ID / Mac password in the Mirroring window themselves; never type the password. Mirroring also shows live app state (TTS mini player, sheets), good for verifying UI fixes.

**`pnpm dev-ios` (tauri ios build + `ideviceinstaller install`):**
- Takes several minutes (Next build + Xcode). Watch the log for `BUILD SUCCEEDED`, then `Install: Complete`.
- The install step sometimes hangs at `Installing 'com.bilingify.readest'` with no progress although the new build is already running on the phone (seen with Readest open and playing TTS). Confirm via Mirroring, then kill the `ideviceinstaller` pid; don't wait on it.
- Each `dev-ios` bakes the web bundle at the start of the build: changes made while it compiles are NOT in that install. Check the ipa mtime vs. the edit time before telling the user a fix is on the device.

Related: [[ios-worktree-device-build-gotchas]], [[build-ci-recipes]].
