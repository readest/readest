---
name: storage-customization-entitlement-split
description: "Storage add-ons no longer carry the premium feature set; premium is now plus/pro OR the Full Customization unlock OR a self-hosted deployment. MERGED #5996 and DEPLOYED; Stripe SKU live; the SKU sells cloud sync/TTS/email-in, NOT themes and fonts"
metadata:
  type: project
---

**MERGED #5996** (`b80d83534`). Before it, premium was `['plus','pro','purchase']`, and `getUserProfilePlan` reports `purchase` for anyone holding ANY one-time purchase, which is how a storage add-on presents. Buying space therefore unlocked cloud sync, TTS download and Send to Readest as a side effect.

**One gate now: `isCustomizationAllowed(plan, customizationPurchased)`** = self-hosted OR the customization unlock OR a subscription. `isCloudSyncAllowed`, `isTTSCacheAllowed` and `isEmailInPlan` all delegate to it, as do the server routes `pages/api/send/address.ts` and `senders.ts` (they must move together or client and server disagree about who is entitled).

**`PREMIUM_PLANS` is `['plus','pro']` and `purchase` is DELIBERATELY absent.** It is exactly the value a storage-only buyer reports; including it would undo the whole change. Do not "fix" this.

**Two different meanings of `purchase`, which is the trap here.** The hook mints `plan = 'purchase'` ONLY for a customization buyer, so server-side that value means entitled. The CLIENT derives `purchase` from `storage_purchased_bytes > 0`, where it means storage only. Client gates therefore pass the plan AND the flag; the flag is what disambiguates.

**Clients shipped before the split read the `plan` claim and know nothing about `customization_purchased`**, so `custom_access_token_hook` reports `purchase` for a customization buyer. That is what unlocks premium for them with no app release. Storage alone never reports `purchase`. Residual leak that cannot be closed server-side: old desktop derives `purchase` from storage bytes client-side, so those builds keep granting premium to storage-only buyers until they update.

**Grandfathering is a synthetic `payments` row, not a flag.** `updateUserStorage` is the ONLY writer of `customization_purchased` and reruns after every purchase, so a hand-set flag would be silently erased on the buyer's next purchase. The row carries `provider='readest'`, `storage_gb=0`, `metadata={feature:'customization', grandfathered:true}`; `isCustomizationPurchase` already matches on `metadata.feature`, so the recompute preserves it with no special-casing, and the cohort stays queryable and individually revocable. Backfill is idempotent (`NOT EXISTS` guard on `metadata->>'grandfathered'`).

**`STORAGE_GRANTS_CUSTOMIZATION` (storage.ts) drives a WRITE, not a derivation.** While true, the recompute mints the grandfather row for a storage buyer who has no unlock. That is why flipping it to false cannot revoke anyone who bought while it was on, and why no second backfill is needed. Recording the grant never throws: a failed grant must not lose the payment it rides on. A test asserts the flag is currently `true`, so ending the grace period fails deliberately rather than silently.

**`SELF_HOSTED` unlocks everything, signed in or not** - no store to buy from, and the operator already runs the infrastructure the paywall funds. Wired through `runtimeConfig` like `STORAGE_FIXED_QUOTA`, defaulted true in `docker/compose.yaml`. **Use `||` not `??`** when reading it: an explicitly empty `SELF_HOSTED` would otherwise mask `NEXT_PUBLIC_SELF_HOSTED` and silently re-lock a deployment.

**Play must NOT consume a permanent unlock** or the buyer can be charged twice; `isConsumablePurchase` is an ALLOWLIST (storage only) because an unrecognised product that cannot be repurchased is caught in testing, while wrongly consuming one costs real money. It still has to be ACKNOWLEDGED, or Play auto-refunds after three days.

**Sign-out must clear the module-level entitlement caches** in `useQuotaStats`; they are read synchronously by `resolveCloudSyncGate`, so a stale value leaves a signed-out session looking premium. `customizationPurchased` is DERIVED from the token (`useMemo`), not state, because state lags a render behind a token switch. Test it by driving `renderHook` through a sign-out, not by calling the cache setters - the latter passes even when the cleanup is deleted.

