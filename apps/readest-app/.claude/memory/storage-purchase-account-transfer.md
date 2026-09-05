---
name: storage-purchase-account-transfer
description: "How to move a one-time storage purchase between two accounts of the same person: reassign the store row (the dedupe key must follow the entitlement) plus a synthetic audit row on the losing account; done 2026-09-02 for a 2 GB Apple add-on"
metadata:
  type: project
---

**Done 2026-09-02** (OP had two accounts and wanted the space on the one carrying the subscription): a 2 GB Apple add-on moved from an Apple-sign-in free account to a Google-sign-in plus account. Buyer emails, user ids, the payment id and the `apple_original_transaction_id` are deliberately omitted - see [[feedback-no-prod-metrics-in-public]]; re-resolve them from the DB with `scripts/db/inspect-accounts.mjs`. Result: source back to 0 GB purchased (free-tier quota), target +2 GB.

**Script: `scripts/db/transfer-storage-purchase.mjs`** (`--from` / `--to` emails, dry run by default, `--apply` writes), plus read-only `scripts/db/inspect-accounts.mjs`. Both need `node --env-file=.env --env-file=.env.local` and must live in the repo, not the scratchpad (ESM resolves `node_modules` from the FILE).

**Reassign the store row, do NOT credit the target with a synthetic +N and cancel the source with a -N.** The store dedupe key has to follow the entitlement:
- Left on the source, a Restore Purchases re-verifies that transaction and `createOrUpdatePayment` rewrites `status`/`storage_gb` from the product id, so a `refunded`/zeroed row silently re-credits.
- A -N synthetic row survives that, but then an Apple refund flips the real row out of `COMPLETED_PAYMENT_STATUSES` and the source sums to **-N GB**, i.e. `storage_purchased_bytes` negative and a quota below the free tier. Nothing clamps it.
- After the reassign both paths are correct: a restore on the source hits the guarded update (0 rows) then the unique constraint and fails with `TRANSACTION_BELONGS_TO_ANOTHER_USER`; `handleAppleNotification` resolves the refund via `payments.user_id` for that `apple_original_transaction_id`, so a refund revokes from whoever now holds the space.

**The synthetic row is the audit trail on the LOSING account**, not the credit: `provider='readest'`, same `product_id`, `storage_gb=0`, `status='completed'`, metadata `{manual_transfer, transfer:'out', transferred_storage_gb, transferred_payment_id, transferred_to_user_id/email, transferred_at, reason}`. `storage_gb=0` and no `feature` key means it changes neither sum nor `isCustomizationPurchase`. The moved row keeps its identity and gains `{manual_transfer, transferred_from_user_id/email, transferred_at, reason}`.

**Finish with the real recompute on BOTH users** - mirror `updateUserStorage` exactly (sum `storage_gb` over completed rows, `isCustomizationPurchase`, the grace grant), so the DB lands where the app itself would put it.

**One purchase ends up as two Full Customization unlocks, by design.** The source keeps its `grandfathered` row and the target's recompute mints a fresh one (storage > 0, `STORAGE_GRANTS_CUSTOMIZATION` still true). Left as is: same human, and moving the row instead would downgrade the source (cloud sync / TTS downloads / Send to Readest). Move the grandfather row too only if the accounts belong to different people.

**Warn the buyer about the losing account's quota**: if the source is already using more than the free tier, it is over quota the moment the purchase leaves. Over quota only blocks new uploads (`pages/api/storage/upload.ts`, `api/share/[token]/import`); nothing is deleted. Both accounts need a sign-out/sign-in before the new quota shows, since `getStoragePlanData` reads JWT claims.

See [[apple-iap-lost-storage-purchase-restore-verify]] and [[storage-customization-entitlement-split]].
