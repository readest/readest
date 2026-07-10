---
name: s3-r2-sync-provider
description: "S3/R2 file-sync provider (third backend after WebDAV/GDrive) — full vertical slice on dev, uncommitted; aws4fetch SigV4, path-style, generic S3-compatible"
metadata: 
  node_type: memory
  type: project
  originSessionId: 894e0d6d-ce01-402b-8f2d-0f0670986a88
---

Built 2026-07-07 (approved design in `.agents/plans/2026-07-07-s3-provider-design.md`), full vertical slice on the bare-repo dev branch, UNCOMMITTED alongside the day's gdrive optimization work.

- **Transport** `src/services/sync/providers/s3/S3Provider.ts`: SigV4 via `aws4fetch` (was already a dep, server-side `utils/r2.ts` uses it; zero new deps). Path-style `<endpoint>/<bucket>/<key>`; keys map 1:1 from logical paths. GET/HEAD/PUT; ListObjectsV2 XML via DOMParser with delimiter + continuation-token draining; ensureDir no-op; deleteDir = list prefix + per-key DELETE (DeleteObjects needs Content-MD5, WebCrypto has none). head etag = md5 → engine's index change-detection works. Tauri streaming via presigned `signQuery` URLs → tauriUpload/Download. Injected fetch (web fetch / tauri plugin-http) + injected sleep; Drive-style error map + backoff. Passes `runSemanticContract` + 10 transport tests (stageAbsent dispatches by request shape: 404 for objects, empty-200 for listings).
- **Settings** `S3Settings` (endpoint/region='auto'/bucket/accessKeyId/secretAccessKey + shared sub-toggles) in types/settings.ts + DEFAULT_S3_SETTINGS in constants.ts; slice `settings.s3`.
- **Derivation/activation**: FileSyncBackendKind gains 's3'; getCloudSyncProvider order webdav > gdrive > s3; withActiveCloudProvider keeps 3 slices exclusive (+syncBooks/providerSelectedAt stamp); CloudSyncProviderFlags in settingsSync.ts gained optional s3 slice (multi-window switch protection, #4580 class).
- **Shared helpers** added to cloudSyncProvider.ts and swept everywhere: `settingsKeyForBackend(kind)` (5 sites) and `cloudProviderDisplayName(kind)` (4 sites) replaced scattered gdrive ternaries.
- **UI**: `S3Form.tsx` (WebDAVForm pattern; Connect probes `list('/Readest')` — 403=auth, 404=bucket, empty-200=ok); IntegrationsPanel: 's3' SubPage + chooser CloudProviderRow (RiDatabase2Line, "S3-Compatible Storage") + deep-link `requestedSubPage === 's3'`; Tips include R2 endpoint format + web CORS requirement.
- **i18n**: 14 new keys translated into all 33 locales (462 entries).
- Everything else (engine, FileSyncForm, fileSyncStore, fleet probe, per-book upload/download routing, reader hint) was already backend-generic and needed zero changes.

NOT done: R2 account-ID preset, multipart upload, virtual-host addressing, remote-browser pane for S3. Live verification against a real R2 bucket pending (user tests on localhost:3000).
