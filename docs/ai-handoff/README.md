# Gratis Readest AI Handoff

This directory contains the minimum context needed for the next coding agent
to continue work on the Gratis Readest fork.

## Repository

- Repository: `/home/moran/code/gratis-readest`
- Active branch: `feature/gratis-foundation`
- Upstream branch currently points to `origin/main`.
- Do not discard existing uncommitted changes. They are the current Gratis
  foundation work.

## Product Direction

Gratis Readest is intended to be a local-first fork of Readest:

- Brand: `Gratis Readest`
- Binary: `gratis-readest`
- Project URL: `https://github.com/Moranjianghe/gratis-readest`
- Original Supabase login/authentication remains available for users who need
  Readest account features.
- PostHog telemetry is disabled for this distribution.
- The Readest Cloud provider row is hidden from Integrations. The login page
  intentionally retains an explicit opt-in that can enable Readest Cloud sync;
  this is expected behavior, not a bug. The upstream sync-core semantics remain
  intact for easier future upstream merges.
- WebDAV, S3, Google Drive, and OneDrive remain available with their own
  provider credentials and do not require a Readest Premium plan.

## Important Configuration

Central product switches live in:

`apps/readest-app/src/config/appConfig.ts`

Current policy values:

```ts
APP_NAME = 'Gratis Readest'
APP_BINARY_NAME = 'gratis-readest'
APP_TELEMETRY_ENABLED = false
APP_READEST_CLOUD_ENABLED = false
APP_DATA_SUBDIR = 'GratisReadest'
APP_UPDATE_BASE_URL = 'https://github.com/Moranjianghe/gratis-readest/releases/latest/download'
APP_NIGHTLY_UPDATES_ENABLED = false
```

`APP_READEST_CLOUD_ENABLED` controls whether the Readest Cloud provider row is
shown in Integrations. It does not globally disable the provider: the login page
intentionally keeps its explicit opt-in, and selecting it may enable Readest
Cloud sync. This is expected product behavior, not a bug. Do not use this UI
switch to alter `isReadestCloudEnabled()` or the sync-core provider contract;
doing that previously caused dozens of upstream sync tests to fail. WebDAV and
other third-party providers are controlled separately by
`APP_CLOUD_SYNC_REQUIRES_PREMIUM`, which is currently `false`.

## Updates and Signing

Stable updates use the Gratis GitHub release manifest configured by
`APP_UPDATE_BASE_URL`. Store the updater private key only in the GitHub Actions
secret `TAURI_SIGNING_PRIVATE_KEY`; the public key is safe to commit in the
Tauri configuration and client constants. Never commit the private key or put
it in an `.env` file.

For a local Linux build, Tauri accepts a key file path through the regular
private-key variable:

```bash
export TAURI_SIGNING_PRIVATE_KEY=/absolute/path/to/gratis-readest-tauri.key
unset TAURI_SIGNING_PRIVATE_KEY_PASSWORD # the generated key has no password
pnpm --filter @readest/readest-app build-linux-x64
```

Nightly updates stay disabled in the client for now. The upstream nightly
workflow is otherwise kept unchanged to reduce merge conflicts; enable it only
after its publishing destination has been deliberately configured for this
fork.

## Telemetry

Telemetry means optional diagnostic data about app usage, errors, and feature
events sent to a service such as PostHog. It is not the same as WebDAV sync or
authentication. Gratis Readest does not initialize PostHog, does not show the
consent prompt, and guards the remaining event/error calls with
`APP_TELEMETRY_ENABLED = false`.

## Storage Policy

Local storage is intentionally separated from upstream:

- Local data namespace: `GratisReadest/`
- Local books: `GratisReadest/Books/`
- Node fallback application root: `Gratis Readest`
- Tauri FS scopes and web/node path resolvers have been updated accordingly.

The remote file-sync wire layout remains `/Readest/...` deliberately. This
preserves compatibility with existing WebDAV/Google Drive/S3/OneDrive data.
The split is implemented in `services/constants.ts`: local constants use
`DATA_SUBDIR`, while `CLOUD_BOOKS_SUBDIR` and `CLOUD_REPLICAS_SUBDIR` keep the
upstream `Readest` namespace.

The Tauri identifier is still `com.bilingify.readest`. This was left unchanged
because changing it requires coordinated migration of platform app-data paths,
settings, keychain entries, deep links, Android/iOS generated projects, and
extensions. The local library namespace is isolated now; full platform-level
identity isolation should be a separate planned migration.

Old data under the previous local `Readest/` namespace is not automatically
migrated. This is intentional for now: it avoids touching an upstream Readest
installation. A future migration/import command should be explicit and
user-controlled.

## Current Validation

Use Node `22.23.1` before running project commands:

```bash
source /home/moran/.nvm/nvm.sh
nvm use 22.23.1
```

The project uses pnpm through the existing `packageManager` field in the root
`package.json`; do not add pnpm as an application dependency or introduce a
second lockfile.

Commands used successfully:

```bash
pnpm --filter @readest/readest-app lint
pnpm --filter @readest/readest-app build-web
pnpm --filter @readest/readest-app test --run
```

Latest full test result:

```text
587 passed / 4 failed / 3 skipped
```

The four failures are pre-existing document-loader baseline failures:

- 3 TXT-to-EPUB tests in `src/__tests__/libs/document.test.ts`
- 1 nested CBZ ComicInfo metadata test in
  `src/__tests__/document/series-metadata.test.ts`

They are unrelated to the Gratis branding, auth, telemetry, or storage
namespace changes. Do not hide or weaken these tests; fix them separately.

Focused path/storage tests and related tests pass. Lint covers 1782 files, and
the web production build completes successfully. The build still prints
existing Next/Serwist warnings about Turbopack, Cache-Control headers, and the
deprecated middleware convention.

## Development Server

The web development server was started from the fork with:

```bash
pnpm --filter @readest/readest-app dev-web
```

Expected URL:

`http://localhost:3000`

If it is not running, start it again using Node 22.

## Next Recommended Work

1. Commit the current foundation as a small, reviewable commit before adding
   more distribution-specific changes.
2. Decide whether Gratis should support WebDAV/S3/Drive in the first release.
   If yes, add explicit Gratis UI copy and verify that its remote namespace
   should remain compatible with upstream or be separately namespaced.
3. Implement an explicit user-controlled import/migration tool from the old
   local `Readest/` directory if preserving pre-fork Gratis data is required.
4. Plan a separate platform identity migration before changing
   `com.bilingify.readest`; update Android/iOS generated projects, keychain,
   app groups, deep links, updater, and existing-user migration together.
5. Investigate the four document-loader baseline failures independently.
6. Before merging upstream, preserve the central policy boundary in
   `appConfig.ts` and avoid invasive edits to upstream sync internals.

## Safety Notes

- Never run `git reset --hard` or discard the worktree without explicit
  approval.
- Inspect `git status` before editing because the foundation is intentionally
  uncommitted.
- Do not commit `.env*`, credentials, tokens, or generated local lockfiles.
- Prefer `pnpm` and keep Node 22.13+ available; the current working version is
  Node 22.23.1.
