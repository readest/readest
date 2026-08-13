---
name: android-oauth-passkey-no-credential-provider
description: "Android OAuth stuck forever on Microsoft's 'Face, fingerprint, PIN or security key' page = device has NO Credential Manager provider enabled, not a Readest/Custom Tab bug"
metadata: 
  node_type: memory
  type: project
  originSessionId: 7ff6338e-1616-41a6-8fab-3311120c352c
  modified: 2026-08-09T15:20:38.447Z
---

**Symptom (Xiaomi 13 / fuxi, Android 16, 2026-08-09): OneDrive sign-in reaches Microsoft, then hangs forever on "Face, fingerprint, PIN or security key — Your device will open a security window."** The spinner never stops and the passkey sheet never appears.

- This is AAD's **WebAuthn/passkey** page. Chrome hands `navigator.credentials.get()` to Android's Credential Manager (API 34+), which on this phone has **no provider enabled**: `settings get secure credential_service` is EMPTY and `credential_service_primary` is `null` (checked via `adb shell settings list secure | grep -i credential`). Nothing serves the request, so it never resolves and never errors.
- The stuck request wedges WebAuthn **device-wide**, and the wedge outlives `am force-stop` of BOTH `com.android.chrome` and `com.google.android.gms` — it lives in the `credential` system service. Tell: a probe against an unrelated site in *regular* Chrome comes back `OperationError: A request is already pending`. Only a reboot clears it. GMS logs `getNumberOfCredentialsWithIssueOperation, opStatusCode=43502`.
- NOT caused by the Chrome Custom Tab, `runAndroidOAuth`, or anything Readest sends — plain Chrome fails identically, and Google accounts + GMS are present. There is no AAD parameter to suppress passkey; the escape hatch is Back → "Other ways to sign in" → password.
- Instrument that made this fast, no app rebuild needed: `adb forward tcp:9222 localabstract:chrome_devtools_remote`, then drive `Runtime.evaluate` over CDP against a live tab (python `websocket-client` needs `suppress_origin=True` or Chrome 403s the handshake). Custom Tab pages do NOT appear in `/json/list` — only regular Chrome tabs do, so screenshot the CCT with `adb exec-out screencap -p` instead.
- Separate real gap found while reading the code: `auth_with_custom_tab` (`NativeBridgePlugin.kt:462`) parks `pendingInvoke` and only ever resolves from `onNewIntent`. Dismissing the Custom Tab, or any dead-end like this one, leaves the JS promise pending FOREVER with `pendingInvoke` still set. UNFIXED.
- Related: [[onedrive-token-origin-aadsts90023]] (the macOS half of the same OneDrive sign-in, fixed the same day).
