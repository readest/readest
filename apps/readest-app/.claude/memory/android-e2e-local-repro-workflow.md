---
name: android-e2e-local-repro-workflow
description: "How to reproduce/debug the Android CDP e2e lane locally - emulator + dev-android caveats (run-as needs debug build, stale gen/android bakes dev-server URL), app-side window.__atLog tracing, MIUI install restriction"
metadata: 
  node_type: memory
  type: project
  originSessionId: 353e9c4d-b3c6-4eeb-9bf1-8254615b2d3d
---

Reproducing the nightly android-e2e lane locally (learned fixing the corner-dwell regression):

- Emulator: `~/dev/Android/sdk` (`ANDROID_HOME`), AVDs incl. `Pixel_9_Pro` (arm64, API 36). Boot headful: `emulator -avd Pixel_9_Pro -no-snapshot-load -port 5554`; then `ANDROID_SERIAL=emulator-5554 pnpm test:android <file>`.
- `pnpm dev-android` (release+devtools) is enough for `selection.android.test.ts` (CDP works) but NOT `double-click.android.test.ts` — its `patchGlobalViewSettings` uses `run-as`, which needs a DEBUG build (`pnpm tauri android build --debug --target aarch64`, like CI). Release+debug builds can't `install -r` over each other (signature mismatch) — uninstall first.
- Stale `src-tauri/gen/android` from a previous `tauri android dev` bakes the DEV SERVER URL into the APK (app shows "Failed to request http://192.168.x.x:3000"). CI avoids it by `rm -rf src-tauri/gen/android && pnpm tauri android init` before building. `pnpm dev-android` also produced a correct bundled build.
- Suite flake: `openFixtureBook`/`longPressWord` occasionally time out right after install/force-stop; `adb shell am force-stop com.bilingify.readest`, wait ~3s, re-run.

**Debug methodology that cracked it:** deduction from CDP alone stalled; the decisive step was temporary app-side tracing — an `atlog()` pushing `{t: performance.now(), ev, ...}` into `window.__atLog` from useAutoPageTurn/useTextSelector AND packages/foliate-js/paginator.js (submodule is bundled, editable locally), then a scratch `*.android.test.ts` that runs the exact failing `motionGesture` and dumps `window.__atLog`. Millisecond ordering of engage/armDwell/turnBegin/cssAnim/turnSettled/reanchor/PIN exposed the root cause ([[captured-turn-void-promise-autoturn-revert]]) in one run. Revert instrumentation with `git checkout` (submodule too).

- Xiaomi/MIUI physical device: `adb install` fails with `INSTALL_FAILED_USER_RESTRICTED: Install canceled by user` until the user approves the on-phone dialog (or enables "Install via USB"); just retry while they watch the phone. Version downgrades also blocked (`INSTALL_FAILED_VERSION_DOWNGRADE`) — uninstall first.
