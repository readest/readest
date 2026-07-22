---
name: gdrive-untitled-root-files-5147
description: "#5147 Untitled files in Drive root = non-atomic create-then-name in GoogleDriveProvider.writeBinary; MERGED PR #5150 multipart/resumable atomic creates"
metadata: 
  node_type: memory
  type: project
  originSessionId: b616ba37-dbf6-48e5-95b9-34fd2c642626
---

Issue #5147 (2026-07-16, user on 0.11.18): 176 files named "Untitled" (~268 B) appeared in the user's Google Drive ROOT while Readest/Books dropped 186 to ~40 then re-climbed; local libraries shrank on every device.

Two independent defects:

1. **"Untitled" root files (PR #5150 MERGED 2026-07-17; worktree + local branch removed)**: `GoogleDriveProvider.writeBinary`'s NEW-file path POSTed bytes with `uploadType=media` (no metadata, so Drive creates a file literally named "Untitled" in My Drive root) then PATCHed name+reparent. Any failure between the two strands the root file, and the engine's retry creates another. Failure sources: 403 rate-limit reasons are NOT retried by `withBackoff` (it only retries 429/5xx — still true after the fix), exhausted retry budget, network drop, iOS suspension mid-sync. 268 B = a small config.json payload. Fix: creates ≤5 MB use `uploadType=multipart` (metadata + bytes in ONE request, `MULTIPART_BOUNDARY` constant); >5 MB buffered creates (web book uploads) open a resumable session (metadata in initiation, file materialises only when PUT completes, single-shot PUT like uploadStream). `simpleUploadUrl`/`reparentUrl`/`nameAndReparent` deleted. Overwrite PATCH path unchanged.

2. **Mass deletion = the [[gdrive-delete-locally-wiped-cloud-5084]] defect family, NOT re-fixed here** (already fixed by PR #5087, merged 2026-07-13, after 0.11.18 shipped): 0.11.18 published device-local `filePath`/`downloadedAt` into library.json and never stamped `uploadedAt`, so peers classified provider-synced books as "purely-local with missing file"; useOpenBook's stale-record cleanup then offered "confirm deletion" which routed to `handleBookDelete('both')` → tombstone → engine deletion propagation shrinks every peer's library + `dirsToGc` GC deletes Drive hash dirs. Cure for affected users = upgrade all devices past #5087; the index heals on adoption (stripDeviceLocalFields).

Follow-ups NOT done (scope): `withBackoff` still doesn't retry 403 rate-limit reasons; tombstones in library.json are never pruned; no blast-radius cap on the GC/deletion propagation (a bogus index with many tombstones is still obeyed).
