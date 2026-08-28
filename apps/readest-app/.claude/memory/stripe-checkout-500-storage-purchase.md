---
name: stripe-checkout-500-storage-purchase
description: "POST /api/stripe/checkout 500s on live storage add-on purchases; root cause still unconfirmed, diagnostics shipped in #5896"
metadata: 
  node_type: memory
  type: project
  originSessionId: 732abed7-fa33-4c4d-b613-ea8082ae2e5b
  modified: 2026-08-27T05:05:30.452Z
---

`POST https://web.readest.com/api/stripe/checkout` returns 500 for a one-time
storage add-on (`planType: "purchase"`, `embedded: true`, live `price_...`).
Observed 2026-08-27 from an Android dev APK. **Root cause still UNCONFIRMED.**

Ruled out with evidence, do not re-investigate these:

- `ui_mode: 'embedded_page'` is valid. stripe-node 22.1.1 defaults to
  `apiVersion 2026-04-22.dahlia` (`cjs/stripe.core.js`: `props.apiVersion || DEFAULT_API_VERSION`),
  so it does send `Stripe-Version`. Running the route's exact param set against
  test mode returns `cs_test_... ui_mode: embedded_page client_secret: true`.
  The `embedded`/`hosted` -> `embedded_page`/`hosted_page` rename in #3941 is fine.
- `STRIPE_SECRET_KEY` is bound in the worker: `/api/stripe/plans` returns 200
  with `livemode: true` products.

Leading hypothesis: the `customers` row holds a **test-mode**
`stripe_customer_id`. `pnpm dev-web` runs with `NODE_ENV !== 'production'`, so
`getStripe()` (`src/libs/payment/stripe/server.ts`) picks `STRIPE_SECRET_KEY_DEV`
while still writing to the **shared production Supabase**, and
`checkout/route.ts` inserts whichever mode minted the customer. Live-mode
`sessions.create({ customer })` then fails `No such customer`. If true, `/api/stripe/portal`
fails identically for the same account, and the `customers` table cannot tell a
dev row from a live row.

Next step: retry the purchase and read `code`/`param` off the 500 body.
`resource_missing` + `customer` confirms it; a Stripe log entry absent entirely
means the throw is upstream (`createSupabaseAdminClient`).

MERGED #5896 (a913fb1d2) carries the diagnostics, reworked from my version:
non-Stripe errors return a bare `error`, Stripe errors add `code` + `param` and a
**constant** `message: 'Stripe rejected the checkout request'`. The raw Stripe
text is deliberately NOT returned to clients, so `code`/`param` are all you get
without the dashboard.

Gotchas:

- A Play Store build can NEVER reproduce this. `nativeAppService.ts` gates
  `hasIAP = ios || (android && DIST_CHANNEL === 'playstore')`, so store Android
  goes through Google Play billing and never calls Stripe. Dev/sideloaded APKs
  and **all desktop builds** take the Stripe path, so this 500 likely hits
  desktop storage purchases too.
- `pnpm dev-web` talks to Stripe **test** mode, so a live-only failure like this
  will not reproduce locally no matter how the client is pointed.

Related: [[google-iap-consume-storage-purchases]],
[[apple-iap-lost-storage-purchase-restore-verify]]
