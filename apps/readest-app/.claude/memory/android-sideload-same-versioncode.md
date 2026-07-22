---
name: android-sideload-same-versioncode
description: Android sideloaded APK reinstall allows EQUAL versionCode; only strictly-lower is blocked
metadata: 
  node_type: memory
  type: reference
  originSessionId: a58a4eba-7a3c-4560-9b52-e3713c6ad211
---

Sideloaded APK installs (Readest's in-app updater path: `installPackage` → `Intent.ACTION_VIEW` with `application/vnd.android.package-archive` → system package installer, NOT Play Store) permit reinstalling an APK whose `versionCode` is **equal** to the currently installed one — it's an in-place reinstall/update as long as the signing certificate matches. Android's `INSTALL_FAILED_VERSION_DOWNGRADE` only triggers for a **strictly-lower** versionCode. (Play Store, by contrast, requires a strictly-incrementing versionCode — that constraint does NOT apply to sideload.)

Consequence for the nightly update channel ([[android-open-with-intent-flow]] uses the same NativeBridge install path): Tauri derives `versionCode = major*1000000 + minor*1000 + patch`, dropping any prerelease suffix, so all nightlies on base `0.11.4` share `versionCode=11004`. That is FINE — they reinstall over each other and over stable `0.11.4`. Because the base only ever increases (0.11.4 → 0.11.5 → ...), nightly versionCode is monotonic non-decreasing, so there is never a downgrade. No need to derive a per-build versionCode from the date stamp. The app's `versionName` carries the full `0.11.4-2026061406` string, which is what the JS `getAppVersion()` updater comparison uses.

A plausible-but-wrong review claim ("same versionCode means Android refuses the install as not-an-upgrade") confuses Play Store rules with sideload behavior. Corrected by the project owner 2026-06-14.
