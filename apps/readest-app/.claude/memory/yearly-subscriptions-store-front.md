---
name: yearly-subscriptions-store-front
description: Yearly Stripe/App Store/Play subscription tiers + modernized plans grid on the user page; MERGED #5989, Stripe yearly prices live, mobile SKUs still to create
metadata:
  node_type: memory
  type: project
---

**MERGED #5989 and DEPLOYED.**

**Stripe yearly prices are LIVE** (created 2026-09-01): recurring yearly prices
on the **existing** Plus and Pro products, never new ones, because
`getSubscriptionPlan` reads `product.metadata.plan` and a new product would
carry no plan. Verified against the deployed `/api/stripe/plans`: monthly
occupies the first slots and yearly follows, which is the ordering that keeps
clients <= 0.9.67 on the price they have always been shown.

**The mobile SKUs still do not exist** — chrox creates them. Shape agreed:
standalone `com.bilingify.readest.yearly.plus` / `.pro`, Apple in the **same
subscription group** as monthly (free crossgrade, Apple handles proration), Play
as separate subscription ids (NOT base plans, which would need offer-token work
in BillingManager).

**Enable "Customers can switch plans" in the Stripe Billing Portal config**, or
`shouldUseBillingPortal` sends a yearly upgrader to a portal that only offers
Cancel.

**"Donate to Readest" reaches `/api/stripe/plans` with `plan: null`** and always
has. **Do NOT deactivate it** - it belongs to the separate donation page, which
is not in this repo, and killing the price would break that flow. It is inert in
the app (`purchasableProducts` filters on `plan === 'purchase'`, and clients
<= 0.9.67 cannot match a null plan), so it was left alone deliberately.

If it ever needs removing from the app's store front, filter it server-side in
`/api/stripe/plans` on `!!product.metadata.plan`, never in Stripe. That also
restores an invariant the route already assumes: `StripeProductMetadata` types
`plan` as required, and the cast quietly lies for this product. Two smaller
reasons it might be worth doing later: it consumes a slot in the price page
(the catalog sits at 10, exactly Stripe's old default, so the `limit:100` fix is
load-bearing), and `purchasableProducts` sorts on `a.price - b.price`, which
would go NaN if a null-priced product ever gained `plan: 'purchase'`.

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
