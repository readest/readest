---
name: play-billing-not-configured-6040
description: "All Google Play purchases stopped 2026-09-01 with \"not configured for billing\"; root cause NOT the Billing Library deadline - still open"
metadata: 
  node_type: memory
  type: project
  originSessionId: ed3aa0f7-b561-4b0f-b558-50a9f0950ded
  modified: 2026-09-03T06:25:38.504Z
---

**Symptom (from 2026-09-01):** every Play purchase fails with "This version of the application is
not configured for billing through Google Play." Last successful order 2026-09-01. Reproduced on
Xiaomi 368b0948.

**RETRACTED hypothesis — do not repeat it.** The Billing Library 8.0.0 deadline (Aug 31 2026) is
*not* the cause. Two reasons it fails:
1. The official FAQ (developer.android.com/google/play/billing/deprecation-faq) says the deadline
   gates *publishing* only: "Unmaintained APKs don't need updates; **existing apps still work**,
   but new apps and updates must use supported versions." It is not a transaction kill-switch, and
   no evidence of a server-side turn-off was found.
2. **0.12.6 fails too, and it ships Billing Library 9.1.0.** A BL-version cause cannot explain that.
The Sept 1 date correlation is a coincidence that is very easy to over-fit. It fooled me once.

**Verified facts (device + Play API, all ruled OUT as causes):**
- Both versions fail identically: 0.12.1 (BL 7.1.1, production) and 0.12.6 (BL 9.1.0, internal).
  Read the shipped library from the APK's binary AXML string pool:
  `com.google.android.play.billingclient.version`.
- APK is genuinely Play App Signing-signed (`CN=Android, O=Google Inc.`,
  SHA-256 `E0:E7:60:55:...:5F:51`). The client `debugMessage` "Please ensure the app is signed
  correctly" (`BillingManager.kt:471`) is generic `BILLING_UNAVAILABLE` boilerplate, NOT a signing
  problem. Do not chase signatures.
- `queryProductDetails` **succeeds** and returns localized prices ($9.99/$14.99/$29.99/$49.99), so
  the package is recognized and the IAP catalog is active.
- `launchBillingFlow` returns OK; Play's `ProxyBillingActivity` ->
  `LockToPortraitUiBuilderHostActivity` opens. Only the **server-side acquire** is refused. Finsky
  logs no local reason.
- `googleplay` product flavor built correctly (billing classes present in the dex).
- Play tracks: production 12006, beta 12002, internal 12006.

**Shape of the real cause:** app-wide / account-wide, not version-specific, started ~2026-09-01,
leaves the product catalog intact but refuses acquire. Leading candidate is the **Google Payments
merchant account / payments profile** (unlinked, suspended, or blocked pending tax/identity
verification), or an account-level monetization restriction. NOT CONFIRMED.

**Decisive checks (Play Console, not reachable from the API):**
Monetization setup -> is a merchant account still linked; payments.google.com -> profile status /
"action required"; Play Console Policy status -> account-level restrictions; Order management ->
whether orders are refused or simply absent.

**Useful tooling:** `google_play_track_version_codes` (fastlane, read-only) and Android Publisher
`edits/{id}/tracks` GET work with `certs/google/readest-fastlane-7d76b7519901.json`. The
`inappproducts` endpoint is dead ("Please migrate to the new publishing API", 403).

Related: [[feedback-always-verify-on-xiaomi]], [[google-iap-consume-storage-purchases]]
