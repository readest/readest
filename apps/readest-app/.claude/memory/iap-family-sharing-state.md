---
name: iap-family-sharing-state
description: "As of 2026-11-05 only the 1 GB storage IAP has Apple Family Sharing on; Full Customization is off, and the app has never handled a family member's restore"
metadata:
  node_type: memory
  type: project
  originSessionId: fd2387b7-f1a3-4eb8-a19b-d7226772a8f7
  modified: 2026-11-05T09:27:21.376Z
---

Checked 2026-11-05 through the App Store Connect API (`familySharable` on `/v1/apps/6738622779/inAppPurchasesV2`):

- On: `storage.1gb.purchase`
- Off: `customization.purchase`, `storage.2gb/5gb/10gb.purchase`

That 1 GB product is why the App Store page reads as "some in-app purchases support Family Sharing", which prompts support mail. The owner has been told and has not decided whether to enable it for Full Customization.

**Why:** enabling it can't be undone on Apple's side, and the code doesn't handle it: nothing reads Apple's ownership type, and `apple/server.ts` binds each `apple_original_transaction_id` to one Readest account. A family member's restore is untested, including for the 1 GB product that already has it on.

**How to apply:** re-read the flag through the API before answering family sharing mail. In the App Store Connect UI, the blue 开启 link under 家人共享 means "Turn On", so the feature is OFF, and a11y-based tools misread it as an ON state. Don't click it. Entitlements follow the Readest account; `hasIAP` is false on macOS, so Mac users buy on iOS and sign in. See [[private-apple-iap-lost-storage-purchase-restore-verify]].
