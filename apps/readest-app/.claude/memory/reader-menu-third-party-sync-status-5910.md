---
name: reader-menu-third-party-sync-status-5910
description: "#5910 reader menu said Never synced for third-party sync and its tap was inert; fixed with a shared useCloudSyncStatus hook"
metadata: 
  node_type: memory
  type: project
  originSessionId: 736daaa1-8a21-4626-a304-ecc99676bdc9
  modified: 2026-08-28T11:02:56.485Z
---

**#5910** "Display third-party sync status instead of 'Never synced' in the reader
menu". FIXED 2026-08-28. **MERGED as PR #5922 (squash 8aaf2759f)**; issue CLOSED, branch
deleted. Was independent of #5921 (no shared files). NOT device-verified.
Separate defect from [[group-metadata-row-lww-clobber-5911-5912]]; PR #5905 did
not touch it either.

## Two defects, not one

1. **Wrong source.** `ViewMenu.tsx` built the row from `config.lastSyncedAtConfig`
   / `lastSyncedAtNotes` / `lastPushedAtConfig` / `lastPushedAtNotes` — all four
   written only by `useProgressSync` / `useNotesSync`, i.e. Readest Cloud. File
   sync records `settings[backend].lastSyncedAt` instead, which that row never
   read. Hence "Never synced" for a working WebDAV/iCloud setup, and "Sign in to
   Sync" for someone with no Readest account at all.
2. **The tap was INERT** (not in the report). `handleSync` dispatched
   `sync-book-progress`, whose only listeners are `useProgressSync` and
   `useHardcoverSync`. `useFileSync` and `useKOSync` do not subscribe, so for a
   third-party-only user the menu item did literally nothing.

## Fix

New shared `src/hooks/useCloudSyncStatus.ts` — the single answer to "is my sync
healthy?", consumed by BOTH the reader `ViewMenu` and the library `SettingsMenu`
(the library menu already had this logic inline and correct; the reader never got
it, which is exactly why they drifted). Returns per-provider
`{kind,name,lastSyncedAt,syncing,failed}` plus aggregates and a ready `label`.

`handleSync` now dispatches `sync-book-progress` + `push-file-sync` +
`pull-file-sync` + `flush-kosync` — `useFileSync` ALREADY listened for the two
file-sync events, so no hook change was needed. Login bounce is now gated on
`needsSignIn`, not `!user`.

`SyncInfoDialog` (the ⓘ next to the row) renders one row PER provider when
several are enabled — that is the issue's "Readest Cloud — Synced 5 min ago /
Third-party — Synced 2 min ago" ask. Its prop was renamed `lastSyncedAt` ->
`nativeLastSyncedAt`, and `HeaderBar` now includes the `lastPushedAt*` stamps so
the dialog and the menu row cannot disagree.

## Traps hit

- **`needsSignIn` must NOT be `!user && !backends.length`.** With Google Drive
  selected but its web token expired, `isReadestCloudEnabled` is false (a
  third-party IS enabled) so providers is empty — "Sign in to Sync" would be a
  lie, signing in cannot help. Correct form also requires
  `providers.some(p => p.kind === 'readest')`.
- **`dayjs().fromNow()` depended on a global side effect.** `dayjs.extend(relativeTime)`
  only ran inside `initDayjs()` (app startup), so the label crashed the moment a
  unit test mounted the hook directly. Moved `dayjs.extend(relativeTime)` to
  module scope in `utils/time.ts` and added `formatSyncTimeFromNow`.
- Deliberately excluded KOSync from the TIMESTAMP: `KOSyncSettings` has no
  `lastSyncedAt` field. The manual action still pokes it.
- SCOPE NOTE flagged to chrox: the library SettingsMenu row now also says "Sign
  in to Sync" (was "Never synced") for a signed-out user with no backends, and
  its icon follows failed/needsSignIn rather than `!user`.

3 new i18n keys, translated into all 34 locales by adapting the existing
"Library sync via …" strings (same phrase, already translated everywhere):
`Synced via {{provider}}`, `Synced via {{count}} providers` (+ plural forms),
`Last Synced — {{provider}}` (colon separator for ja/ko/zh/ka/th).

Gates: 10362 tests pass; the only failures are PRE-EXISTING and not mine —
`src/__tests__/scratch/*` (untracked WIP someone else left) and
`Notebook.test.tsx`, all three verified failing with my changes stashed.

Related: [[group-metadata-row-lww-clobber-5911-5912]], [[multi-provider-cloud-sync-5062]].
