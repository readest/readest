---
name: api-route-auth-audit-2026-08
description: "Audit of all 29 src/app/api routes for caller auth vs upstream-credential passthrough (2026-08-31); hardcover + opds are unauthenticated relays, google RTDN fails open"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6981cf12-3457-45a5-8161-d15457b41f63
  modified: 2026-08-30T17:10:11.565Z
---

Audited every `route.ts` under `apps/readest-app/src/app/api/` on 2026-08-31 while fixing
the Notion proxy. KEEP THESE FINDINGS PRIVATE - see [[feedback-no-prod-metrics-in-public]];
#5834 was deleted for exposing prod data. Do not put them in a public issue or PR.

## The distinction that matters
Forwarding a caller-supplied UPSTREAM credential is NOT authentication. Three routes do
that with no caller check at all:
- `hardcover/graphql` - checks only that `authorization` is non-empty (:6-9), forwards it
  plus arbitrary GraphQL to api.hardcover.app. No origin check, no body cap, no timeout,
  no rate limit. Worst of the three.
- `opds/proxy` - `?auth=` is the upstream OPDS catalog credential (:141-143), plus
  arbitrary `?headers=`. Real protection is SSRF only (host blocklist + per-redirect
  revalidation :64-79). Effectively an open HTTP proxy with `ACAO: *`.
- `notion/[...path]` - FIXED 2026-08-31 in PR #5949 (`validateUserAndToken` + the Notion
  secret moved to `x-notion-token`).

## The house pattern to copy
`azure-translate` / `yandex-translate`: `validateUserAndToken` -> 403, then origin==host,
then endpoint allowlist, then a per-user 60/min + 3-concurrent budget, a 100k body cap
checked against BOTH content-length and the decoded body, and a 15s timeout.

## Verified by hand (not just the agent's word)
- **Google RTDN fails open.** `google/notifications/route.ts:24-26`: if
  `GOOGLE_RTDN_VERIFICATION_TOKEN` is unset it logs a warning and PROCEEDS. And
  `handleVoidedPurchase` (`libs/payment/iap/google/notifications.ts:169-210`) acts on
  `purchaseToken` alone with NO Play API re-verification - it goes straight to
  `createOrUpdateSubscription(..., 'revoked')` / `markPaymentRefunded`.
  SEVERITY CONTEXT: per [[google-rtdn-worker-verify-downgrade-incident]] the push URL was
  repointed to node.readest.com and the endpoint was probed live (401 on bad token), so
  the token IS present in prod. This is a latent hazard / defence-in-depth gap, NOT a live
  exploit. Fix = hard-fail when the env var is absent, and re-verify voided purchases.
- **Share token comment is false.** `libs/shareServer.ts:15-17` says "only the hash is
  persisted to the database. A leaked DB read therefore cannot recover live bearer
  credentials." But `share/create/route.ts:157-158` inserts BOTH `token_hash: hash` AND
  `token: raw`, and `share/list:66` reads it back. Either drop the column or fix the
  comment; do not leave a false security claim in the source.

## Reported but NOT independently verified by me
- AI routes (`ai/chat:21`, `ai/embed:18`) fall back to the server's `AI_GATEWAY_API_KEY`
  with a caller-chosen `model` and no per-user budget - billing abuse, not auth.
- `opds/proxy` copies upstream response headers wholesale (:231-237); whether workerd's
  `Headers.entries()` yields `Set-Cookie` is UNCONFIRMED.
- `statsArchive.ts:287` compares the compact token with `!==`, not constant-time.

## Fine, and why
`stripe/webhook` (HMAC via `constructEvent`), `apple/notifications` (JWS x5c chain to
Apple Root CA G3 - no caller auth needed by design), `stats/compact|restore` (shared
secret + 503 when unconfigured + restore 409s unless compaction disabled),
`share/[token]/*` (capability URL, ~130-bit token, single `resolveActiveShare` gate,
expiry + 50-share cap + 300s presign), `stripe/check` (session ownership check, the
GHSA-pv88-3727-j7v8 fix).

## NOT covered
`src/pages/api/` has ~19 more web-reachable routes (kosync, deepl/translate, bookorbit,
send/*, storage/*, sync*, user/*). `utils/network.ts:38` names `/api/kosync` and
`/api/send/fetch-url` as fellow client-supplied-URL fetchers, so the relay analysis above
is INCOMPLETE for the full surface. Audit those before claiming the app is clean.

Related: [[notion-sync-pr-5949-review]], [[custom-headers-kosync-bookorbit-5570]]
(the kosync proxy open-relay fix is likewise unmerged).
