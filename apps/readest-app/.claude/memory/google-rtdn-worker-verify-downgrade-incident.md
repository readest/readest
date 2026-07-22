---
name: google-rtdn-worker-verify-downgrade-incident
description: "Google Play RTDN webhook on CF Worker fails verification 100%, fallback downgraded 22 active paying subs to free (Jun 24–Jul 17 2026); restore blocked by upsert order_id conflict-target bug"
metadata: 
  node_type: memory
  type: project
  originSessionId: d0592fc5-54dd-410f-ab3b-c234d4e45c53
---

Production incident found 2026-07-17 (user report: Plus reverted to free, restore fails with "Payment failed").

**Three stacked bugs (all in `src/libs/payment/iap/google/`):**

1. **Verification always fails on the CF Worker.** The RTDN endpoint `/api/google/notifications` (shipped #4701, 2026-06-21) is served by the `readest-web` worker (holds `GOOGLE_RTDN_VERIFICATION_TOKEN` + `IAP_WEBHOOK_AE`), but `googleapis`/`google-auth-library` doesn't run on workerd — the same reason `iap-verify` is routed to `node.readest.com` (`getNodeAPIBaseUrl`). All 30 RTDNs processed since Jun 24 took the verify-failure fallback; the same call with the same creds succeeds from Node.
2. **Fallback downgrades on ANY notification type** (`notifications.ts` `overrideStatus('expired', type)` default case): a healthy SUBSCRIPTION_RENEWED becomes status `expired`, `expires_date=null`, `auto_renew=false`, and `plans` set to `free`. Fallback-row signature: `status='expired' AND expires_date IS NULL`. 22 of 30 rows were still ACTIVE per Google (paying users downgraded); 2 victims re-purchased (paid twice).
3. **Renewals can never be recorded / restore 500s.** v1 `subscriptions.get` returns `orderId` with a `..N` renewal suffix; upsert conflict target was `(user_id, order_id)` so post-renewal writes tried INSERT and violated the `unique_user_purchase (user_id, purchase_token)` constraint → 500 → "Payment failed" on restore. Zero suffixed order_ids in 103 rows = no renewal ever recorded. Fixing bug 1 without bug 3 turns silent downgrades into Pub/Sub 500 retry loops. NOTE: `status` CHECK allows `grace_period`/`billing_retry`, NOT `in_grace_period` — don't write verifier statuses to the row raw.

**Also:** `verifier.ts` bare `catch` swallows the real error as "Not a subscription purchase" (nothing logged); `server.ts` flattens pending/grace/cancelled to `expired` and rewrites `created_at` on every upsert. Apple side unaffected (its handler decodes the signed JWS payload, no outbound googleapis call).

**Why:** googleapis client is Node-only; workerd repro crashed with uncaught "internal error" even at import. Any code that must run in the RTDN path on the worker needs jose+fetch (like the Apple handler) or the push subscription must target node.readest.com.

**How to apply:** fix MERGED+DEPLOYED 2026-07-17 (PR #5163): (b) throw on verify-failure for non-terminal notification types (Pub/Sub retries), (c) upsert onConflict `user_id,purchase_token` + stop rewriting created_at, (d) log real verify errors. Data repair APPLIED 2026-07-17: 23 sub rows + 20 plans restored, 8 genuine expiries left; script idempotent (re-verifies live). Pub/Sub push URL repointed to node.readest.com 2026-07-17 (endpoint probed live, 401 on bad token = RTDN token env present). INCIDENT CLOSED. Watch: next renewal should write a `..N` suffixed order_id + advanced expiry (signature of the fixed path). If the webhook must ever move back to the worker, the verifier needs a jose+fetch rewrite first. Reporter user cc36b1b5 (order GPA.3350-9974-1920-32675, active till Aug 3, fully restored). Related: [[cf-worker-64mb-turbopack-regression]].
