---
name: gdrive-provider-multipr-status
description: "Google Drive file-sync provider — phased multi-PR build status, what shipped in PR1 and what each later PR adds"
metadata: 
  node_type: memory
  type: project
  originSessionId: 50e2c2b8-ca61-4c33-acae-cd5d2c9aa93f
---

Adding **Google Drive as a second `FileSyncProvider`** for the merged file-sync engine (the WebDAV refactor, PR #4784). Approved plan: `/Users/chrox/.claude/plans/floating-chasing-feather.md`. Research + reuse map: [[gdrive-sync-provider-research]]. Author of the reference (`ratatabananana-bit/Readest-google-drive-mod-patcher`, AGPL-3.0) granted explicit reuse permission; adapted files carry attribution headers.

**Shipped across multiple PRs (decided at the autoplan gate; no BYO client, official iOS-type client only).**

**PR1 — DONE (built, all gates green, committed locally, NOT pushed).** Branch `feat/gdrive-sync-core` (worktree `/Users/chrox/dev/readest-feat-gdrive-sync-core`), commit `1a0065818`. 25 files / ~2.6k lines, ~81 new unit tests, full suite 6377 passing + lint + format clean. Contents under `src/services/sync/providers/gdrive/`:
- `GoogleDriveProvider.ts` — Drive v3 over `FileSyncProvider`; id-addressed resolution + per-instance id cache; create-then-name upload; real `ensureDir`; `files.list` pagination; Retry-After 429/5xx backoff; per-path folder-creation locks + deterministic dup-collapse (smallest id); stale-id eviction; `mapDriveError` (403 split rate-limit→NETWORK vs permission→AUTH_FAILED). Factory `createGoogleDriveProvider(auth, fetchFn, {sleep?})`; streaming omitted.
- `auth/` — `pkce`, `parseRedirect` (target + CSRF, takes `expectedRedirectUri`), `reverseDnsRedirect`, `tokenStore` (no client secret), `oauthFlow` (DI).
- `PersistedDriveAuth.ts` — single-flight refresh + re-check, carries old refresh_token, one save; `accountLabel` via `about.get`.
- `driveTokenStore.ts` — `TokenPersistence` + `KeychainTokenPersistence` over keyed secure-KV; `createDriveTokenPersistence()` returns null off-Tauri (NO ephemeral fallback for refresh token).
- `driveRest.ts` — pure builders + pagination + `aboutUrl`.
- `buildGoogleDriveProvider.ts` (env client id + keychain), `file/providerRegistry.ts` (`createFileSyncProvider`/`getEnabledFileSyncBackends`).
- Shared `file/providerSemanticContract.ts` test helper run for BOTH WebDAV + Drive.
- `utils/bridge.ts` — TS wrappers `set/get/clearSecureItem` (`plugin:native-bridge|*_secure_item`).

**DEVIATION from plan:** the native keyed secure-KV implementation (Rust desktop/mobile + Kotlin + Swift + permissions) was DEFERRED out of PR1 — nothing in PR1 calls it (no UI/sync wiring), and 4 languages of un-runnable native code don't belong in a "CI-testable, no-platform" PR. The TS contract exists + is mock-tested. Native impl lands with **PR3 (desktop OAuth)**, which first exercises it and can live-verify.

**PR2 — DONE (foundation only; committed `9ba097ea2`, UNPUSHED, on same `feat/gdrive-sync-core` branch).** Full suite 6403 passing + lint + format clean.
- `GoogleDriveSettings` type (mirrors WebDAVSettings minus URL/creds/rootPath, +`accountLabel`) in `types/settings.ts` + `SystemSettings.googleDrive`; `DEFAULT_GOOGLE_DRIVE_SETTINGS` in `constants.ts`.
- `googleDrive.deviceId`/`lastSyncedAt` added to `BACKUP_SETTINGS_BLACKLIST` (backupService.ts) + backup-settings test.
- `webdavSyncStore`→`store/fileSyncStore.ts`: per-backend progress keyed by kind + GLOBAL library-sync mutex (`beginSync(kind,label)` returns false if another holds lock). Migrated `WebDAVForm` + `IntegrationsPanel`; WebDAV behavior unchanged. `fileSyncStore.test.ts`.
- **DEFERRED to PR3 (deliberate):** `useWebDAVSync`→`useFileSync` hook generalization + `WebDAVForm`→`FileSyncForm` extraction + visible Drive Integrations row/connect UI. Rationale: until Drive connects (needs OAuth), the multi-provider hook paths can't run and `FileSyncForm` would be a single-use abstraction (violates YAGNI); also the autoplan gates these on a live WebDAV Sync-now check. Do them WITH PR3.

**PR3 — IN PROGRESS (3 commits, all gates green: full suite 6411 passing + rust fmt/clippy/test + lint/format). UNPUSHED on `feat/gdrive-sync-core`.**
- `ff1ffe717` native keyed secure-KV: `set/get/clear_secure_item` across Rust desktop (keyring keyed by item key) + mobile forward + models/commands/lib/build/default.toml + Kotlin (EncryptedSharedPreferences `readest_secure_items_v1`) + Swift (Keychain, service `com.bilingify.readest.secure-items`). Rust compiles+clippy+fmt clean; permission files regenerated (passphrase preserved).
- `602f41406` desktop OAuth machinery: `auth/oauthDesktop.ts` (`runDesktopDeepLinkOAuth`, DI, 3 tests) + `src-tauri/src/spawn_fresh_browser.rs` (registry default-browser cold-spawn on Windows / no-op macOS+Linux; winreg Windows-only dep; pure-helper tests; registered `#[cfg(desktop)]`) + `connectGoogleDrive.ts` (`connectGoogleDrive`/`disconnectGoogleDrive`, fail-loud token save, 4 tests). `DRIVE_FILE_SCOPE='https://www.googleapis.com/auth/drive.file'`.
- `5efbe6b2f` ingress filter: `isGoogleOAuthRedirectUrl` (scheme-prefix match) + filter in `useAppUrlIngress` dispatch so the reverse-DNS redirect never reaches book-import consumers (OAuth runner catches via own listeners). Tested.

**Official client id PROVISIONED:** `209390247301-ctpmep68ppfa56r1b8tr35e4qi4p60kq.apps.googleusercontent.com` (iOS type, no secret, `drive.file`). Baked as default in `getGoogleClientId` (env `NEXT_PUBLIC_GOOGLE_CLIENT_ID` overrides); reverse-DNS scheme `com.googleusercontent.apps.209390247301-ctpmep68ppfa56r1b8tr35e4qi4p60kq` registered in `tauri.conf.json` desktop+mobile deep-link. Commit `7a2ac3671`.

**Drive UI DONE (commit `c657c34f0`):** `FileSyncForm` (shared sync controls extracted from WebDAVForm, parameterized by kind, builds provider via registry; WebDAVForm refactored to use it, behavior unchanged) + `GoogleDriveForm` (OAuth Connect/account/Disconnect + FileSyncForm) + `googleDriveConnect.ts` (assembles env client id + keychain + desktop runner) + IntegrationsPanel "Google Drive" row gated on `appService.isDesktopApp`. Full suite 6412 green.

**PR3 REMAINING:**
- **LIVE VERIFICATION (needs the user — real Google sign-in):** `pnpm tauri dev` → add own Google account as a Test user in the consent screen (Testing mode caps + gates) → Settings → Integrations → Google Drive → Connect → browser → grant → "Connected as <email>" → add book / Sync now → confirm `Readest/books/<hash>/{config.json,cover.png}` in Drive. Windows cold-browser fallback.
- **Reader-hook auto-sync (deferred):** generalize `useWebDAVSync`→`useFileSync` (per-provider state maps, async Drive provider build in the hook) so Drive auto-syncs per-book while reading like WebDAV. Manual Sync-now already works without it; do after live-verifying the base.
- Consent screen → Production before GA (testing caps 100 users).
- PR4 Android OAuth (Custom Tab + manifest scheme), PR5 iOS OAuth (authWithSafari scheme param + Info-ios.plist). Later: Drive resumable upload for `syncBooks` on mobile.
- Ops/launch blocker: create Google Cloud project (iOS client, `drive.file`) + consent screen to production (testing caps 100 users).
- PR4 Android OAuth, PR5 iOS OAuth. Later: Drive resumable upload to unlock `syncBooks` on mobile.
- Ops/launch blocker: create the Google Cloud project (iOS client, `drive.file`) + set consent screen to production (testing caps 100 users).
