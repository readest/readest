---
name: cross-provider-plan-clobber-stripe-google
description: plans.plan is written by Stripe and Google/Apple handlers that each only see their own provider, so cancelling in one provider downgrades a user still paying through another
metadata:
  type: project
---

CONFIRMED LIVE in production 2026-09-16 while cleaning up a support ticket for a user who
was billed by Stripe and Google Play at the same time. FIXED same day, MERGED #6228 (5949a6db9)
— but UNDEPLOYED, so the live webhooks keep clobbering until the web deploy ships. NOT
verified against a real migrated account; the ticket that surfaced it was repaired by hand. (Account identifiers deliberately
omitted: this directory is git-tracked in a public repo.)

`plans.plan` is a single column with **multiple writers that each query only their own
provider**. Neither side checks the other, so whichever provider transitions last wins:

- `src/libs/payment/stripe/server.ts:45` `getHighestActivePlan()` calls
  `stripe.subscriptions.list({customer})` ONLY. No Google/Apple awareness. With the last
  Stripe sub cancelled it reduces to `'free'`, and `handleSubscriptionDeleted`
  (`src/app/api/stripe/webhook/route.ts:204`) writes `plan:'free', status:'cancelled'`.
- `src/libs/payment/iap/google/server.ts:96` `createOrUpdateSubscription()` writes
  `plan: isEntitledStatus(status) ? plan : 'free'` with no Stripe awareness. A genuine
  Play `EXPIRED` RTDN flows straight to it.

**Observed, not theorised:** cancelling the user's Stripe Pro flipped the row to
`plan=free status=cancelled` within the same second, despite an ACTIVE Google Play Pro in
`google_iap_subscriptions`. Free = 500 MB against ~9.5 GB stored -> instant lockout with the
"insufficient storage" error. Repair = `plans.update({plan:'pro',status:'active'})` AFTER the
webhook lands — poll for the downgrade first, or the webhook overwrites the repair.

The guard at `iap/google/notifications.ts:148` does NOT help — it only suppresses downgrades
when *re-verification fails* on non-terminal events.

**Blast radius:** every user who migrates between Stripe and an IAP store. Play->Stripe breaks
immediately on cancel; Stripe->Play breaks later, on the Play expiry date.

Fix as implemented: new `src/libs/payment/entitlements.ts` exposing `resolveUserPlan(userId,
{stripeCustomerId?, entitledPlan?})`, which maxes the highest plan across Stripe subs +
`google_iap_subscriptions` + `apple_iap_subscriptions`. All FOUR writers of `plans.plan` now
go through it (stripe/server, the webhook's cancel path, google/server, apple/server).

GOTCHA that the existing tests caught: the IAP tables store `purchase.status === 'active' ?
'active' : 'expired'`, so a billing GRACE PERIOD is persisted as `expired` and the row cannot
be the entitlement source for the provider currently being handled. That is why the IAP
handlers pass their own `entitledPlan` in rather than reading back the row they just wrote.
Nothing else in the codebase reads that status column, so widening the stored vocabulary is
possible later — I did not, because the schema is not in this repo and a CHECK constraint
could not be ruled out.

Same family as [[group-metadata-row-lww-clobber-5911-5912]] and
[[google-rtdn-worker-verify-downgrade-incident]].

CodeRabbit caught the same bug reintroduced inside the fix itself (fb3ec39fc): the `customers`
lookup discarded its `error`, and since supabase-js is NOT configured with `throwOnError` a
failed read fell through to `'free'`. Use `maybeSingle()` + `if (error) throw error` — `single()`
reports an empty result as an error, so it cannot tell "no Stripe customer" from "lookup failed".
RULE for this codebase: any read whose empty result would downgrade an entitlement must throw,
never return empty.

STILL OPEN: users who migrated providers BEFORE 2026-09-16 may already be sitting on
`plan=free` while paying. A read-only sweep of `plans.plan` against all three entitlement
sources would size the damage; never run.

Related: a goodwill storage grant is a synthetic `payments` row (`provider:'readest'`,
`storage_gb:N`, `status:'completed'`) + rerun of the `updateUserStorage` recompute — never a
direct write to `plans.storage_purchased_bytes`, which `src/libs/payment/storage.ts:125`
derives and overwrites. Any grant > 0 GB also trips `shouldGrantGraceCustomization`
(`storage.ts:51`), permanently unlocking Full Customization. See
[[storage-customization-entitlement-split]].
