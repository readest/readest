---
name: apple-iap-lost-storage-purchase-restore-verify
description: "Apple order MSXWGYVFZK (1GB storage, CHN) never reached Supabase: one-shot client verify + webhook ignores one-time purchases + iOS restore never re-verified; fix mirrors Google #5545"
metadata: 
  node_type: memory
  type: project
  originSessionId: ef318d77-c7c9-46ec-80e5-99d7caf2520b
  modified: 2026-08-13T05:18:02.909Z
---

Found 2026-08-13. A CHN-storefront Apple purchase (order MSXWGYVFZK, tx `450003083195506`, `com.bilingify.readest.storage.1gb.purchase`, ¥68, valid + unrevoked per App Store Server API `lookupOrder`) never landed in `payments`/`plans`. Buyer's Apple ID is `114*...@gmail.com` but their Readest login is `1147370717@qq.com` (user `d1b08ed8-dd0c-48a0-9e6d-13809db22bb5`) — Apple ID email ≠ Readest login, so the buyer was NOT derivable from data; chrox supplied the account from the support conversation. CREDITED manually 2026-08-13 (payments row + `storage_purchased_bytes` = 1 GiB) via scratchpad `credit-order.js`.

**Why one-time purchases get lost (3 gaps):**
1. Verification is ONE client-side fetch from `subscription/success/page.tsx` to `node.readest.com/api/apple/iap-verify`; network failure (China) or app death = purchase recorded nowhere.
2. `StoreKitManager.swift` (StoreKit 1) calls `finishTransaction` on `.purchased` even when `purchaseHandler` is nil — a transaction delivered while JS isn't listening is silently dropped.
3. Apple webhook `notifications.ts` deliberately skips non-refund one-time purchase events (`ignored_purchase_event`) — can't attribute anyway: the app never sets `appAccountToken` (grep = zero usage).

**Fix (MERGED PR #5669 2026-08-13):** `verifyApplePurchaseProducts` in `src/libs/payment/iap/client.ts` — iOS mirror of `verifyGooglePurchaseProducts` ([[google-iap-consume-storage-purchases]] #5545, which only covered `platform === 'android'`) — wired into `handleIAPRestorePurchase` in `user/page.tsx`. Server dedupes via upsert on `apple_original_transaction_id`; `updateUserStorage` recomputes `plans.storage_purchased_bytes` (= sum of completed `payments.storage_gb`). Restored SK1 transactions DO carry `original?.transactionIdentifier`, and the verify route only needs originalTransactionId. Customer self-heal after release: sign in → Restore Purchases.

**Key lookups:** `lookupOrder(orderId)` in `app-store-server-api` maps an emailed Apple ORDER ID → transaction; env keys `APPLE_IAP_*` + `APPLE_IAP_PRIVATE_KEY_BASE64` in `.env.local`, prod Supabase URL base64 in `.env`, admin key `SUPABASE_ADMIN_KEY`. Manual credit script: scratchpad `credit-order.js` (guards against double-credit; needs the buyer's account email from support).

**Follow-ups (not done):** set `appAccountToken` (= Supabase user UUID) at purchase so ONE_TIME_CHARGE webhooks are attributable server-side; iOS storage products are Non-Consumable in ASC (Apple tx `type: "Non-Consumable"`) so the same tier can't be stacked twice on iOS, contradicting the "each purchase adds more space" design — verify ASC config before relying on stacking. Free-plan `plans.storage_usage_bytes` has users at 77 GB with 0 purchased — quota enforcement gap worth auditing.
