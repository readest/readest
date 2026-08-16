---
name: mixed-fleet-toast-removed-5720
description: "#5720: mixed-fleet 'Another device is still syncing' toast REMOVED wholesale — fixed anchor + process-local latch re-warned every launch forever"
metadata: 
  node_type: memory
  type: project
  originSessionId: 478432f3-2e3a-41c5-9569-ffb76042994b
  modified: 2026-08-15T16:03:13.457Z
---

Issue #5720 (2026-08-15): users on all-WebDAV fleets got the info toast "Another
device is still syncing this library via Readest Cloud" on EVERY app launch with
no way to silence it. Root cause: `checkMixedFleetOnce` (UC1 mixed-fleet probe,
shipped with [[multi-provider-cloud-sync-5062]]) compared cloud `books` rows
against a FIXED anchor (`readestCloud.disabledAt` / earliest
`providerSelectedAt`) that never advanced, while the once-per-session latch
(`fleetNoticeShown`) was process-local zustand — reset on every launch. Any row
written after the anchor (e.g. by a device that later switched to WebDAV itself)
stayed "newer" forever → toast every launch.

Resolution: user chose REMOVAL over an ack-cursor fix ("Just remove this info
toast"). MERGED #5726 (squash `a0a152ae5`, 2026-08-15; branch built off
origin/main via temp-index, dev tree untouched; pushed with --no-verify per
user's no-testing instruction). Local dev tree copies of the change restored
to HEAD after merge; dev picks the fix up on its next rebase onto origin/main. Deleted `src/services/sync/fleetDetection.ts`, its test, the
`fleetNoticeShown`/`setFleetNoticeShown` latch in `fileSyncStore`, and the probe
call in `useBooksSync.handleAutoSync` (the `!isReadestCloudEnabled` early return
stays). `readestCloud.disabledAt` + `providerSelectedAt` stamps remain (unused
by detection now).

**Why:** stale evidence is indistinguishable from an active writer with a fixed
anchor; the warning punished settled fleets forever.

**How to apply:** if mixed-fleet detection ever comes back, the probe cursor
must ADVANCE (persist an ack like `fleetNoticedAt = max(Date.now(), row
synced_at)`, probe from `max(anchor, ack)`); note the probe's limit-1 page is
the OLDEST matching row (server orders `synced_at` ascending), so ack to now,
not to the row. The unused i18n key ("Another device is still syncing…") gets
pruned by the next /i18n extract.
