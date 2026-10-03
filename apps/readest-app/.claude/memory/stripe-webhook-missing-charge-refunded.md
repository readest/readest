---
name: stripe-webhook-missing-charge-refunded
description: "Live Stripe webhook endpoint (web.readest.com/api/stripe/webhook) is NOT subscribed to charge.refunded, so #6436's refund handler never fires; found 2026-10-01, one account repaired by hand"
metadata:
  type: project
---

Found 2026-10-01: a full Stripe refund of a 1 GB storage add-on left `payments.status='succeeded'` and 1 GB in `plans.storage_purchased_bytes`. Stripe emitted `charge.refunded` with `pending_webhooks 0`; `webhookEndpoints.list()` shows the only live endpoint lacks that event. So the handler added by #6436 (`handleChargeRefunded` in `src/app/api/stripe/webhook/route.ts`) is dead until the endpoint's enabled_events includes `charge.refunded`.

**Why:** Stripe only delivers the event types an endpoint subscribes to; shipping a handler is not enough.

**How to apply:** Check the endpoint config before trusting any Stripe-refund revocation. Manual repair = mirror `markPaymentRefunded`: set the row `refunded` (guard on user_id + `stripe_payment_intent_id` + status), then recompute like `updateUserStorage` (sum `storage_gb` over completed/succeeded rows, customization from `metadata.feature`). Write the temp script under `scripts/db/` (ESM resolves node_modules from the file), run with `node --env-file=.env --env-file=.env.local`, delete it afterwards, verify with `inspect-accounts.mjs`. Status on 2026-10-01: endpoint NOT yet fixed; past missed refunds NOT audited. See [[storage-customization-entitlement-split]].
