---
name: crosspoint-sync-readest-connector
description: Readest <-> crosspoint-sync (CrossPoint's native KOSync hub): a Readest connector there is DEFERRED until users ask; Seekquel's PR #26 is the template
metadata:
  type: project
  modified: 2026-10-20T09:04:35.014Z
---

crosspoint-reader/crosspoint-sync (`sync.crosspointreader.com`, the firmware's DEFAULT KOSync server, maintained by
Justin Mitchell / itsthisjustin) is a KOSync server plus stats, clippings and connectors that fan progress out to
other services (Hardcover, Readwise, BookFusion, BookOrbit, Audiobookshelf, another KOSync server, ...).

**Conflict:** a CrossPoint device has ONE KOSync server. Readest plugin sign-in points it at Readest's
`/api/crosspoint`, so those users lose crosspoint-sync's connectors; users staying on crosspoint-sync get no Readest sync.

**Decision 2026-10-20 (chrox): build nothing now.** The Readest plugin already covers library, two-way progress and
stats. Revisit only if users ask to keep crosspoint-sync AND sync with Readest.

**Template if revisited: Seekquel, crosspoint-sync PR #26** (OPEN 2026-10-16, ~620 lines, by Seekquel's own developer
sabristratos; itsthisjustin engaged in review). Seekquel is in Readest's exact position: its own KOSync server
(`/koreader`, same document hash) that a reader can point at directly, plus a connector so users can keep
crosspoint-sync. Shape: device-code link -> per-link key (no password stored), `matchBy: 'document'` (no book
search), KOSync `PUT /syncs/progress` with title/author/filename attached and the CrossPoint `position` forwarded,
write-only. A Readest copy would reuse `/api/crosspoint/device/{code,token}` + `/link` and the KOSync PUT (metadata
also drives Optimize-EPUB linking); `GET /api/crosspoint/syncs/progress/:document` exists if it should also read.
Other connectors (BookFusion, BookOrbit) were written by itsthisjustin himself, not the services.

Fallback with zero upstream change (code-read only, never run): their write-only "Another KOSync server" connector
already passes `authenticateDevice` (`src/libs/crosspoint.ts`, accepts `x-auth-key: md5(key)`), but needs a Readest
"create a CrossPoint key" UI and sends no metadata; device must use Binary document matching.

See [[crosspoint-integration-feasibility-2026-09]].
