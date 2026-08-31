---
name: yearly-subscriptions-store-front
description: Yearly Stripe/App Store/Play subscription tiers + modernized plans grid on the user page; branch feat/yearly-subscriptions, SKUs not yet created
metadata:
  node_type: memory
  type: project
---

Work done 2026-08-30 on `feat/yearly-subscriptions` (worktree
`/Users/chrox/dev/readest-feat-yearly-subscriptions`). **Uncommitted** at
session end; all gates green (lint, 10463 unit, 406 browser, 4 Kotlin).

**The store SKUs do not exist yet** — chrox creates them. Shape agreed:
- Stripe: two new *recurring yearly prices on the existing Plus/Pro products*
  (never new products — `getSubscriptionPlan` reads `product.metadata.plan`).
- App Store / Play: standalone `com.bilingify.readest.yearly.plus` / `.pro`,
  Apple in the **same subscription group** as monthly (free crossgrade), Play as
  separate subscription ids (NOT base plans — base plans would need offer-token
  work in BillingManager).
Shipping is safe before they exist: the Yearly toggle only renders when the
store actually returns a yearly price (`getSubscriptionIntervals`).

**Two latent `/api/stripe/plans` bugs found and fixed, both about OLD clients:**
1. `stripe.prices.list()` had no `limit`, so Stripe's default of **10** applied.
   The catalog was already at ~7-9 active prices; adding two would truncate, and
   because Stripe lists newest-first the entries dropped are the OLDEST — the
   original monthly Plus/Pro. Fixed with `limit: 100`.
2. Clients **<= 0.9.67** predate the interval filter in `getPlanDetails`
   (landed in 42c2825e9, first released **0.9.69**, 2025-08-02) and pick with
   `availablePlans.find((p) => p.plan === userPlan)` — first match in API order.
   A new yearly price would sort first and those clients would render it
   labelled "/month". Fixed by sorting month-before-year in the route. Only
   desktop + non-Play Android are exposed (iOS/Play use IAP, web is always
   current).

**Stripe plan changes now go through the Billing Portal**, not a second
checkout (`shouldUseBillingPortal`: plan is plus/pro AND planType is
subscription). The portal route accepts `flow: 'subscription_update'` and
deep-links to the plan picker. **Requires "Customers can switch plans" enabled
in the Stripe portal config**, else the portal only offers Cancel. This also
fixes the pre-existing Plus->Pro double-subscription hazard.

**Google Play needed `SubscriptionUpdateParams`** (`setOldPurchaseToken` +
`ReplacementMode.WITH_TIME_PRORATION`, Billing 9.1.0): without it a monthly
subscriber buying yearly gets a SECOND subscription and is billed twice. Apple
handles this itself within a subscription group; Stripe via the portal.

**UI:** the swipe carousel (`PlanNavigation`, `PlanIndicators`, touch handlers,
scroll-position sync) is DELETED, replaced by a 1/2/4-column grid +
`BillingIntervalToggle`. Yearly cards lead with the per-month figure and show
"{{price}} billed yearly". Plan badge colours moved off the hardcoded
blue/purple/green palette to base-200/300 tokens — see
[[eink-class-substring-matchers]] for the two e-ink traps that forced this.

**Never claimed anywhere:** which interval the user is currently on. The JWT
carries only the plan tier, so the current-tier card says "Change billing
period", not "Switch to Yearly". Exposing the real interval needs a new
endpoint over the `subscriptions` table — deliberate follow-up.

**Not verified:** no live Stripe/Apple/Google purchase, and the Play billing
change has never run on a device. `AccountActions` still uses hardcoded
`bg-blue-100`/red buttons — out of scope, worth a follow-up pass.
