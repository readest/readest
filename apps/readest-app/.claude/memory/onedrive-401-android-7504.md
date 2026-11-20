---
name: onedrive-401-android-7504
description: "#7504 OneDrive 401 on Android NOT reproduced (2026-11-19); asked reporter for details. Side findings: cover upload never retried, native HTTP invisible to DevTools, callbacks-Map hook recipe"
metadata:
  node_type: memory
  type: project
  originSessionId: 72be234f-cf67-4e64-aaac-454e412750dc
  modified: 2026-11-19T13:35:16.069Z
---

**#7504 (OneDrive 401 on Android 0.12.20): NOT reproduced on the Xiaomi 13, 2026-11-19.** Fresh connect (owner signed in with GitHub; the passkey "security window" never opened from the Custom Tab), full pass, progress push + pull, token refresh at app launch: no 401 from Graph or the token endpoint. Reply posted asking for the error screenshot, when it starts, account type, sync settings (issuecomment-7010683405). Untested: access-token expiry while the app stays running (~60 min after launch), plus the fact that no code path refreshes and retries on a Graph 401 before the stored expiry.

Side findings (not filed yet, the owner was asked):
- Failed `pushBookCover` is swallowed (engine.ts ~1217) and the book is indexed as synced, so the cover is never retried (8b73bb88 cover still 404 two passes later).
- Two failed config uploads at 06:22 weren't retried until a restart 7 h later, while "Last synced" said 06:25. Cause not found.
- Discovery (engine.ts ~1022) lists each remote book dir sequentially, ~2 s each on OneDrive: a 753-dir remote took ~25 min, with no progress text (only "Syncing…"). Killing the app restarts it from scratch.
- Readest Cloud 422 `kind=bookshelf fields validation failed` was deploy skew: phone on main (#7421 itemOrder) vs web.readest.com older; the owner deployed and it cleared. web is deployed by hand (`pnpm deploy`), not on merge.

**Inspecting native HTTP on a device:** tauri-plugin-http and transfer_file.rs requests go through Rust reqwest, so chrome://inspect Network can't see them. `__TAURI_INTERNALS__.invoke/ipc/postMessage` are non-writable, but `__TAURI_INTERNALS__.callbacks` is a Map: wrap its `set` and log callback payloads that have `status`+`url` (fetch_send results). Hook dies on WebView reload. Graph calls from CDP: refresh with the keychain refresh token (`plugin:native-bridge|get_secure_item` key `onedrive_token_set`) via `plugin:http|fetch` with `Origin: ''`, save the rotated refresh token back. Scripts were in the session scratchpad (monitor.mjs, odtoken.js).

Related: [[onedrive-sync-provider]], [[onedrive-token-origin-aadsts90023]], [[feedback-always-verify-on-xiaomi]].
