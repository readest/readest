---
name: notes-sync-crosspoint-skew-loop
description: "MERGED #7326, unreleased: a client with #7317 on a server without it re-pushed an EPUB's unanchored highlights forever (~1 POST/3s); web deploy must precede a native release"
metadata:
  node_type: memory
  type: project
  originSessionId: 29a62e48-6089-44b5-aa14-ff016bdf301b
  modified: 2026-11-04T16:46:06.575Z
---

Found 2026-11-05 on a local web build talking to web.readest.com, which was still pre-#7317
(clippings route 404, older crosspoint route 401). Introduced by 045beb4d1 (#7317). ce04bbec2 (#6802)
is the carrier: its trailing call fires from a stale throttle with the old cursor.

Loop: push stamps `updatedAt: Date.now()` with the anchor -> old server drops `crosspoint` -> pull moves
the cursor, `syncNotes` changes, new throttle -> old throttle's trailing timer re-selects the notes ->
`anchorTriedRef` guards getNewNotes only, not populateXPointersForPush, so they re-stamp.

Needs real latency: 300ms/300ms stops, 500ms/600ms and slower loop. A harness with the real useSync and
store plus a fake server reproduces it (28 pushes in 90s). Tests that mock useSync with a fixed cursor
cannot. Stops at 2 pushes with: parent hook, matching server, or the once-per-session gate in populate.

Reverse skew, old client on a #7317 server: no loop, but an edit likely WIPES the stored anchor. transformBookNoteToDB
keeps `crosspoint: undefined` as a key, postgrest-js builds `columns` from Object.keys (array upsert), PostgREST sets
`col = EXCLUDED.col` for every listed column, and a key missing from the body is NULL. KOReader never sends the key
either, so updates don't end it. Checked: captured request, PostgREST source, local Postgres with a control. NOT run on
a real PostgREST. Migration 033's "untouched", the `ink` comment in transform.ts and #7319's premise all assume otherwise.
Fix idea: in sync.ts's clientIsNewer branch, keep serverData.crosspoint when dbRec's is undefined; dropping the key in
the transform fails because `columns` is the union across the batch.

**Why:** new clients on older servers (including self-hosted) loop on every EPUB with unanchored highlights.
**How to apply:** ship the populate gate, fix the wipe before the web deploy, and deploy web before any native release carrying #7317.
See [[crosspoint-2-clippings-highlights]].

**Update 2026-11-05:** fixes in PR #7326, supersede the stamp notes above. Anchors no longer stamp: the server stores one outside LWW (`takesNoteAnchor`). `keepOmittedNoteColumns` and `keepOmittedConfigColumns` stop the NULL wipe; position columns must stay out, a pull takes the further of location and xpointer. PDF/CBZ idle re-push was real on main (20 POSTs/min). Tries come back after a failed push.
Open: the xpointer path still stamps `Date.now()`. `gstack-redact` is missing from the installed gstack, so `/ship`'s scan does nothing here. Rules for real checks: `next dev` hides client/server skew; use `build-web` + `start-web`. A harness must run the real route, since a hand-written merge hid both regressions.

**Merged 2026-11-05 as c46730772 (#7326), head 115abd8f6, UNRELEASED.** Stale copies are now stopped in the route: before inserting, it checks the same note under another copy with the same meta_hash (`outranksCopy`, dedupeLatest's rule). The client stamps hashes after back-fill. Tests were cut to one per behavior at chrox's request, so 11 verified behaviors have no failing test (listed on the PR), including pushed notes' hash and useSync reporting a failed push.
Still open: the xpointer `Date.now()` stamp, the stale-throttle closure, and the other review findings on the PR. The real route check needs a scratch harness now, see [[feedback-no-simulated-wait-loops-in-unit-tests]].
