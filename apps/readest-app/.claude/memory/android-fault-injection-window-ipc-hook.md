---
name: android-fault-injection-window-ipc-hook
description: How to force a Tauri command to fail on an Android device (fault injection for a fallback path) — hook window.ipc.postMessage over CDP; __TAURI_INTERNALS__.invoke is non-writable and Android does NOT use the fetch IPC transport
metadata:
  type: project
---

To device-verify a **fallback** path whose trigger doesn't reproduce on the Xiaomi
(e.g. #6367: HarmonyOS rejects the MediaStore insert, Xiaomi doesn't), inject the
failure at the IPC boundary instead of patching the app. Everything above the
boundary (component → appService → `utils/bridge.ts`) then runs unmodified.

**Two hooks that do NOT work on Android — both fail silently:**
- `window.__TAURI_INTERNALS__.invoke = ...` — the property is
  `writable: false, configurable: false`, so the assignment is a silent no-op in
  non-strict eval. Same for `ipc`, `postMessage`, `runCallback`. Verify a hook
  took with `Object.getOwnPropertyDescriptor` before trusting a "clean" result.
- Hooking `window.fetch` — that is the *custom protocol* transport
  (`canUseCustomProtocol`). On this Android build it is never used; nothing is
  logged. Desktop/CEF may differ.

**What works:** `window.ipc` IS writable+configurable (it is wry's
`with_ipc_handler` object). Replace it wholesale; the message is JSON with
`{cmd, callback, error, payload}`, and a reply is delivered by calling
`__TAURI_INTERNALS__.runCallback(m.callback, <result>)` — the SAME callback id
for both ok and error, so resolving with the command's own failure shape
(`{success: false, error: '...'}`) is how you fake a soft failure.

```js
const orig = window.ipc;
window.__ipcLog = [];
window.ipc = { postMessage: (data) => {
  const m = JSON.parse(data);
  window.__ipcLog.push(m.cmd);
  if (m.cmd === 'plugin:native-bridge|save_image_to_gallery') {
    setTimeout(() => window.__TAURI_INTERNALS__.runCallback(m.callback,
      { success: false, error: 'simulated' }), 0);
    return;            // never reaches native
  }
  return orig.postMessage(data);
}};
await window.__TAURI_INTERNALS__.invoke('plugin:app|version'); // prove the hook is live
```

`__ipcLog` doubles as the proof the fix ran: the #6367 fallback logged
`fs|write_file → native-bridge|save_image_to_gallery → fs|remove → dialog|save`.
Confirm the native side really was skipped with an independent count (gallery
file count unchanged), not just the log. `am force-stop` drops the hook.

Driving it: `scripts/cdp.mjs` works against a device with
`adb forward tcp:9223 localabstract:webview_devtools_remote_$(adb shell pidof com.bilingify.readest)`
+ `CDP_PORT=9223`. See [[android-cdp-e2e-lane]] for the fixture VIEW-intent open,
and [[computer-use-tauri-dev-binary-no-bundle-id]] for screenshots.

**Xiaomi install trap:** the phone usually carries the Play Store build, so a
locally signed APK dies with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`; `adb install -r`
does NOT help — the Play copy must be uninstalled (chrox's call, it wipes app
data). MIUI then shows an on-device "Install via USB" prompt that must be tapped
or the install returns `INSTALL_FAILED_USER_RESTRICTED`.
