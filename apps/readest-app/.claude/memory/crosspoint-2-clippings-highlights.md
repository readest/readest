---
name: crosspoint-2-clippings-highlights
description: "CrossPoint 2.0 \"Sync Clippings\" aborted the whole sync on Readest (404); fix = clippings API v2 at /api/crosspoint + `crosspoint` anchor on book_notes, PR #7317 MERGED 045beb4d1 (UNRELEASED, web deploy pending); real X4 e2e passed 2026-11-04 (recipe + traps inside)"
metadata:
  node_type: memory
  type: project
  originSessionId: 472ab263-f3ef-4b57-b8f7-db7fb75eb472
  modified: 2026-11-03T20:15:41.455Z
---

Reported 2026-11-03 by the CrossPoint maintainer by email: users of the Readest plugin get
"Could Not Sync Clippings". Cause: CrossPoint 2.0.0 (released 2026-11-01) has opt-in **Sync Clippings**
(Settings → Connectivity → CrossPoint Sync) that first probes `{KOSync base}/api/v1/clippings/{doc}?cursor=0&limit=1&format=reader`
for `sync_version: 2`; Readest answered 404 and the firmware stops the WHOLE sync, progress included.

**Fix (chrox chose full two-way sync, KOReader-style):** branch `feat/crosspoint-clippings`, worktree
`~/dev/readest-feat-crosspoint-clippings`. Route `src/app/api/crosspoint/api/v1/clippings/[document]/route.ts`
(GET offset cursor over book_notes ordered created_at,id; PUT upsert ignoreDuplicates / tombstone), migration
`033_add_book_notes_crosspoint.sql` (apply BEFORE web deploy), `src/utils/crosspointClipping.ts` (anchor ↔ CFI),
useNotesSync resolves crosspoint-only notes on pull and anchors EPUB highlights on push (tried once per session),
linkCopy re-keys a copy's clippings. Simulator-verified all 4 directions against the real routes.

**Firmware facts (2.0.0):** offsets = code points of ALL char data in `<body>` minus head/style/script/title/rp,
raw whitespace counted, end exclusive (rt counted). Highlights drawn by offsets only; zero page/word/layout fields OK.
One undecodable item, text > 4096 bytes, >1 item per page, non-growing cursor, or a NEW id past
CLIPPING_MAX_PER_BOOK (256 on C3, 1024 on S3) stops the whole sync forever (every sync rescans from cursor 0).
Ids: device mints 32-hex at first upload; server ids printable ASCII ≤ 64. Clipping auth = x-auth-user + x-auth-key only.
2.0 moved `mount: "settings"` plugin cards to the web **Plugins** page; plugins start OFF on new installs.

**Why:** a firmware probe 404 blocks progress for every user who flips one toggle.
**How to apply:** any new KOSync-extension route must never return non-200 to a firmware probe unless intended.
Docs PR branch `docs/crosspoint-2` in `~/dev/readest-landing-docs-crosspoint-2`. Reply draft for the email thread
awaited approval. See [[crosspoint-integration-feasibility-2026-09]], [[crosspoint-sync-readest-connector]],
[[crosspoint-simulator-setup]].

**Real X4 e2e (2026-11-04, all 4 directions PASSED on production DB with migration 033 applied):** branch served from
the Mac (`next start` on 0.0.0.0:3001 for the X4, a second `next start -p 3000` for Chrome); X4 koServerUrl set via the
device web API (File Transfer mode: `POST http://<x4-ip>/api/settings {"koServerUrl":..., "koSyncClippings":1}`; save
`GET /api/settings` first, restore after). Screenshots: `CMD:SCREENSHOT` over `/dev/cu.usbmodem*` with platformio's python
(has pyserial+PIL); the port vanishes when the X4 sleeps. Traps: `pnpm dev-web` looped HMR reloads (cause not found) and an
old prod service worker on localhost:3001 -> use `build-web` + `start-web`; a production web build syncs with
web.readest.com unless the server starts with `API_BASE_URL=http://localhost:<port>` (runtime-config.js); Chrome's
localhost:3000 and :3001 origins were signed in to DIFFERENT accounts (compare sha of the JWT sub, never print it).
Firmware: Smart Sync also GETs progress under the alternate match method's hash (filename md5 for Binary devices);
clippings use the PRIMARY hash; applyRemote applies a tombstone whatever its revision. Filename-hash support
(`resolveDocument` = link -> own book -> md5(books.original_filename), links once) added on the branch after #7253/#7237;
not device-tested: books imported before #7237 have original_filename null.

**PR #7317** opened 2026-11-04 at 30178cb51 (rebased on 8f36b2898): commit 1 clippings, commit 2 filename-hash
ids (chrox asked for it in the same PR). Migration 033 already on prod. X4 left pointed at the Mac (chrox: "keep x4
as it is"); restore from scratchpad settings-before.json only when asked.
Merged 2026-11-04 by chrox at e70c92e35 (CodeRabbit round 1 fixed: 1000-row paging of the filename lookup; clippings
move BEFORE the link is saved so a failed move fails that sync and retries). Follow-up branch
PR #7319 MERGED 6ab667bd2: a moved range clears xpointer0/1 + crosspoint as NULL, not undefined
(push drops undefined; pull merges the old anchor back). DEFERRED, owner decides: CodeRabbit nitpick that every request
for an unmatched document rescans the user's books (fix = indexed md5(original_filename) column or a negative cache).
Cleanup 2026-11-04: both PRs merged, worktree + branches removed, local servers stopped. The X4 STILL points at the
Mac (http://192.168.2.120:3001/api/crosspoint, Sync Clippings on) per chrox; its original settings are in the session
scratchpad (koServerUrl https://web.readest.com/api/crosspoint, koSyncClippings 0), restore after the web deploy.
