---
name: upload-without-books-sync-orphan-files
description: "Account had 600+ books in cloud storage but peers saw only a handful: uploads bypassed the Books sync category, so files landed with no `books` row; PR #6446 gates queueUpload on Books sync; 1 GB comp granted via synthetic payments row"
metadata:
  node_type: memory
  type: project
  originSessionId: f0c761af-9e54-4501-bd0b-0ab1feb54a95
  modified: 2026-09-29T03:05:53.229Z
---

**Symptom (2026-09-29, support):** files for ~640 books in R2 + `files` table, but only ~20 `books` rows; a new device showed just the few rows with `uploaded_at` set, whose files had since been cloud-deleted (cover-less, undownloadable).

**Root cause (inferred from code, repro on a test account pending):** peers list books ONLY from `books` rows. `useSync.syncBooks` returns early when the Books category is off, but no upload path checked it (per-book Upload, Upload All, multi-select, `forceUpload` imports). So with Books off, uploads spent quota and were invisible to every other device. The user's device toggle is local-only and not in the settings replica, so it can't be confirmed server-side.

**Fix:** PR #6446 MERGED (65e8a3228), branch `fix/upload-requires-books-sync`; review follow-up: Books hint only when no file backend is on, CodeRabbit 'recheck gate before uploadBook' DECLINED (no await between reconcile and uploadBook = unreachable): `transferManager.isBookUploadAllowed()` = Readest Cloud storage AND `isSyncCategoryEnabled('book')` (one gate for every caller; turning Books off policy-cancels pending uploads); explicit Upload toasts "Turn on Books in Manage Sync to upload this book"; Upload All hidden. Rejected alternative: push the row anyway on manual upload — later changes still go through the gated channel, so the row goes stale.

**Investigation recipe:** `scripts/db/inspect-accounts.mjs <email>` (its `files` listing is capped at 1000, so "N objects have no live files row" can be an artifact; recount with paging). Group `files.file_key` by `split('/')[3]` (the hash) and diff against `books.book_hash`. The Supabase Management API `logs.all` endpoint is REMOVED (use `/analytics/endpoints/logs` with a unified `logs` table + `log_attributes['...']`), and that endpoint returned "Backend error" for every query on 2026-09-29.

**Compensation grants:** never hand-edit `plans.storage_purchased_bytes`; `updateUserStorage` recomputes it from completed `payments` rows on every purchase or refund and would erase it. Insert `provider='readest'`, `product_id='com.bilingify.readest.storage.<N>gb.compensation'` (must NOT contain "customization"), `storage_gb=N`, `status='completed'`, `metadata={manual_grant:true, reason, granted_at}`, then recompute the sum the same way. Related: [[storage-customization-entitlement-split]], [[storage-purchase-account-transfer]], [[account-merge-recipe]].
