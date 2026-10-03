---
name: crosspoint-integration-feasibility-2026-09
description: "CrossPoint (Xteink X3/X4 firmware) <-> Readest: 2026-09 feasibility research + the 2026-10-02 SD plugin (device-code sign-in, per-device keys, /api/crosspoint routes), sim-verified"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6b8d3a47-abd0-4891-bb93-5e24bcc3b617
  modified: 2026-09-04T17:16:52.369Z
---

Research spike (2026-09-05) on crosspoint-reader/crosspoint-reader + itsthisjustin/sd-plugins for a "Readest plugin for CrossPoint".

**Facts (verified in source, release v1.5.0 of 2026-08-07):**
- CrossPoint firmware has a built-in KOSync client (`lib/KOReaderSync/`): doc id = KOReader partial MD5 (Binary mode) or md5(filename) (FILENAME is the DEFAULT); progress = KOReader XPath `/body/DocFragment[N]/body/.../text().K`; default server `https://sync.crosspointreader.com` (crosspoint-sync, open source, KOSync-compatible + `/api/v1` extensions incl. stats, bookmarks, connectors that fan out to Hardcover/Readwise/BookFusion/ABS/another KOSync server). Sync is MANUAL from the reader menu.
- Built-in OPDS client with HTTP Basic, search, paging; accepts ONLY `application/epub+zip` acquisition links.
- Local progress = `/.crosspoint/epub_<std::hash(path)>/progress.bin` (spineIndex u16, page u16, chapterPages u16, visibleTextOffset u32): layout-bound, useless off-device.
- NO reading statistics in the firmware (issue #1600 closed, still on roadmap). CrossInk fork has stats.
- SCOPE.md CLOSES new network connectors in firmware; third-party sync must go through crosspoint-sync or SD plugins.
- SD plugin system = firmware PR #3114 (OPEN, unmerged, +6339/-491). `reader.session` stats events = PR #3204 (OPEN, depends on #3114). Plugin events carry percent/bp only, NEVER the XPath. Precedent: samfoy/crosspoint-bookorbit-plugin.
- device.json supports `auth.type: "password"` (silent token mint, re-mint on 401), so Supabase password grant would work for a Readest plugin.

**Verdict:** progress = works TODAY via a shared KOSync server (set CrossPoint matching to Binary; Readest is md5-only); library = needs a Readest-hosted OPDS feed or the plugin PR; stats = impossible until #3204 lands.

**Why:** Readest `book.hash` is the same partial MD5, and Readest already emits/resolves KOReader XPointers and applies cloud `book_configs.xpointer` on open (useProgressSync).

**How to apply:** highest-leverage Readest-side work is a KOSync-compatible server endpoint + per-user sync key, and an OPDS feed of the cloud library (Basic auth). Don't propose firmware changes to CrossPoint. Nothing hardware-verified (no Xteink device). See [[kosync-percentage-reanchor-impossible-path-5980]] for XPointer pitfalls.

**Outcome 2026-10-02:** #3114 and #3204 MERGED into firmware develop (not in release 1.6.5). Built
`apps/readest-crosspoint-plugin/` + `GET /api/library/books` on branch `feat/crosspoint-plugin`
(worktree `~/dev/readest-feat-crosspoint-plugin`), all verified in the simulator against a protocol
double (no real account): catalog, paging, download, token mint/re-mint, browser sign-in/out, and
`reader.session` -> `/api/sync` statPages with `book_hash` == partial MD5. Two traps worth remembering:
(1) firmware `{limit}` = page_size+1 and the lookahead row is DROPPED, so servers must step pages by
page_size (route takes `per_page`, returns per_page+1); (2) firmware `GET /download` only blocks a
dot-prefixed LAST segment, so plugin secrets must be dotfiles. Details + remaining items: plan
`apps/readest-app/.claude/plans/2026-09-05-crosspoint-readest-plugin.md`; env: [[crosspoint-simulator-setup]].

**Phase 2 (zero-config progress, 2026-10-02, same branch):** Readest acts as the device's KOSync server at
`/api/crosspoint` (per-device keys table, migration 024, open to all plans — maintainer's choices); plugin
sign-in writes the device's KOSync settings through `POST /api/settings`. Device web API OBFUSCATES
`koPassword` (GET returns null + hasPassword) — I wrongly claimed earlier it leaked. CrossPoint progress
sync stays MANUAL (reader menu). Interop: CrossPoint→Readest XPointers drift 1–3 lines forward on develop;
crosspoint-reader PR #3424 makes them exact (sim-verified). Highlights: none on develop; open PR #3589
renders them and syncs to `{KOSync base}/api/v1/clippings/{doc}` (crosspoint-sync API), so the same base
URL can host clippings later.

**Phase 3 (2026-10-02, review-driven redesign, chrox chose all three):** the password grant was dropped:
a LAN peer can rewrite device.json via the unauthenticated `/api/plugin-fs` and exfiltrate `{cfg.password}`.
Now device-code sign-in (`/api/crosspoint/device/{code,token,approve}` + web `/link?code=` page), one
per-device key (`crosspoint_devices`, migration 024 rewritten) authenticating EVERYTHING: catalog
`/api/crosspoint/books`, download hop `/books/:hash`, `reader.session` -> `/api/crosspoint/sessions`
(server spreads the session over Readest's page count, else 1% steps; median ignores events >120s),
and KOSync (key as Bearer, x-auth-key md5, or Basic password). Firmware facts that drove it: on-device
`auth.type device_code` shows the verify URL as text+QR (use `verification_uri_complete`), but only
`plugin.js` can write KOSync settings and it CANNOT read dotfiles, so on-device sign-in = library+stats
only and its key is orphaned if the web page signs in later (key-management UI = follow-up). Event
queue STALLS at the first non-2xx delivery, so the sessions route answers 2xx for unrecordable events.

**Merged 2026-10-02:** PR #6547 -> main `54c089f36` (unreleased). Deploy order: apply migration
`024_crosspoint_devices.sql` BEFORE the web deploy that ships `/api/crosspoint/*` and `/link`.
`release.yml` job `build-crosspoint-plugin` uploads `Readest-<version>.crosspoint-plugin.zip`
(stamps manifest.json version). CodeRabbit fixes: untitled books listed under their hash (`||`),
token route restores the claimed code if the key insert fails. Never device-tested; `/link` signed-in
approval untested until the migration is live. Follow-ups: device list/revoke/expiry UI, rate limit
on /device/code, orphaned on-device key after a later web sign-in.
