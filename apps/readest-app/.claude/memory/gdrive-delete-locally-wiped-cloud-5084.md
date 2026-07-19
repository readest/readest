---
name: gdrive-delete-locally-wiped-cloud-5084
description: "#5084 Delete-locally wiped Google Drive copy; fixed by PR #5087 (uploadedAt stamping + stripDeviceLocalFields); not in 0.11.18"
metadata: 
  node_type: memory
  type: project
  originSessionId: b616ba37-dbf6-48e5-95b9-34fd2c642626
---

Issue #5084, fixed by PR #5087 (commit 5834bbccf, merged 2026-07-13 — AFTER v0.11.18 shipped, so 0.11.18 fleets still have it; it caused the mass-deletion half of [[gdrive-untitled-root-files-5147]]).

Mechanics on the broken versions: the file-sync engine published Book rows to the shared library.json VERBATIM (including the writer's device-local `filePath`/`downloadedAt`) and never stamped `uploadedAt` for provider-synced books. Peers adopting those rows read them as purely-local books whose file is missing; useOpenBook's stale-record cleanup then showed "Book file no longer exists. Confirm deletion..." and the confirm dispatched `handleBookDelete('both')` → `deletedAt` tombstone → engine deletion propagation removed the book on every device and `dirsToGc` GC'd its Drive hash dir. "Remove from Device Only" hit the same trap via cleared `downloadedAt`.

Fix (#5087): `stripDeviceLocalFields` on index publish AND on row adoption (heals poisoned indexes from older clients); engine stamps `uploadedAt` via `stampCloudCopy` + batch `LocalStore.markBooksUploaded` (live-row stamping so a long sync can't roll back concurrent progress); makeBookAvailable probes the file instead of trusting `downloadedAt`; third-party cloud deletes no longer route through the Readest Cloud transfer queue.
