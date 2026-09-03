---
name: apple-iap-lost-storage-purchase-restore-verify
description: "Apple one-time storage purchases keep getting lost client-side (orders MSXWGYVFZK 08-13, MLYD8F9573 08-25 both credited manually); restore-verify fix #5669 MERGED but UNRELEASED (newest tag v0.12.1 predates it), so shipped iOS Restore Purchases still can't self-heal; manual credit recipe inside"
metadata: 
  node_type: memory
  type: project
  originSessionId: ef318d77-c7c9-46ec-80e5-99d7caf2520b
  modified: 2026-08-25T00:00:00.000Z
---

**Incidents (both = valid, unrevoked Apple tx that never reached `payments`/`plans`):**
1. 2026-08-13 order MSXWGYVFZK, tx `450003083195506`, CHN ¥68. Apple ID email ≠ Readest login (`1147370717@qq.com`, user `d1b08ed8-dd0c-48a0-9e6d-13809db22bb5`). CREDITED manually.
2. 2026-08-25 order MLYD8F9573, tx `150003317647031`, DEU €9.99 (Apple `price` is milliunits: 9990), purchased 04:53Z. Apple ID `daniel@drs.li` ≠ Readest login `drs1337@googlemail.com` (google OAuth, user `1d9cbfc7-41a9-4f32-b94e-51468f4b3d38`). CREDITED manually same day; `payments.metadata = {manual_credit:true, apple_order_id, reason}` for audit. Other iOS 1 GB purchases that same day DID land, so the pipeline works for most users; the loss is per-device (network/app death between StoreKit and the one-shot client verify).

Buyer is NEVER derivable from data: Apple ID email ≠ login in both cases and the app sets no `appAccountToken` (Apple tx shows `appAccountToken: null`). Support must supply the account email.

**Why one-time purchases get lost (3 gaps):**
1. Verification is ONE client-side fetch from `subscription/success/page.tsx` to `node.readest.com/api/apple/iap-verify`; failure = purchase recorded nowhere.
2. `StoreKitManager.swift` (StoreKit 1) calls `finishTransaction` on `.purchased` even when `purchaseHandler` is nil — dropped silently.
3. Apple webhook `notifications.ts` skips non-refund one-time purchase events (`ignored_purchase_event`).

**Fix #5669 (MERGED 2026-08-13, ed3ecca6d) is NOT in any release** as of 2026-08-25: newest tag `v0.12.1` was cut 2026-08-09. `verifyApplePurchaseProducts` (`src/libs/payment/iap/client.ts`, wired into `handleIAPRestorePurchase` in `user/page.tsx`) only helps once an iOS build containing it ships — until then every "Restore Purchases doesn't work" ticket for a storage purchase is expected and needs a manual credit. After release: customer signs in → Restore Purchases; server dedupes via upsert on `apple_original_transaction_id`.

**Manual credit recipe** (scratchpad is session-scoped and gets wiped — rebuild from this): Node CJS script requiring `node_modules/app-store-server-api` + `@supabase/supabase-js`; env from `.env.local` (`APPLE_IAP_KEY_ID/ISSUER_ID/BUNDLE_ID/PRIVATE_KEY_BASE64`, `SUPABASE_ADMIN_KEY`) and `.env` (`NEXT_PUBLIC_DEFAULT_SUPABASE_URL_BASE64`, base64-decode). Steps: `new AppStoreServerAPI(key,keyId,issuerId,bundleId,Environment.Production).lookupOrder(orderId)` → `status 0` = valid → `decodeTransaction(signedTransactions[i])`; find user via GoTrue admin `GET {url}/auth/v1/admin/users?filter=<email>` (also try gmail↔googlemail); guard no existing `payments` row for `apple_original_transaction_id` (abort if another user owns it); upsert `payments` {user_id, provider:'apple', product_id, apple_transaction_id, apple_original_transaction_id, storage_gb (parse `\.(\d+)gb`), status:'completed'} onConflict `apple_original_transaction_id` (the automatic path leaves amount/currency NULL); then `plans.storage_purchased_bytes = sum(storage_gb of completed|succeeded payments) * 2^30`. `plans` has NO `updated_at` column.

