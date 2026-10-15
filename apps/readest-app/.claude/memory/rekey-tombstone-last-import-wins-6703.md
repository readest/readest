---
name: rekey-tombstone-last-import-wins-6703
description: "#6703 MERGED 3dc57613c: re-keyed book hashes leave a tombstone; re-importing any version = update (last import wins); NOT device-verified"
metadata:
  node_type: memory
  type: project
  originSessionId: 3920fdf8-272b-42e1-a916-f45890af0c19
  modified: 2026-10-13T08:58:21.955Z
---

PR #6703 merged 2026-10-13 (squash 3dc57613c). Follow-up to [[duplicate-book-calibre-uuid-5959]].

- A metaHash/stable-key re-key now leaves a `deletedAt` tombstone for the old hash, so sync peers stop re-adding it as a card with no file behind it.
- chrox's product rule: **one book, last import wins.** Re-importing a retired file restores its row and `mergeBooks` merges the live version into it. Versions never stay side by side. The contributor's "coexistence" design was rejected.
- `mergeBooks` also matches by stable hash, and duplicates it retires get `updatedAt` stamped.
- A config moved to a new hash resets `lastSyncedAtNotes` to 0, so notes re-push under the new hash.
- A restored row is re-added to the batch lookup index (`indexBookKeys`).

**Why:** before this, pandoc/calibre rebuilds left broken old-version cards on every synced device.

**How to apply:** UNRELEASED and not device-verified; the contributor's Android run predates last-import-wins. Not verified either: whether the server keys notes by id alone or by book hash plus id (re-pushed notes overwrite vs. add a copy).
