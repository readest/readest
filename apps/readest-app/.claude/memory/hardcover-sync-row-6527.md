---
name: hardcover-sync-row-6527
description: "PR #6527 (RedHatter) Hardcover on the reader sync row; tap pushes even with Auto Sync off; per-book push status; unmatched books not failures"
metadata:
  node_type: memory
  type: project
  originSessionId: bb7baabe-f60e-472c-b9ad-c0fa6299f9cd
  modified: 2026-10-01T16:13:10.476Z
---

PR #6527 MERGED 2026-10-02 (b7fe47bab), UNRELEASED, not device-tested.

- Reader sync row tap pushes Hardcover progress + notes (`silent: true`) whenever Hardcover is connected. chrox + PR author decided a tap is a manual sync, so it ignores Hardcover Auto Sync. My Auto Sync gate (shelf side effect: `pushProgress` -> `ensureBookInLibrary` + status 2 adds the open book as Currently Reading) was REVERTED on request. Do not re-propose it.
- `useCloudSyncStatus(native, bookKey?)`: book scope = bookKey given; adds a Hardcover provider.
- `hardcoverSyncStore.byBook[bookKey]` {pending, lastError}; a new batch clears the error.
- `HardcoverUnmatchedError` (no match / no page count) is not recorded as a row failure.
- Hardcover close flush now uses its own `flush-hardcover-sync` event, not `sync-book-progress`.

Related: [[hardcover-link-book-5846]], [[reader-menu-third-party-sync-status-5910]]
