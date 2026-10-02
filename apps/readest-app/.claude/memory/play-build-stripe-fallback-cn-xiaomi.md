---
name: play-build-stripe-fallback-cn-xiaomi
description: "Play 0.12.10 shipped the macOS App Store frontend (DIST_CHANNEL=appstore), so hasIAP=false and every Android purchase went to Stripe"
metadata:
  node_type: memory
  type: project
  originSessionId: 35fe2380-a87c-428a-9249-899da71662ea
  modified: 2026-09-30T03:33:59.820Z
---

2026-09-30: Play 0.12.10 (versionCode 12009, rolled out 2026-09-28) sent Android purchases to Stripe instead of Google Play billing. A CN user left a Play review ("suddenly can't pay on Google"). chrox had bought through Play on the same Xiaomi before.

**ROOT CAUSE (proven from the shipped binary):** the frontend embedded in the Play `libreadestlib.so` was built with `.env.apple-appstore.local`:
- `hasIAP="ios"===A`: `DIST_CHANNEL === 'playstore'` was folded to false.
- `canCustomizeRootDir=!1`: `DIST_CHANNEL === 'appstore'`.
- `"apple"===e&&(E?.isIOSApp||1)`: `NEXT_PUBLIC_USE_APPLE_SIGN_IN=true`, which ONLY the macOS App Store env file sets.
- Knock-on effect: Sign in with Apple on Play Android takes the native-Apple branch.

**MECHANISM (proven from Gradle daemon log `~/.gradle/daemon/8.14.3/daemon-43062.out.log` + the macOS stamp `tauri.appstore.conf.json` bundleVersion 20260922.053953):** the macOS App Store release and the Play release RAN CONCURRENTLY on 2026-09-22.
- Without `--apk`/`--aab`, `tauri android build` runs Gradle TWICE, APKs then AAB (`tauri-cli/src/mobile/android/build.rs:254`).
- Pass 1 (APKs) ran 05:34:18-05:41:48. The macOS script started 05:39:53, and its `pnpm build` rewrote the shared `out/`.
- Pass 2 (AAB) ran 05:41:49-05:51:28. Cargo recompiled (aarch64 took 2m43s, not "Fresh") and embedded the macOS `out/`. That AAB was uploaded.
- It's NOT a stale cache: sequential mac -> play `pnpm build` gives a correct `out/` (reproduced), and Tauri tracks `out/` via `include_bytes!`.
- chrox CONFIRMED that two release builds sometimes run at once in two terminal windows (the chain in one shell is sequential and safe). History shows another overlap on 05-31 (Play 03:42, mac 03:51).
- Proposed fixes: a lock in all release scripts, plus a post-build AAB frontend check. Not yet implemented.

**Traps I fell into. Do not repeat them:**
- `hasUpdater=false` does NOT prove the Play env was applied: both Apple env files also set `NEXT_PUBLIC_DISABLE_UPDATER`.
- The prices on the plan cards don't identify the provider: the Stripe and Play list prices are the same.
- No `BillingManager` logs at all simply means `hasIAP` was false.
- The device was fine. A probe app built with the same libraries (play-services-base 18.5.0, billing 9.1.0) got GMS `SUCCESS` and billing setup `OK`.

**Recipe: read the shipped frontend of a Play build.** `adb shell pm path` → pull the splits → unzip `lib/arm64-v8a/libreadestlib.so`. Tauri stores assets as brotli blobs behind R_AARCH64_RELATIVE relocs: (key ptr, len, value ptr, len) tuples. Walk `.rela.dyn`, match addends to `/_next/static/chunks/*.js` key addresses, then `brotli -d` the value. The script is ~50 lines of python, stdlib + the brotli CLI.

Related: [[play-billing-not-configured-6040]]
