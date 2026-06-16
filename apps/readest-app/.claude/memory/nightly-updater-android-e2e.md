---
name: nightly-updater-android-e2e
description: "How to E2E-test the nightly self-updater on a real Android (Xiaomi/HyperOS) device — devtools build, CDP-over-adb, MIUI install gates"
metadata: 
  node_type: memory
  type: reference
  originSessionId: b0c01e3c-9485-45fe-8ae3-eb5f2762f8fa
---

End-to-end validating the in-app nightly updater (#4577) on the physical Xiaomi 13 (`fuxi`, model 2211133C, HyperOS V816 / Android 16, arm64). Verified the full chain: stable `0.11.4` on nightly channel → fetch `nightly/latest.json` → detect newer nightly → dialog+changelog → download APK → minisign-verify → Android PackageInstaller → app relaunches as `0.11.4-2026061506` with user data intact.

**Get CDP on a release build:** `pnpm dev-android` = `tauri android build -t aarch64 -- --features devtools` then `adb install -r`. The `devtools` cargo feature enables WebView remote debugging; the **CI nightly has no such flag → no CDP socket**. The local build is release-signed via `src-tauri/gen/android/keystore.properties` (alias `upload`, keystore at `/Users/chrox/dev/Android/keys/upload-readest-keystore.jks`), cert SHA-256 `652d1167…` — SAME as the CI release/nightly cert, so it installs over (and is replaced by) the real nightly. versionCode for `0.11.4[-stamp]` is always `11004` (Tauri ignores the prerelease), and sideload allows equal versionCode. After the updater installs the real nightly, CDP is gone again (no devtools).

**Comparator (`utils/version.ts` `isUpdateNewer`):** on equal X.Y.Z, a nightly outranks the matching stable (`c.isNightly && !cur.isNightly → true`). So a stable build on the nightly channel IS offered the latest nightly — no need to stamp an older version. Two nightlies compare by the 10-digit stamp.

**CDP-over-adb gotcha:** `adb forward tcp:9333 localabstract:webview_devtools_remote_<PID>` (use the LIVE pid — stale sockets for dead pids linger in `/proc/net/unix`). The WebView's `/json` HTTP server breaks BOTH curl and Node `http` (framing → "empty reply"/"socket hang up"); fetch the page list over a RAW TCP socket instead, and build the ws URL yourself as `ws://127.0.0.1:9333/devtools/page/<id>` (the returned `webSocketDebuggerUrl` reflects the request Host header and drops the port). Then `Runtime.evaluate` works. Helper pattern lived in `/tmp/nightly-test/cdp.cjs`. Settings store is NOT on `window`; drive the real UI via evaluated `.click()` (Settings Menu → "Nightly Builds (Unstable)" toggle → "About Readest" → "Check Update").

**MIUI/HyperOS install gates (the hard part; needs adb taps + uiautomator, NOT WebView):** (1) "Readest 正尝试安装应用" → tap 继续. (2) "Couldn't find ICP registration info" (China-region nag) → tap **Install** (left grey), NOT the blue Exit. (3) Enhanced-protection installer shows NO direct install button — the visible "安装" is the AD app's (`installBtn`, `com.aliyun.tongyi` etc. — don't tap it); the real path is top-right **More (⋮) → "单次安装授权"** (one-time auth), then the bottom **OK**. "Security authorization → Authorize unverified apps" uses Face-unlock as the verification method (per-install biometric; single-install-auth covered it here). Use `uiautomator dump` to get exact button bounds — native dialogs are introspectable (unlike the WebView). Pin every adb cmd with `ANDROID_SERIAL` when an emulator is also attached; zsh doesn't word-split `$ADB` vars (use the env var or inline the full path).
