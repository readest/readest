---
name: android-configchanges-navigation-recreate-5799
description: "#5799 BT HID page turner hotplug recreated the Android activity; missing `navigation` in configChanges"
metadata: 
  node_type: memory
  type: project
  originSessionId: 40cdf5ab-e9db-4be9-beee-d1030decd20d
  modified: 2026-08-20T16:57:48.747Z
---

Issue #5799 (Android): connecting/disconnecting a Bluetooth HID page turner (Hanlinyue Free3-M) while a book is open recreated `MainActivity`, dumped the user back to `/library`, and reset reader runtime state (page-turn animation reverts to default, immersive/fullscreen lost so the status bar overlays the top). Full quit+relaunch restored it (prefs were never wiped; only the transient WebView state was).

**Root cause:** Android recreates an activity on any configuration change whose flag is NOT in `android:configChanges`. A BT HID controller connect/disconnect changes `Configuration.navigation` (`CONFIG_NAVIGATION` 0x40). The gen manifest handled `keyboard|keyboardHidden` but not `navigation`, so the hotplug forced a recreate. Google's controller doc prescribes `keyboard|keyboardHidden|navigation`.

**Fix — MERGED #5804 (`aca1fa111`):** add `navigation` to `configChanges` in `src-tauri/gen/android/app/src/main/AndroidManifest.xml` (`0x0fb4` -> `0x0ff4`). One-line diff. That manifest is TRACKED and hand-maintained (readest edits it heavily) — NOT regenerated per build; the Tauri CLI template still lacks navigation too.

**On tao 0.35.3 / wry 0.55.1 the recreation is worse than reported:** the recreated WebView is fully DEAD — blank screen + repeating `RustStdoutStderr: custom protocol timed out: timed out waiting on channel` (wry `tauri://localhost` asset loader never reconnects to the new webview; wry#1551, 30s timeout). So preventing the recreation is the only real fix; recreation recovery itself is broken upstream and out of scope. This means OTHER unhandled config changes (fontScale, physical keyboard, etc.) still nuke the WebView — separate deeper issue, flagged not fixed.

**Verified on Xiaomi 13 (368b0948), build 0.12.1 vc12001:** reproduced recreation via `settings put system font_scale` proxy (a config flag also absent from the list) -> back to `/library` + blank WebView + custom-protocol-timeout. Built the fix WITHOUT a full Rust rebuild by binary-patching the byte in the compiled manifest inside the existing signed APK (apktool full res-rebuild fails on aapt; instead `unzip AndroidManifest.xml`, flip offset 13416 `0xB4`->`0xF4`, `zip` back, zipalign, apksigner with `/Users/chrox/dev/Android/keys/upload-readest-keystore.jks` alias `upload`) -> installed -> `aapt2 dump xmltree` shows `configChanges=0x00000ff4`, app opens books + immersive intact (no regression). Baseline APK reinstalled after.

**NOT verified:** the actual BT-HID hotplug on the patched build — needs the physical Free3-M (no adb way to synthesize a `navigation` config change on a non-rooted phone). Reporter already verified the pre-fix crash with the hardware.

See [[feedback-always-verify-on-xiaomi]] for the CDP recipe; wry/tao are the readest fork submodule at `packages/tauri` / cargo registry.