**Quota display:** `getStoragePlanData` in `src/utils/access.ts` reads `plan`/`storage_usage_bytes`/`storage_purchased_bytes` from JWT claims, so a credited user sees the new quota only after token refresh or sign-out/in. Free plan + 1 GB purchase shows **1.5 GB** (`DEFAULT_STORAGE_QUOTA.free` 500 MB + purchased; `plan` stays `free` in the claim, `purchase` quota is 0).

**Follow-ups (not done):** ship a release with #5669; set `appAccountToken` (= Supabase user UUID) at purchase so ONE_TIME_CHARGE webhooks are attributable server-side; iOS storage products are Non-Consumable in ASC so the same tier can't be stacked twice on iOS — verify ASC config before relying on "each purchase adds more space". Free-plan `plans.storage_usage_bytes` has users at 77 GB with 0 purchased — quota enforcement gap worth auditing. See [[google-iap-consume-storage-purchases]] for the Android mirror (#5545).


## 2026-09-01 update: server-side safety net now exists (still undeployed)

**App Store Server Notifications were NEVER configured for this app** until 2026-09-01. `requestTestNotification` returned "No App Store Server Notification URL found for provided app", and notification history was empty over 30 days. So `handleAppleNotification` had never been invoked in production: the client-side verify was genuinely the only writer, which is the root of every lost-purchase incident above. URLs are now set for Production and Sandbox to `<node base>/api/apple/notifications` (the host in `READEST_NODE_BASE_URL`, `services/constants.ts`).

**App Store Connect has no V1/V2 version selector** in the current UI, only Production and Sandbox URL fields. Do not go looking for one. After saving, the Server API keeps rejecting `requestTestNotification` for a while: **propagation took well over 4 minutes** (12 attempts across both environments all failed, then it worked later). Do not conclude the config is wrong from an early failure.

**MERGED #5993** (`24e5cc938`): `ONE_TIME_CHARGE` credits one-time purchases server side, resolving the buyer from `appAccountToken` and reusing `createOrUpdatePayment` (upsert on `apple_original_transaction_id` dedupes against the client flow); it also records `amount`/`currency`, which the client path leaves null. Plus `appAccountToken` plumbing TS -> Rust -> Swift: **StoreKit 1 has no appAccountToken API**, it surfaces `SKMutablePayment.applicationUsername` as that field and **only when the value is a valid UUID**, otherwise the App Store drops it silently, so the code guards with `UUID(uuidString:)`. Review (CodeRabbit) correctly flagged that `createOrUpdatePayment` was check-then-act: a SELECT guard then an upsert that sets `user_id`. Adding a second concurrent writer made it reachable. Fixed by deciding ownership in the write: guarded `update ... .eq('user_id', userId)`, else insert and treat `23505` as proof of another owner. **The same check-then-act still exists in `iap/google/server.ts` with `google_purchase_token` - untouched, worth a follow-up.**

**MERGED #5994** (`270c32acc`): `isDecodedNotificationDataPayload` only checks `"data" in payload`, so a **TEST notification passes it but has no `signedTransactionInfo`** (data keys are only `appAppleId`, `bundleId`, `environment`). `decodeTransaction(undefined)` threw, the route answered 500 so Apple would retry, and delivery recorded `UNSUCCESSFUL_HTTP_RESPONSE_CODE` and retried for days. Guard on the missing transaction, not on `TEST`. This bug PREDATED #5993 and was only reachable once notifications were configured.

**DEPLOYED AND VERIFIED 2026-09-01.** A test notification came back `sendAttemptResult: SUCCESS`, which the old code could not produce (a TEST payload threw and the route answered 500), so that single result proves #5994 is live, and #5994 merged after #5993 so any build containing it contains both. Web deploy is manual (`pnpm deploy`), and merged does not mean live: after both merges but before the deploy the test notification still returned `UNSUCCESSFUL_HTTP_RESPONSE_CODE`. That round trip is the cheapest deploy check for this endpoint. Verify with the App Store Server API `requestTestNotification` + `getTestNotificationStatus` round trip; a green `sendAttemptResult` proves the whole path. Note `appAccountToken` additionally needs an iOS build through review before any real transaction carries one, so until then every notification hits `missing_app_account_token`.
