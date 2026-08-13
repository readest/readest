---
name: cdp-android-webview-profiling
description: "How to drive the Android WebView via CDP (adb) to run JS probes/benchmarks inside the live Readest app, and the gotchas that waste time"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 8057ac9c-2e3e-446d-86aa-29baddfbfe66
  modified: 2026-08-12T15:03:21.070Z
---

Driving the on-device Readest WebView via CDP to run JS probes/benchmarks **inside the live app** (no rebuild) — used for the NativeFile/RemoteFile I/O study ([[android-nativefile-remotefile-io]]).

**Setup:** app must be running → `adb shell cat /proc/net/unix | grep webview_devtools_remote_<pid>` → `adb forward tcp:9222 localabstract:webview_devtools_remote_<PID>`. Discover targets with a Node `http.get` to `/json/list` (set header `Host: localhost`) — **curl mishandles the WebView's HTTP framing and hangs/returns empty**. Connect `ws://127.0.0.1:9222/devtools/page/<id>`, then `Runtime.enable` + `Runtime.evaluate {expression:'(async()=>{...})()', awaitPromise:true, returnByValue:true}`. Helper scripts kept in `/tmp/cdp/` (eval.mjs, disc.mjs).

**Getting a debuggable build at all (2026-08, Xiaomi 13):**
- A **store/release APK has NO `webview_devtools_remote_<pid>` socket** — there is nothing to forward to. Rebuild+install with `pnpm dev-android` (adds `--features devtools`), then re-read `/proc/net/unix`.
- `@chrome_devtools_remote` in `/proc/net/unix` is a **red herring**: that socket belongs to the Chrome app, not Readest. Forwarding to it returns an empty `/json/list`.
- `/json/list` advertises `"webSocketDebuggerUrl": "ws://localhost/devtools/page/<id>"` with **NO PORT**. Connecting to it verbatim throws a bare `ErrorEvent`; rewrite the authority to `127.0.0.1:9222` first.
- Node's `http.get` to `/json/list` hung here (2 min, no response); a raw `net.connect` writing `GET /json/list HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n` and slicing the JSON out of the reply worked every time. Prefer the raw socket.
- `adb shell uiautomator dump` exposes **no nodes for WebView content**, so UI can't be driven by accessibility text — drive via CDP `Runtime.evaluate` (click React elements directly), or fall back to `adb shell input tap` with `adb exec-out screencap`.
- Watch for duplicate labels across mounted-but-hidden dialogs: several Readest import dialogs each render an "Import"/"Cancel" button, so `find(b => text === 'Import')` can hit the wrong one. Anchor on a sibling unique to the target dialog (e.g. the "Back" button) and search within its row.

**Gotchas that burned time:**
- **Locked device freezes `fetch`.** When the screen is locked the page is `visible:false`; Chromium freezes the network task queue so EVERY `fetch()` (same-origin and asset) hangs forever — but Tauri `invoke()` still resolves. Must have the user **unlock + keep Readest foregrounded**. Set `svc power stayon true` + `settings put system screen_off_timeout 1800000` after unlock (revert `stayon false` when done).
- **`visible:false` also throttles `setTimeout`** (background timer coalescing → ~60 s). Don't rely on setTimeout guards in probes when the page may be hidden; `invoke`-only probes still work hidden.
- `window.__TAURI_INTERNALS__` is ALWAYS injected (independent of `withGlobalTauri`) → use `.convertFileSrc(path)` and `.invoke(cmd,args)` from injected JS. Android asset URL = `http://asset.localhost/<encodeURIComponent(path)>`.
- Real book files live in **internal** storage (`/data/user/0/com.bilingify.readest/...`), not the external `Android/data/.../files` dir (that's `forbidden path` to the fs plugin). `$APPCACHE` = `/data/user/0/com.bilingify.readest/cache` holds import temp copies (in asset scope `$APPCACHE/**/*`). `adb run-as` is denied on the release build.
- fs plugin invokes: `plugin:fs|open{path,options}→rid`, `seek{rid,offset,whence}` (Start=0), `read{rid,len}`→ArrayBuffer whose **last 8 bytes are bigendian nread**, `close{rid}` (**not ACL-allowed** in the installed build). `read_dir`/`stat` on out-of-scope abs paths return `forbidden path`. Tauri v2 `BaseDirectory`: AppData=14, AppLocalData=15, AppCache=16.
- zsh: `$PIPESTATUS[0]` is a bash-ism (empty in zsh; use `$pipestatus[1]`) — don't trust it for exit codes.
