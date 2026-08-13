---
name: onedrive-token-origin-aadsts90023
description: OneDrive connect fails on native builds with AADSTS90023 because tauri-plugin-http stamps an Origin header on every request; fix = unsafe-headers feature + empty Origin
metadata: 
  node_type: memory
  type: project
  originSessionId: 7ff6338e-1616-41a6-8fab-3311120c352c
  modified: 2026-08-09T15:47:38.338Z
---

**OneDrive OAuth token exchange died on the macOS app (2026-08-09) with `AADSTS90023: Cross-origin token redemption is permitted only for the 'Single-Page Application' client-type or 'Native' client-type with origin registered in AllowedOriginForNativeAppCorsRequestInOAuthToken allow list`.**

- Root cause is NOT our code: `tauri-plugin-http` (commands.rs, "ensure we have an Origin header set") appends the **webview origin to every native request** — `tauri://localhost` on macOS/iOS/Linux, `http://tauri.localhost` on Windows/Android. Microsoft classifies any token POST carrying an `Origin` as browser cross-origin redemption and refuses it for the Native client type our `readest-onedrive://auth` redirect registers under. Google's token endpoint ignores `Origin`, which is why the SAME shared `tokenEndpoint.ts` path works for Google Drive and only breaks for Microsoft.
- Plugin CHANGELOG 2.5.6: "Fixed an issue that caused the Origin header to always be `null` on macOS, iOS and Linux" — before that macOS sent `Origin: null`. `Cargo.lock` is gitignored and the dep is `version = "2"`, so a plain `cargo update` can flip this behaviour under you with no diff in the repo.
- Fix = two halves, BOTH required: send `Origin: ''` (plugin's documented opt-out, CHANGELOG 2.0.1) **and** enable the `unsafe-headers` feature on `tauri-plugin-http` in `src-tauri/Cargo.toml`. Without the feature the plugin skips the forbidden header at line ~203 and then re-adds the webview origin anyway, so the empty value alone is a silent no-op. `unsafe-headers` is app-wide: it also stops dropping `Referer`/`Cookie`/`Host`, so the deliberate `Origin`/`Referer` spoofs in `yandexShared.ts` and `edgeTTS.ts` now actually reach the wire.
- Applies to exchange AND the hourly refresh (both go through `requestTokens`), and to every native platform, not just macOS.
- Cannot be reproduced with a fake `code`: AAD validates the grant first and answers `AADSTS9002313` before it ever reaches the cross-origin gate, so curl probes with/without `Origin` look identical. Verify the header instead of the error.
- **MERGED #5604** (2026-08-09, 35e6a1601). Verified end to end: sign-in completes on macOS AND on the Xiaomi 13. `cargo tree -p tauri-plugin-http -f "{p} feats={f}"` shows the feature resolved; real Chromium silently DROPS `Origin: ''` so the web SPA flow is untouched.
- Device probe worth reusing: point the installed APK's own http plugin at a header-echo server on the LAN via CDP (`adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`, then `Runtime.evaluate` a raw `__TAURI_INTERNALS__.invoke('plugin:http|fetch'...)`). The sentinel request arrived with NO origin, the control with `origin: http://tauri.localhost` - proves both halves of the fix in a release build without needing any credentials.
- Related: [[onedrive-oauth-callback-slash-5253]] (#5479 fixed the redirect parse that was masking this — desktop never got far enough to hit the token POST before).
