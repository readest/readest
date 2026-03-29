# Hardcover Sync Changes (Review Summary)

Branch: `feat/new-feature`
Base: `84349ab1` (`main` at start of work)

## Commits Included

1. `5f324420` feat(hardcover): add one-way Hardcover sync integration
2. `dfeeb96b` fix(hardcover): proxy API calls server-side to fix CORS, normalize Bearer token
3. `b044f8bb` fix(hardcover): surface note-sync no-ops and harden book resolution
4. `d1482cc6` debug(hardcover): add runtime instrumentation for note sync
5. `f3646d04` feat(metadata): keep identifier stable and store ISBN separately
6. `df345b9f` fix(hardcover): avoid wasm sqlite for note mappings on web
7. `28874b10` fix(hardcover): dedupe notes by payload hash across unstable note IDs
8. `6064c401` fix(hardcover): avoid duplicate quote export when annotation note exists

## What Was Added

- New Hardcover service module:
  - `apps/readest-app/src/services/hardcover/HardcoverClient.ts`
  - `apps/readest-app/src/services/hardcover/HardcoverSyncMapStore.ts`
  - `apps/readest-app/src/services/hardcover/hardcover-graphql.ts`
  - `apps/readest-app/src/services/hardcover/index.ts`
- New settings UI:
  - `apps/readest-app/src/app/reader/components/HardcoverSettings.tsx`
- New reader hook wiring:
  - `apps/readest-app/src/app/reader/hooks/useHardcoverSync.ts`
- New API proxy route (web CORS workaround):
  - `apps/readest-app/src/app/api/hardcover/graphql/route.ts`

## App Integration Points

- Reader mount point:
  - `apps/readest-app/src/app/reader/components/Reader.tsx`
- Sidebar menu actions and toggle:
  - `apps/readest-app/src/app/reader/components/sidebar/BookMenu.tsx`
- Hook activation in reader annotator:
  - `apps/readest-app/src/app/reader/components/annotator/Annotator.tsx`

## Data Model / Settings Changes

- System settings updated with Hardcover config:
  - `apps/readest-app/src/types/settings.ts`
  - `apps/readest-app/src/services/constants.ts`
- Per-book flag added:
  - `apps/readest-app/src/types/book.ts` (`hardcoverSyncEnabled`)
- Dedicated metadata ISBN field added (identifier kept separate):
  - `apps/readest-app/src/libs/document.ts` (`metadata.isbn`)
  - `apps/readest-app/src/services/metadata/types.ts`
  - `apps/readest-app/src/components/metadata/BookDetailEdit.tsx`
  - `apps/readest-app/src/components/metadata/useMetadataEdit.ts`
  - `apps/readest-app/src/components/metadata/SourceSelector.tsx`

## Database / Mapping Changes

- Added migration schema entry for Hardcover sync map table:
  - `apps/readest-app/src/services/database/migrations/index.ts`
- Mapping backend behavior:
  - Desktop/native: SQLite mapping table
  - Web: localStorage fallback for mapping (to avoid wasm sqlite blocking note sync)

## Behavioral Fixes Implemented

- Web note sync CORS failure fixed via server-side proxy route.
- Access token normalization: supports raw JWT and `Bearer <token>` input.
- Better user feedback toasts for note/progress sync no-op and setup states.
- Title search parsing hardened for current Hardcover search result shape.
- Metadata separation: ISBN no longer relies on `identifier` field semantics.
- Duplicate note prevention improvements:
  - Payload-hash mapping reuse across unstable local note IDs.
  - Suppress exporting standalone excerpt quote when matching annotation-with-note exists.

## Performance & Privacy Refactoring (Latest Changes)

- **Removed Debug Instrumentation**: Extraneous toast messages and noisy console logs tracking the sync-state have been flushed out.
- **Privacy Hardened**: The GraphQL proxy in Next.js no longer leaks the raw text of user journal entries into server console logs.
- **SQLite Performance Optimized**: The `HardcoverSyncMapStore` now caches data in-memory and flushes changes in a single database transaction, resolving UI-freezing disk thrashing.
- **Rate Limiting Implemented**: The `HardcoverClient` now implements global pacing to stay under the 55 requests/minute API threshold, automatically catching `429 Too Many Requests` status codes and recovering with an exponential backoff sleep mechanism.

## Changed Files (full list)

- `apps/readest-app/src/app/api/hardcover/graphql/route.ts`
- `apps/readest-app/src/app/reader/components/HardcoverSettings.tsx`
- `apps/readest-app/src/app/reader/components/Reader.tsx`
- `apps/readest-app/src/app/reader/components/annotator/Annotator.tsx`
- `apps/readest-app/src/app/reader/components/sidebar/BookMenu.tsx`
- `apps/readest-app/src/app/reader/hooks/useHardcoverSync.ts`
- `apps/readest-app/src/components/metadata/BookDetailEdit.tsx`
- `apps/readest-app/src/components/metadata/SourceSelector.tsx`
- `apps/readest-app/src/components/metadata/useMetadataEdit.ts`
- `apps/readest-app/src/libs/document.ts`
- `apps/readest-app/src/services/constants.ts`
- `apps/readest-app/src/services/database/migrations/index.ts`
- `apps/readest-app/src/services/hardcover/HardcoverClient.ts`
- `apps/readest-app/src/services/hardcover/HardcoverSyncMapStore.ts`
- `apps/readest-app/src/services/hardcover/hardcover-graphql.ts`
- `apps/readest-app/src/services/hardcover/index.ts`
- `apps/readest-app/src/services/metadata/types.ts`
- `apps/readest-app/src/types/book.ts`
- `apps/readest-app/src/types/settings.ts`
