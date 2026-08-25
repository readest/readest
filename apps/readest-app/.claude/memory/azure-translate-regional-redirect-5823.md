---
name: azure-translate-regional-redirect-5823
description: "Issue #5823 \"Unable to fetch the translation\" - reporter's bug is #5620 (unreleased in 0.12.1); branch fix/azure-translate-5823 adds Bing regional-host POST + popup error detail; verification recipe (NO_PROXY on Mac, fault injection on Xiaomi)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 9890cfa7-ea81-40cd-9c4c-ec33fff870d6
  modified: 2026-08-22T17:52:12.695Z
---

Issue #5823 (2026-08-22, Windows 0.12.1, Azure Translator, Auto Detect -> Indonesian, "Unable to fetch the translation. Try again later."):

- Root cause of the reporter's symptom = maximized culture codes (`id-ID`, Bing answers `{"statusCode":400}`), FIXED by #5620 (merged 2026-08-11) but NOT in 0.12.1 (tagged 2026-08-08). Nothing to code for that; it ships with the next release.
- PR #5826 MERGED 2026-08-23 (`a4358d22e`); issue #5823 auto-CLOSED; worktree + local branch removed (`pnpm worktree:rm`); the drafted issue comment was NOT posted. After a rebase that bumps the foliate-js pin, the pre-push vitest needs `git -c protocol.file.allow=always submodule update --init packages/foliate-js` (worktree submodule uses a file:// remote). It added what was still broken on main:
  1. From unproxied mainland-China egress `www.bing.com` 302s to `cn.bing.com` for the page AND the translate POST; reqwest/undici replay a 302'd POST as a bodiless GET -> empty 200 -> `response.json()` failed -> provider ECHOED the source text ("chimney" -> "chimney", footer "Translated by Azure Translator."). Fix: POST to the host of `response.url` after the page fetch (module-level `translateUrl`, `*.bing.com` only) and throw `bing translate failed: malformed response` on a non-JSON body.
  2. `TranslatorPopup` now renders `err.message` as a muted detail line under the generic message and only shows "Please log in first" when `translator.authRequired && !token`.
- Web proxy (`/api/azure-translate`) left unchanged: CloudFlare Workers egress is never CN; a CN-egress self-host would still hit the redirect there.

**Why verification was tricky (reuse this):**
- This Mac has a system proxy (127.0.0.1:8118 + `http_proxy` env). Tauri/reqwest honours it (egress 103.181.x, no redirect), node `fetch` does NOT (direct CN egress, redirect). To make the real Tauri app hit the redirect, launch the binary with `NO_PROXY=bing.com,.bing.com no_proxy=...` (reqwest reads NO_PROXY even for system proxies). Xiaomi 13 sits behind MonoProxy VPN, so it cannot reproduce the redirect at all.
- `pnpm tauri dev` runs an UNBUNDLED binary (no bundle id) -> invisible to the computer-use screenshot filter; `open_application com.bilingify.readest` launches `/Applications/Readest.app` instead. Build a bundle (`pnpm tauri build --debug --bundles app` with `CARGO_TARGET_DIR=/Users/chrox/dev/readest/target` for the warm cache) and run `.../bundle/macos/Readest.app/Contents/MacOS/readest` directly with env vars.
- On the phone `__TAURI_INTERNALS__.invoke`/`postMessage` are non-writable; fault-inject one layer up with `Response.prototype.json` (check `this.url`). CDP `Input`-free path: set a Range in the foliate iframe doc -> selectionchange -> toolbar (only if the quick action is OFF; Android defers quick actions to a native touchend CDP cannot produce; toggle via the header dropdown "Instant Translate" item twice). Native `<select>` change via prototype value setter + `dispatchEvent(new Event('change',{bubbles:true}))` works.
- Device APK reports versionName 0.12.1 even for dev builds; it was a post-#5620 build. md5-check before trusting.

**How to apply:** Treat Azure/Bing failures as three separate things (language code, regional host, error surfacing). For any Tauri networking repro on this Mac, decide first whether the bug needs proxied or direct egress. See [[feedback-always-verify-on-xiaomi]], [[translation-inline-markup-1582]].


## Index status as of 2026-08-24 (moved verbatim from MEMORY.md)
- [#5823 Azure "Unable to fetch the translation"](azure-translate-regional-redirect-5823.md) reporter's bug = #5620 (merged, NOT in 0.12.1); PR #5826 MERGED (`a4358d22e`), worktree removed, issue CLOSED: regional bing host POST (www 302 -> cn = silent ECHO) + popup error detail; Mac system proxy hides the redirect from Tauri; `tauri dev` binary invisible to computer-use; worktree submodule is file:// (needs `protocol.file.allow=always` after a pin bump)
