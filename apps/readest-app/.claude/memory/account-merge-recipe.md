---
name: account-merge-recipe
description: "How to merge one Readest account's cloud data (books, configs, notes, stats, replicas, R2 files) into another account of the same person; scripts/db/merge-accounts.mjs (MERGED #6121, dry run by default); 2026-09-07 support ticket APPLIED, customer reply pending"
metadata: 
  node_type: memory
  type: project
  originSessionId: b7f213ca-a1ea-4168-943a-0d8e08ead9cb
  modified: 2026-09-07T13:56:44.698Z
---

**Ticket 2026-09-07, Gmail subject "Storage upgrade — can I update my email"**: the buyer's OLD account is a Google sign-in on a Workspace address they no longer control (so it can never be signed into again once a session dies) and holds the whole library (121 books, 156 files rows, 513 MB usage on the FREE plan = already over the 500 MB tier, which is why they bought storage). The NEW account is Apple sign-in and holds the 1 GB Play purchase (`google_purchase_token`, plus the grandfathered customization row) and one book that also exists in the old one. Direction is therefore data old -> new, purchase stays. Customer emails and user ids are deliberately not recorded here; re-resolve them from the Gmail thread. **APPLIED 2026-09-07** on chrox's go: 112 objects (366.56 MB) copied + verified, 121 books / 10 configs / 2 notes / 8+47 stat rows / 1 replica / 112 files rows re-pointed, source objects deleted, usage recomputed (old 146.80 MB of dangling rows only, new 366.85 MB of 1.49 GB). Reply to the customer NOT yet sent.

**Scripts (MERGED #6121 (64d594380) 2026-09-07, in `scripts/db/` on main, need `node --env-file=.env --env-file=.env.local`, must live in the repo so ESM finds `@supabase/supabase-js` and `aws4fetch`)**:
- `inspect-accounts.mjs <email>...` read-only: GoTrue identities, per-table counts, plans, payments, book titles for ownership checks, files rows vs actual R2 objects, cross-account overlap.
- `merge-accounts.mjs --from <email> --to <email> [--apply]`: R2 CopyObject + HEAD size verify -> re-point rows -> delete source objects -> recompute `plans.storage_usage_bytes` on both.
- The `transfer-storage-purchase.mjs` from [[storage-purchase-account-transfer]] was never committed and is gone; rebuild from that memory if a purchase must move.

**Facts the merge depends on:**
- `files.file_key` is `${user_id}/Readest/Books/<hash>/<name>` and UNIQUE, so a merge is a real R2 copy plus a key rewrite, not just a `user_id` update. R2 has no rename.
- `books` pull keys on `synced_at`, which a BEFORE INSERT/UPDATE trigger stamps `now()`, so re-pointing `user_id` alone reaches every device on the target. `book_configs`/`book_notes`/`stat_*` pull on `updated_at > cursor`: a device already signed into the target never sees a moved row with an old timestamp, so the script stamps `updated_at = now()` on those (stat pushes are server-stamped anyway; for configs/notes it only reaffirms the row that already won).
- Same primary key on both sides: newer `updated_at` wins, loser is deleted on the target / left on the source.
- `plans.storage_usage_bytes` == SUM(`file_size`) over live `files` rows (verified on both accounts). No writer exists in the repo, so prod maintains it by trigger; the script recomputes both users last so it lands where the app would put it.
- **Dangling files rows are common**: `pages/api/storage/upload.ts` inserts the row BEFORE returning the signed URL, so a PUT that never completes (over quota, network) leaves a live row with no object. The old account had 44 such rows = 147 MB of phantom usage counted against the free tier. The merge leaves them behind; nothing in the app garbage-collects them (worth a follow-up).
- Sign-out (`AuthContext.logout`) keeps the local library on disk, so the customer's fix after the merge is sign out + Sign in with Apple on each device; a fresh sign-in pushes the full local state, so any progress written to the old account after the merge is not lost. Both accounts show the new quota only after a token refresh.

See [[storage-purchase-account-transfer]] and [[apple-iap-lost-storage-purchase-restore-verify]].
