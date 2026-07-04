---
name: calibre-plugin-push-4863
description: "readest-calibre-plugin (#4863) pushes calibre books+metadata to Readest cloud; key protocol facts (OAuth localhost relay, /sync explicit-null carry-over)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5d4d83a0-0aee-4200-852f-555df5243bed
---

`apps/readest-calibre-plugin/` (added 2026-07-04, commit 29a42853d on dev) implements #4863: calibre GUI plugin pushing selected books + metadata into the Readest cloud, modeled on BookFusion's plugin.

Design decisions and hard-won protocol facts:
- **Identity**: `Book.hash` = partial MD5 (KOReader algorithm; JS `1024 << -2` wraps to 0, so offsets are 0, 1024, 4096, ... 1024<<20). metaHash = `md5(NFC("title|authors,|ids,"))`, preferred id scheme uuid > calibre > isbn; Python impl verified byte-identical to `js-md5` output.
- **No OPF embedding**: writing calibre metadata into the file would change the hash on every edit and defeat dedup; metadata rides the books-row `metadata` JSON instead (custom columns under `customColumns`, pairs with #4811).
- **POST /sync explicit-nulls absent fields** (transformBookToDB) — updates must carry over `uploadedAt`, `groupId/Name`, `progress`, `readingStatus*`, `coverHash` from the pulled server row (`wire.py::merge_for_push`); same lesson as koplugin syncbooks.lua.
- **Upload key** `Readest/Books/{hash}/{hash}.{ext}`; app's `{title}.{ext}` downloads resolve via download.ts hash+extension fallback. cover.png stores *original* bytes (app never converts formats, bookService.ts:568), so calibre's cover.jpg bytes upload as-is; coverHash = partialMD5 of those bytes.
- **OAuth from a non-app client works**: `{supabase}/auth/v1/authorize?provider=X&redirect_to=http://localhost:PORT` is whitelisted (readest-app's Flatpak/custom-OAuth production path uses it). Tokens arrive in the URL *fragment*; serve a page whose JS relays `location.hash` to `/callback?...` (tauri-plugin-oauth trick). Implemented in `oauth.py`.
- Pure modules (`api.py`, `wire.py`, `oauth.py`) are calibre-free; `make test` runs 56 unittests; `make zip` builds; smoke-test inside calibre with `calibre-debug -c` after `from calibre.customize.ui import find_plugin` (initializes the `calibre_plugins` namespace).

- **Release packaging** (PR #4918): `build-calibre-plugin` job in release.yml mirrors the koplugin job; perl-stamps `PLUGIN_VERSION` from readest-app package.json, `make zip` → `Readest-<version>.calibre-plugin.zip` release asset. Committed version stays the (0, 1, 0) dev placeholder.
- **Pushing workflow files**: gh's OAuth token lacks `workflow` scope (HTTPS push of .github/workflows/* rejected); SSH push works (transient hangs — retry with ConnectTimeout/ServerAliveInterval).

Related: [[koplugin-cover-upload]], [[grimmory-native-sync]], [[ci-pr-delivery-and-push]]
