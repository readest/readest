---
name: gdrive-sync-provider-research
description: Research on the ratatabananana-bit Google Drive mod for building a Drive FileSyncProvider; OAuth approach + reuse map
metadata: 
  node_type: memory
  type: reference
  originSessionId: 50e2c2b8-ca61-4c33-acae-cd5d2c9aa93f
---

NEXT TASK (research done, not yet built): add **Google Drive as a `FileSyncProvider`** for the merged file-sync engine ([[webdav-filesync-refactor-plan]] / PR #4784). Researched reference: `github.com/ratatabananana-bit/Readest-google-drive-mod-patcher` (AGPL-3.0, same as Readest → can adapt WITH attribution). Reference patch saved at `~/.../scratchpad/gdrive-ref/` (extracted modules under `extracted/`).

**The repo is a PATCHER**, not a fork: the whole impl is one squashed diff `tooling/mod/mod.patch` (13k lines) against Readest v0.11.12. Design/plan docs live in a SIBLING repo `readest-gdrive-sync-mod` (referenced in MOD.md, likely private — not in the patcher).

**Their architecture = REPLACE Readest's native cloud sync with Drive** (library/progress/notes/stats). Two layers:
- `src/services/cloudprovider/` — REUSABLE: a backend-agnostic provider seam + OAuth. `CloudProvider.ts` (their interface), `GoogleDriveProvider.ts` (Drive v3 REST impl), `FakeCloudProvider.ts`, `buildDriveProvider.ts` (assembly), `googleAuth/*` (the OAuth layer).
- `src/services/drivesync/` — SKIP for us: their integration with the native-sync data model (driveMerge, statsMerge, DriveSyncClient, DriveBlobStore, jsonl, layout). We REPLACE this with our `FileSyncEngine`.

**KEY: their `CloudProvider` is ~1:1 with our `FileSyncProvider`.** Map: getText↔readText, getBinary↔readBinary, putText/putBinary↔writeText/writeBinary, list↔list, stat↔head, deleteFile↔deleteDir. Their `CloudEntry` even carries `md5` (Drive checksum) — stronger than our size-only HEAD short-circuit. Extra on theirs: `isAuthenticated()`/`accountLabel()` (auth state) + `putBinary` `onProgress`. Missing on theirs: `ensureDir` (Drive auto-creates folders on write).

**Recommended fit for US = Drive as a parallel `FileSyncProvider`** (like WebDAV), NOT replacing native sync. Reuses the whole engine (incremental/concurrency/merge). Build = (1) `createGoogleDriveProvider(settings): FileSyncProvider` adapting their `GoogleDriveProvider` (rename methods, map CloudEntry→FileEntry, head from stat, deleteDir from delete-folder-by-id, ensureDir = no-op since write auto-creates, rootPath='/'), (2) reuse `googleAuth/*` OAuth nearly as-is, (3) token persistence (the ONE big gap — see below), (4) settings UI + provider registry.

**Drive specifics (vs WebDAV path-addressing):**
- **Drive is ID-addressed, not path-addressed.** Resolve a logical path (`Readest/books/<hash>/config.json`) segment-by-segment via `files.list` (name+parent queries), cache folder/file ids in a `Map<path,id>`. `driveRest.ts` = pure query/URL builders; `GoogleDriveProvider` owns resolver+cache.
- **`drive.file` scope** = app sees only files it created → Drive root is a safe private namespace (no appdata hidden folder; a visible "Readest" folder). Non-sensitive scope = no Google verification needed (unverified-app warning shows once).
- **Upload = create-then-name:** `uploadType=media` carries no metadata, so POST bytes to root → PATCH name + reparent (addParents=folder, removeParents=root). Overwrite = media PATCH on the existing id (preserves id/links).
- Endpoints: metadata `drive/v3/files`, media `upload/drive/v3/files?uploadType=media`. Folder MIME `application/vnd.google-apps.folder`.

**OAuth (the hard part — every gotcha you flagged is CONFIRMED + implemented):**
- **One iOS-type Google client** (Bundle ID only, NO secret, NO SHA-1, App Check OFF) for BOTH Windows + Android. Redirect = reverse-DNS `com.googleusercontent.apps.<id>:/oauthredirect` (SINGLE slash) + PKCE. Client id derives the scheme (`reverseDnsRedirect.ts`). Client id is committed (not a secret). App Check must stay OFF (Android can't produce iOS attestation → would break everyone).
- Loopback dead for iOS clients (Google blocked 2022); embedded WebView blocked (`disallowed_useragent`). Reverse-DNS is the only no-SHA native redirect Google accepts.
- `oauthFlow.ts` — provider-agnostic orchestration, platform mechanics injected (DI, headless-testable). Arms `awaitRedirect` BEFORE `openUrl` (race fix). PKCE + `state` CSRF via `parseRedirect.ts`.
- **Android** (`oauthAndroid.ts`): Chrome Custom Tab via Readest's EXISTING native bridge `authWithCustomTab` (same as Supabase login) — NOT external browser (keeps Tauri Activity foregrounded so in-flight auth survives memory pressure; redirect resolves via a native Kotlin field that survives WebView reload). Register the client scheme as a BROWSABLE intent-filter (patcher injects into `tauri.conf deep-link.mobile`). MUST filter the OAuth redirect out of Readest's deep-link ingress (`useAppUrlIngress` via `matchesReverseDnsRedirect`) or it triggers a /library reload that kills the flow. `tauri android init` wipes the manifest → restore MANAGE_EXTERNAL_STORAGE etc.
- **Windows/desktop** (`oauthDesktopDeepLink.ts` + `spawn_fresh_browser.rs`): system browser + self-registered scheme (`deep_link().register_all()`, no installer/admin). Capture via `single-instance` (url=args[1]) + `onOpenUrl`. THE WINDOWS SUBTLETY: a browser process snapshots protocol associations at launch, so a browser already running before scheme-registration silently drops the redirect. Fix: open default browser first; if no redirect in `DEFAULT_FALLBACK_DELAY_MS=25_000`, re-open in a freshly-spawned COLD browser (`spawn_fresh_browser` Rust cmd: resolve default browser from registry UserChoice → if Chromium-family spawn with `--user-data-dir=<isolated>` → else fall back to Edge). Hard deadline `CONNECT_DEADLINE_MS=15min` rejects an abandoned sign-in. Whichever browser returns first wins.
- `tokenStore.ts` = PKCE token exchange + `refreshAccessToken` (Google omits refresh_token on refresh → keep the old one). `pkce.ts` = PKCE pair + `buildAuthUrl`.

**GAPS / NOT in the reference (we'd build):**
1. **Token persistence is a stubbed interface** (`TokenPersistence` load/save/clear) — they explicitly left the secret store (Tauri secure storage / Android Keystore) as a later task. WE implement it.
2. **No resumable/streaming upload** — simple `uploadType=media` buffers the whole file in JS heap (same OOM risk our WebDAV `uploadStream` avoids). For large book files we'd add Drive resumable upload (`uploadType=resumable`); configs/covers are fine buffered. Our engine's streaming is optional (falls back to buffered).
3. **accountLabel is a placeholder** ('Google Drive'); real email needs a userinfo call.
4. **iOS/macOS** not covered (Windows + Android only).

**License call:** AGPL→AGPL is compatible. **The author (ratatabananana-bit) granted EXPLICIT permission** (2026-06): "feel free to do whatever you want with the code (it's the AGPL fork - Drive sync + the recently-read shelf)." So we can copy-adapt freely; keep attribution/credit. The OAuth platform glue is the high-value, hard-to-reproduce part → adapt with credit. Note the author also mentions a "recently-read shelf" feature in the same fork (separate, potential bonus).
