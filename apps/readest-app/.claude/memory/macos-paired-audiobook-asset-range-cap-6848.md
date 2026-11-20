---
name: macos-paired-audiobook-asset-range-cap-6848
description: "#6848 macOS paired M4B silent: asset protocol 1,000 KiB range cap, fixed by the loopback media proxy (#7037, DMG fine from 0.12.20); the MAS build stayed silent because its sandbox lacked network.server, so the proxy can't bind. Local Entitlements-appstore.plist fixed 2026-11-20, ships with the next MAS build"
metadata:
  node_type: memory
  type: project
  originSessionId: 665e82a1-683d-484e-a9b0-b2943711dd57
  modified: 2026-11-19T17:25:07.215Z
---

Root cause, reproduced 2026-10-24 on main 1923204fe (macOS dev build) with the reporter's files in `~/Documents/books/issues/6848/`. Desktop played paired audio via `convertFileSrc`, and Tauri's asset handler caps each range response at `MAX_LEN = 1000 * 1024` (`packages/tauri/crates/tauri/src/protocol/asset.rs`). WebKit gives up when the `moov` atom is bigger than that. iOS/Android use native players and web uses a blob, so they are unaffected.

Fix 1: MERGED #7037 as e2486ecbc on 2026-10-24. `getLocalMediaUrl(path, type)` in `services/audiobook/mediaProxy.ts` calls `get_media_file_url`, a Rust `TcpListener` on 127.0.0.1 (`src-tauri/src/media_proxy.rs`). It is used by TTSController's paired `resolveUrl` and `preview.ts`, falling back to `convertFileSrc`.

**Mac App Store build still silent (reporter, 0.12.20, 2026-11-09):** the MAS app is sandboxed, and `Entitlements-appstore.plist` had `network.client` but not `com.apple.security.network.server`, so `bind(127.0.0.1)` fails with EPERM. `get_media_file_url` errors, and the player falls back to `convertFileSrc`, i.e. the original bug. Fix 2 (2026-11-20): added `network.server` to the local, gitignored `src-tauri/Entitlements-appstore.plist` and `-dev.plist` (`.gitignore` `Entitlements*.plist`, no repo change). It reaches users only with the next `pnpm release-macos-universial-appstore`.
- The same entitlement gap also blocked every other loopback listener on MAS: LocalSend receive (53318+), `clip_url` (Send/RSS/novel page capture), and the `tauri-plugin-webdriver` test server.
- `single_instance failed to listen … Operation not permitted` also shows under the sandbox. It is unrelated and harmless.

**Sandbox test recipe (no MAS signing needed):**
- Build `tauri build --debug --features webdriver --bundles app --no-sign --config '{"identifier":"com.bilingify.readest.sbx6848","build":{"beforeBuildCommand":"pnpm build"},"bundle":{"createUpdaterArtifacts":false}}'` with `NEXT_PUBLIC_DIST_CHANNEL=appstore`. The override drops `upload-sourcemaps`, which would upload to Sentry.
- Copy the bundle, delete `CFBundleURLTypes`, and `codesign -f -s - --entitlements X.plist`. X is the MAS plist minus the provisioning-restricted keys (applesignin, icloud, ubiquity, application-identifier, team-identifier).
- Never use the real id: `~/Library/Containers/com.bilingify.readest` holds real MAS data.
- Stage files in `~/Library/Containers/<id>/Data/Library/Application Support/<id>/stage/` ($APPDATA is in fs scope).
- `__TAURI_INTERNALS__.invoke` is non-writable, so patch `window.fetch` for `ipc://localhost/plugin%3Adialog%7Copen` and answer `new Response(JSON.stringify(paths), {headers: {'Content-Type': 'application/json', 'Tauri-Response': 'ok'}})`.
- Menus need a `pointerdown` before `.click()`.
- Without `network.server`, the webdriver thread panics on bind but the app keeps running.
- Afterwards, `lsregister -u` the bundles. Only the container's `.containermanagerd.metadata.plist` can't be removed from a shell.

Verified 2026-11-20 in a sandboxed debug build with the fixed entitlements:
- Preview and Read Aloud played through `http://127.0.0.1:<port>/…/file/…`, audible on BlackHole (440 Hz band carries the energy), and a seek to 5:14:00 kept playing.
- The `asset://` fallback in the same app gave `NotSupportedError: The operation is not supported.` (MediaError 4).
- NOT run: an actual App Store-signed build.

Still open: offline-downloaded ABS books on desktop (`openAudiobook.ts:230`) still use `convertFileSrc`.

Related: [[narration-ios-file-window-6989]], [[macos-narration-audio-capture-recipe]], [[desktop-dev-window-webdriver-recipe]], [[play-build-stripe-fallback-cn-xiaomi]].
