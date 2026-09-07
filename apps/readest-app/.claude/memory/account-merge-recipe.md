---
name: account-merge-recipe
description: "How to merge one Readest account's cloud data (books, configs, notes, stats, replicas, R2 files) into another account of the same person; scripts/db/merge-accounts.mjs (MERGED #6121, dry run by default)"
metadata: 
  node_type: memory
  type: project
  originSessionId: b7f213ca-a1ea-4168-943a-0d8e08ead9cb
  modified: 2026-09-07T13:56:44.698Z
---

**General account-merge procedure:**
1. Confirm ownership of both accounts and identify the source and destination. Inspect their data and purchases with the read-only script, then review the merge dry run.
2. Preserve purchases on the destination; data merging does not transfer purchase entitlements. Handle any required purchase transfer separately using [[storage-purchase-account-transfer]].
3. Copy source R2 objects to destination keys and verify their sizes before re-pointing database rows. Resolve overlapping records by their update timestamps and refresh sync timestamps so destination devices receive moved data.
4. Delete source objects only after verified copies and row updates. Recompute storage usage for both accounts, then verify destination data, purchase entitlements, quota, and device sync. Inspect dangling file rows separately before any cleanup.
5. Sign out and back into the destination on each device to refresh account state and sync the preserved local library.

**Scripts (MERGED #6121 (64d594380), in `scripts/db/` on main, need `node --env-file=.env --env-file=.env.local`, must live in the repo so ESM finds `@supabase/supabase-js` and `aws4fetch`)**:
- `inspect-accounts.mjs <email>...` read-only: GoTrue identities, per-table counts, plans, payments, book titles for ownership checks, files rows vs actual R2 objects, cross-account overlap.
- `merge-accounts.mjs --from <email> --to <email> [--apply]`: R2 CopyObject + HEAD size verify -> re-point rows -> delete source objects -> recompute `plans.storage_usage_bytes` on both.
- The `transfer-storage-purchase.mjs` from [[storage-purchase-account-transfer]] was never committed and is gone; rebuild from that memory if a purchase must move.

**Facts the merge depends on:**
- `files.file_key` is `${user_id}/Readest/Books/<hash>/<name>` and UNIQUE, so a merge is a real R2 copy plus a key rewrite, not just a `user_id` update. R2 has no rename.
- `books` pull keys on `synced_at`, which a BEFORE INSERT/UPDATE trigger stamps `now()`, so re-pointing `user_id` alone reaches every device on the target. `book_configs`/`book_notes`/`stat_*` pull on `updated_at > cursor`: a device already signed into the target never sees a moved row with an old timestamp, so the script stamps `updated_at = now()` on those (stat pushes are server-stamped anyway; for configs/notes it only reaffirms the row that already won).
- Same primary key on both sides: newer `updated_at` wins, loser is deleted on the target / left on the source.
- `plans.storage_usage_bytes` == SUM(`file_size`) over live `files` rows. No writer exists in the repo, so prod maintains it by trigger; the script recomputes both users last so it lands where the app would put it.
- **Dangling files rows are common**: `pages/api/storage/upload.ts` inserts the row BEFORE returning the signed URL, so a PUT that never completes (over quota, network) leaves a live row with no object. The merge leaves them behind; nothing in the app garbage-collects them (worth a follow-up).
- Sign-out (`AuthContext.logout`) keeps the local library on disk, so after the merge, sign out and sign into the destination account on each device; a fresh sign-in pushes the full local state, so any progress written to the old account after the merge is not lost. Both accounts show the new quota only after a token refresh.

See [[storage-purchase-account-transfer]] and [[apple-iap-lost-storage-purchase-restore-verify]].
