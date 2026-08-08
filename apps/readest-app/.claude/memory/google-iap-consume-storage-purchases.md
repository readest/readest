---
name: google-iap-consume-storage-purchases
description: "Google Play storage add-ons couldn't be repurchased (ITEM_ALREADY_OWNED) because purchases were only acknowledged, never consumed; fix = server-side consume in iap-verify + restore re-verify cleanup"
metadata: 
  node_type: memory
  type: project
  originSessionId: 3e234abf-a903-43eb-8d9a-ba7d000d2365
  modified: 2026-08-07T01:26:44.705Z
---

Found 2026-08-07. Storage add-ons (`.purchase.storage.1gb/2gb/5gb/10gb`) are consumables by design ("Each additional purchase adds more space", server sums `payments.storage_gb` rows), but nothing ever consumed them on Google Play — Android `BillingManager.kt` acknowledged everything and the verify route only acknowledged too. Acknowledged-but-unconsumed INAPP = permanently owned → `launchBillingFlow` fails with ITEM_ALREADY_OWNED on repurchase. iOS was fine (`finishTransaction` = consume for StoreKit consumables).

**Fix (MERGED PR #5545 2026-08-07):**
- `verifier.ts` `consumeProductPurchase` → Play API `purchases.products.consume` (consume implies acknowledge). Verify route consumes when `purchaseType === 'product' && purchaseState === 0 && consumptionState === 0`; subscriptions keep acknowledge-only. Never consume pending purchases.
- Kotlin `handlePurchase` now acknowledges subscriptions ONLY (cache productType, fallback monthly/yearly/subscription substring). One-time products stay unacknowledged locally so Google auto-refunds after 3 days if server verification never happens.
- Stuck pre-fix purchases: restore flow calls `verifyGooglePurchaseProducts` (client.ts) — posts each restored Android `.purchase.*` item to iap-verify, server consumes; dedupe via `payments.google_purchase_token` upsert. Storage-only restore now shows "Purchases restored successfully." toast instead of the misleading failure toast.

**Key facts:** each repurchase generates a NEW purchase token → new payments row → storage stacks. Consumed purchases stop appearing in `queryPurchasesAsync`, so Google restore can't recover them — entitlement is server-side only. RTDN handler ignores `oneTimeProductNotification` (refunds arrive as voided-purchase notifications), so no consume interaction there. Verify route runs on node.readest.com (googleapis dead on workerd, see [[google-rtdn-worker-verify-downgrade-incident]]).

**Verify on device:** buy 1 GB twice on Android; second purchase must not fail with "already owned". Stuck testers: Restore Purchases once unsticks them.
