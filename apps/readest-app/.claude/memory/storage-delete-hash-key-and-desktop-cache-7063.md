---
name: storage-delete-hash-key-and-desktop-cache-7063
description: "Cloud delete missed hash-named book files (#7063), desktop Manage Cache (#7066), and why the orphan early-settle fix (#7064) was closed"
metadata:
  node_type: memory
  type: project
  originSessionId: a7823024-e558-4f31-b1a7-a6aa2c5b0f4a
  modified: 2026-10-25T10:19:44.555Z
---

From a 2026-10 support email (macOS/iOS/web, Calibre plugin uploads).

- #7063 MERGED 22bdb4e4a (2026-10-25): `/api/storage/delete` now falls back by `book_hash` + extension like download does. App deletes `{hash}/{title}.ext`; the calibre plugin and koplugin upload `{hash}/{hash}.ext`. Shared parser `src/utils/bookFileKey.ts`. Production check after deploy still PENDING.
- #7066 MERGED 032a292e8: Manage Cache on desktop. Sources are only `Cache/browser-downloads` + `Cache/page-thumbnails` plus orphans, because desktop AppCache holds WebKit, tts-cache, and on Windows the WebView2 profile. Verified in a macOS debug build; Windows and Linux not run.
- #7064 CLOSED: bypassing `ORPHAN_SETTLE_MS` when dir mtime <= `deletedAt` is unsafe. `deletedAt` comes from another device's clock, and backup restore overwrites files (dir mtime unchanged) using its own library copy, so the store row stays deleted. A clock-safe version needs a locally stamped "tombstone applied at" field.
- Bulk download (issue 4) never reproduced; hypothesis: Manage Cache removes a tombstoned book's file but leaves `downloadedAt`.

**Why:** the reporter may write back, and the 1-hour orphan delay will come up again.
**How to apply:** before reviving #7064's idea, add the local stamp. Merges need the full head SHA: `gh pr merge --match-head-commit` rejects short SHAs. See [[sync-clock-skew-lastsynced-5661]].
