---
name: onedrive-oauth-callback-slash-5253
description: "#5253 OneDrive OAuth hang/fail: Microsoft appends / to scheme://host callbacks; fixed in #5479 + Rust bridge was dropping TS fields"
metadata: 
  node_type: memory
  type: project
  originSessionId: 9514654c-db01-441e-b22c-ec393f217bb0
  modified: 2026-08-04T04:36:47.734Z
---

**#5253 / PR #5479 (MERGED 2026-08-04): OneDrive OAuth callbacks hung Android, failed desktop.**

- Root cause: Microsoft canonicalizes a path-less redirect URI to a trailing slash, so registered `readest-onedrive://auth` comes back as `readest-onedrive://auth/`. `parseRedirect` compared pathname strictly (`''` vs `'/'`) and threw on desktop; Android's `onNewIntent` only matched the hardcoded Supabase/Google callback shapes so the Custom Tab invoke never resolved.
- Fix shape: normalize ONLY empty-vs-root path in `parseRedirect.ts` (also added host/username/password comparison, which the old protocol+pathname guard lacked); Android matches per-request via `OAuthCallbackTarget` passed as `callbackUrl` through the bridge.
- **Rust `models.rs` AuthRequest silently drops unknown TS fields at the `run_mobile_plugin` hop** (serde ignores unknowns). `callbackScheme` never reached iOS before #5479, so ASWebAuthenticationSession always used the fallback `readest` scheme — adding fields to the TS interface is NOT enough, they must be added to the Rust struct too (`skip_serializing_if = "Option::is_none"`).
- The PR as submitted did not compile (Kotlin expression-body `return` in `OAuthCallbackTarget.parse`); I pushed the block-body fix. See [[android-kotlin-unit-test-gradle-recipe]] for why CI missed it and how to compile locally.
- iOS/Android device verification of the OneDrive flow still pending as of merge.
