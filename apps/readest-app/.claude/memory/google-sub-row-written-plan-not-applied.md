---
name: google-sub-row-written-plan-not-applied
description: Play yearly Plus purchase recorded as active in google_iap_subscriptions but plans stayed free/past_due; ROOT = node.readest.com has no STRIPE_SECRET_KEY + millis written to a timestamp column; repaired by hand 2026-09-22
metadata:
  type: project
---

Support ticket 2026-09-22 (identifiers omitted, public repo): user bought `yearly.plus` on Play; app said processing failed. DB: sub row `active`, acknowledged, correct user; `plans` = `free` / `past_due` (leftover from a CANCELED Stripe sub, user has a `customers` row).

So `createOrUpdateSubscription` (`iap/google/server.ts`) upserted the row but never applied the `plans` update. Suspects: `resolveUserPlan` threw on the Stripe leg (500 = "processing fails"), or the unchecked `plans` update errored silently. A later write (RTDN/retry, ~8 min later) didn't fix it either. Check node.readest.com logs for `Failed to update user subscription` to confirm. Could hit any ex-Stripe customer buying on Play.

Repair = `plans.update({plan:'plus',status:'active'})` guarded by `.eq('plan','free')`. Durable (unlike [[manual-plan-comp-grant]]) because resolveUserPlan returns plus from the active IAP row. Related: [[cross-provider-plan-clobber-stripe-google]].

**ROOT CAUSE CONFIRMED from node.readest.com logs:**
1. `Neither apiKey nor config.authenticator provided`: since #6228, `resolveUserPlan` calls Stripe (`getStripe()`) for any user with a `customers` row, and the node.readest.com Vercel project has NO `STRIPE_SECRET_KEY`. Every Play/Apple event for an ex-Stripe customer throws AFTER the sub row upsert and BEFORE the plans update. Fix = add the env var there (config, not code).
2. `date/time field value out of range: "1790006712951"`: `user_cancellation_time_millis` is a timestamp column but server.ts wrote Google's raw millis string; no row ever held a value. Any cancelled-sub event (SUBSCRIPTION_CANCELED RTDN, restore) failed. Fixed on branch fix/google-iap-cancellation-time (8725a5e70), worktree readest-fix-google-iap-cancellation-time.

**Follow-up 2026-09-22:** chrox added STRIPE_SECRET_KEY to node.readest.com. Sweep (active IAP rows vs `plans.plan`) found ONE more victim (App Store monthly Plus, ex-Stripe customer), repaired the same way. Fix PR #6342 OPEN. Re-run the sweep after the redeploy to confirm no new cases.
