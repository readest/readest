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

**Self-update (2026-10-03, uncommitted on main when written):** web card shows the installed version
(manifest.json via `api.pluginFile`) + Check for update (relay GET download.readest.com/releases/latest.json,
13 KB under the 32 KB relay cap; relay does NOT follow redirects, so the GitHub URL can't be a fallback) +
Update (`fetchToSd` the release zip to `<dir>/update.zip`, unzip with the device's own `/js/jszip.min.js`,
`writeFile` each entry with manifest.json LAST, `/delete` the zip). `api.dir` only exists on develop >= 10-01;
fallback `/.crosspoint/plugins/<name>` wins the root collision. Firmware never shows plugin versions on the
reader, so release.yml stamps `device.json` description "Version X. ..." (shows on line 1 after the
"Receives: reading sessions." prefix). Sim-verified on 664528b (fallback dir) and 1f77b83 (api.dir).

**Optimize EPUB vs KOSync (2026-10-03, uncommitted on main when written):** File Manager "Optimize EPUB"
(FilesPage.html, browser-side, OPT-IN, warns "can break hash-based sync") rewrites the zip (Alice 414 KB ->
151 KB) so the partial MD5 changes; dc:title/dc:creator survive. Smart sync GETs the binary hash AND
md5(filename), both 404 -> uploads local. GET never carries metadata; only the PUT does, and only with
`koSendMetadata` (plugin sign-in now sets it). Sidecar `<book>.meta.json` fields ride the PUT too, but only
catalog downloads write one and those are never optimized. Fix: PUT links an unknown document to the ONE
library EPUB with that title (source_title or title, first author breaks ties; never when a books row has the
document itself) in new table `crosspoint_documents` (migration 025, apply BEFORE web deploy); linking upload
never regresses Readest; GET follows the link. Sim-VERIFIED with the real routes: 1st sync links, 2nd pulls
ch.6, push from the copy updates the Readest book. Sessions route follows the same link (stats merge into
the library book once linked; sessions before the first Sync Progress stay under the copy's hash).

**PR #6592 MERGED (9703d4611, 2026-10-03) UNRELEASED; apply migration 025 BEFORE the web deploy:**
update check + version display + Optimize-EPUB linking + sessions follow the link. CodeRabbit fixes: link
helpers return `{ bookHash, error }` and routes 500 on any link DB error (never sync under the copy's id); no
`.limit()` on the title lookup (a cut list could drop Readest's own file / a 2nd fit). Read-back after the
ignore-duplicates upsert DECLINED (same copy -> same candidate), CodeRabbit withdrew it. Worktree + branch removed. Not on a real X4 yet.

**Real X4 E2E vs production (2026-10-04, fw 1.6.5-dev+5b1f060, X4 at 192.168.2.19):** update check/install
VERIFIED on hardware via a LAN release server (relay + fetchToSd + device JSZip, files byte-identical, ~1 s);
plugin list shows "Version 0.12.99."; re-sign-in sets koSendMetadata (old sign-ins keep it OFF). Optimize
EPUB on The Kite Runner changed the hash, title/author intact; first sync 404/404/PUT 200 as designed, but
the library held TWO Kite Runner EPUBs (same title+author) so linkCopy refused and the copy got its own 0%
row -> reader stuck on page 0. Fix #6614 MERGED (2401d3e23) UNRELEASED: ties among same title + first
author -> most recently read (`updated_at`); first author compared WHOLE (CodeRabbit: "Ann" vs "Anna");
no author + colliding titles still refuses. X4-VERIFIED after deploy (2026-10-04): page past the cover -> sync (PUT links) -> sync -> jumped to Readest's 13%.
Smart sync sends NO PUT while local == the orphan's 0% (same spine/page), so a page turn is required.
CRASHES during the flow = firmware lwIP assert `sys_untimeout ... Required to lock TCPIP core` at Wi-Fi
bring-up, BEFORE any request reached prod (crash_report.txt at SD root has no decoded backtrace; decode needs
the nightly ELF; chrox said skip). Suspect trustedtime::startSync -> configTzTime on Wi-Fi join; rapid syncs. GAPS: release 0.12.10 has NO crosspoint zip, so Update
from production 404s until the next release; the X4 still runs the 0.12.99 test plugin (backup of the old
1.0.0 files in the session scratchpad only). Serial port = CMD:SCREENSHOT only, no input injection.

**Release + landing (2026-10-04):** Readest-0.12.10.crosspoint-plugin.zip (built from main 349ac45ba, stamped
0.12.10) uploaded to the v0.12.10 GitHub release AND R2 readest-releases/releases/v0.12.10/ (download.readest.com;
the landing's buttons link there by NEXT_PUBLIC_APP_VERSION). Docs screenshots live in R2 bucket readest-public
under public/images/crosspoint/ -> https://assets.readest.com/public/images/crosspoint/ (assets.readest.com IS
attached to readest-public). readest-landing#44 MERGED (88fdfd411): /docs/crosspoint + Sync section, CrossPoint
download tile (home drops the App Store tile via showAppStore), hero names CrossPoint, orbit node on the OUTER
ring. GOTCHA: an 11th hub node makes the physics' resting layout a SADDLE (group slides to another layout after
any drag); chrox chose to loosen the e2e check rather than retune. Landing e2e speedups in the same PR: local
icons module (scripts/build-icons.mjs; react-icons/<set> ships the WHOLE set in next dev, 27 MB pages),
SKIP_GITHUB_STARS in the Playwright web server, /api/github/stars in the warm-up pass. CI e2e 320-345s -> 224s.
The X4 runs the main-built plugin stamped 0.12.10.