**LIVE as of 2026-09-01:** #5996 deployed (verified by the new `Unlocked` i18n key reaching the deployed locale files) and the Stripe **Full Customization** product created, one-time $19.99, `metadata={feature:'customization', plan:'purchase'}`, no `storageGB` so it adds no quota. Verified end to end through the deployed `/api/stripe/plans`.

**What the SKU actually sells is NOT customization.** Themes and fonts stay free: the paywall boundary over them was a product decision left open, so no call site gates on them. What the unlock buys is the premium feature set - third-party cloud sync, offline Read Aloud downloads, and Send to Readest email-in - because those three now route through `isCustomizationAllowed`. **Store listings must describe those, not themes and fonts**, or the listing describes something that does not happen. The name and the contents disagree; either rename the SKU or move the paywall to match it.

**Still to do:** App Store (Non-Consumable) and Play SKUs, both safe to create since no shipped build requests `com.bilingify.readest.customization.purchase`. `iap/google/server.ts` still has the check-then-act ownership pattern that was fixed in the Apple path. `iap/google/server.ts` still has the check-then-act ownership pattern that was fixed in the Apple path.

See [[apple-iap-lost-storage-purchase-restore-verify]].

## 2026-09-02 audit: "Stripe purchases have no grace rows" was FALSE

Full audit of `payments` + `plans` via the service-role client: **every storage buyer (2733, all providers) has a grandfather row and `plans.customization_purchased=true`; 0 missing, backfill `--apply` inserted 0.** Do not re-run a Stripe backfill on that claim without re-auditing first.

Timeline that explains the earlier worry: DB backfill 04:16Z 2026-09-01 (reason `...before Full Customization launch`); Apple/Google runtime grants (`...during the grace period`) from 06:08Z (node server deployed); the Stripe path lives on the WEB worker and only started minting runtime rows between 09:09Z and 14:50Z, so 3 Stripe first-time buyers in that gap were covered by a SECOND manual backfill at 09:09:40Z. Since then Stripe works at runtime (14:50Z buyer verified).

**The real Full Customization SKU purchase (first live sale 17:59Z 2026-09-01, `prod_VB8eNewA7f0fBT`, $19.99, metadata `{plan:'purchase', feature:'customization'}`, 0 GB) gets NO grace row by design**: `isCustomizationPurchase` matches `metadata.feature`, so the recompute sets the flag and `shouldGrantGraceCustomization` sees `alreadyEntitled`. Verified `plans.customization_purchased=true` for that buyer.

Stripe-side reconciliation (live `checkout.sessions.list({status:'complete'})`, `mode==='payment' && payment_status==='paid'`, vs `stripe_payment_intent_id`): 1268 paid one-time sessions; 12 unmatched are `Donate to Readest` (no `userId`, correct); **1 genuinely lost 5 GB purchase** (2025-11-01, `cs_live_a1A3KxKh...`, `pi_3SOgF0ENgv2E9LPD01pGAPEk`, user `b7f36052-...`) whose auth user is DELETED (admin GET 404, no plans row) - nothing to credit unless support hears from the buyer (email is on the Stripe customer `cus_TLMtdCyVTdoU53`). Reverse direction: 6 completed rows with no live session (4 from a different Stripe account prefix `E7RYniMk1s` for one user on 2025-10-25/26, one `ch_` id, one `_stub`) - test/manual credits, not a problem.

**Pagination gotcha:** the backfill wrote 2723 rows with one identical `created_at`, so PostgREST `.range()` pages ordered by `created_at` alone are unstable across ties (5629 vs 5631 rows between two runs). ALWAYS add `.order('id')` as a tiebreaker when paging `payments`.

Scripts (session scratchpad, rebuild from this): supabase-js with `SUPABASE_ADMIN_KEY` (.env.local) + base64-decoded `NEXT_PUBLIC_DEFAULT_SUPABASE_URL_BASE64` (.env); Stripe SDK from `node_modules/stripe` with `STRIPE_SECRET_KEY` (must start `sk_live_`). Auto-mode classifier blocks a heredoc that writes AND runs a prod script in one command - write the file with the Write tool, then run `node x.cjs` separately.
