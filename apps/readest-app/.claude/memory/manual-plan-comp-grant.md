---
name: manual-plan-comp-grant
description: How to comp a user a Plus/Pro plan by hand (direct plans.plan write) and why it is fragile against resolveUserPlan
metadata:
  type: project
---

Comped plan = `plans.update({plan:'pro', status:'active'}).eq('id', userId)` via the service-role client (env as in [[account-merge-recipe]]; inspect first with `scripts/db/inspect-accounts.mjs <email>`). First done 2026-09-22 for an educator request (lifetime/customization buyer, Google storage add-ons). Account identifiers deliberately omitted (public repo).

**Fragile:** nothing records the comp. `resolveUserPlan` (`src/libs/payment/entitlements.ts`) only sees Stripe + IAP subscriptions, so ANY subscription event for that user (Stripe webhook, Play/Apple sub notice) rewrites `plans.plan` and erases the comp. Storage purchases do NOT touch `plan` (`updateUserStorage` writes only storage/customization). If comps become common, add a comp source to the resolver (e.g. a `payments` row with `provider:'readest'`, like the grandfather row in [[storage-customization-entitlement-split]]).

User sees Pro only after token refresh / sign-out+in (plan comes from the JWT claim).
