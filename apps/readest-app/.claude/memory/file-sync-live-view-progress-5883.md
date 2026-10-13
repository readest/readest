---
name: file-sync-live-view-progress-5883
description: "#5883 third-party file sync merged a peer's position into the config and toasted 'Reading Progress Synced' but never moved the open reader; fix navigates the live view + drops the push debounce 15s -> 5s"
metadata:
  type: project
---

**#5883 (Zack9476, Android 16, v0.12.1) — third-party progress sync did not
navigate the active reader.** MERGED 2026-08-26 as PR #5886 (squash
`39580e754`); issue CLOSED, local branch
`fix/file-sync-apply-remote-progress-5883` deleted, remote auto-deleted (no
worktree was used, per user). Reporter verify pending; no two-device
WebDAV/S3 handoff was ever run.

**ROOT:** `useFileSync.pullNow()` (`src/app/reader/hooks/useFileSync.ts`)
merged the remote config, wrote it with `setConfig` + `saveConfig`, dispatched
the top-right `Reading Progress Synced` hint -> and stopped. It never touched
the view. Readest Cloud (`useProgressSync.applyRemoteProgress`) and KOSync
(`useKOSync.applyRemoteProgress`) BOTH call `view.goTo(...)` at that exact
point; file sync was the only backend that did not. Symptom: hint fires, page
does not move, reopening the book jumps (the merged location is already on
disk).

**FIX (2 parts, one file):**
1. `pullNow` calls `await view.goTo(working.location)` under the SAME
   `remoteProgressApplied(config.location, working.location)` condition that
   already drove the hint, so hint and jump cannot disagree; hint dispatched
   AFTER the await so it never lies. Skipped when
   `getViewState(bookKey)?.previewMode` (deep-link carve-out both other
   backends make) — merged config is still stored, next open resolves it.
2. `PUSH_DEBOUNCE_MS` 15_000 -> 5_000. It is TRAILING-ONLY, so every page turn
   restarts it and a steady reader can go minutes without publishing. 5s ==
   KOSync's push debounce; Readest Cloud is `SYNC_PROGRESS_INTERVAL_SEC` = 3s.

**Deliberate: the jump is UNCONDITIONAL, not forward-only.** The cloud path
gates on `CFI.compare(local, remote) < 0`, but the file-sync merge
(`services/sync/file/merge.ts` `mergeBookConfig`) is strict LWW on
`config.updatedAt` and already overwrites the stored location in EITHER
direction. Forward-only would leave the live view disagreeing with the config
on disk whenever a peer legitimately moved backward, and
`useProgressAutoSave.persistProgress` would then persist the unseen backward
position. Local `updatedAt` tracks reading within ~1.5s (`saveConfig` bumps
it), so a remote that wins LWW really is newer.

**`view.goTo` swallows its own resolution failures** (`packages/foliate-js/
view.js:517` try/catch) — no caller-side try/catch needed, matching the cloud
and KOSync call sites.

**Known residual (pre-existing, not introduced):** two devices with the same
book open paginate differently, so each relocate produces a different CFI;
`remoteProgressApplied` is true both ways and the devices can nudge each other
once per `PULL_COOLDOWN_MS` (60s). Before the fix this already caused spurious
hints and push churn — now it also nudges the view, within the same paragraph.

**Verification:** wrote a throwaway hook-level repro under
`src/__tests__/hooks/` (mocked `FileSyncEngine.pullBookConfig` returning a
newer `mergedConfig.location`, `readerStore.getView` returning a `goTo` spy),
confirmed it FAILS pre-fix (goTo never called) and passes after, incl.
preview-mode and no-op-merge cases, then DELETED it — user said "no test
cases". Full `pnpm test` (10135 pass), `pnpm lint`, `pnpm format:check` green
on the origin/main-based branch.

**NOT done** (issue's follow-up comment asks for these; feature work, not this
bug): progress synced separately from bulk book/annotation data; a visible
syncing / last-synced / failed indicator. "Wait for the pending upload on
close/background" is ALREADY handled — `useWindowActiveChanged` flushes the
debounce on blur and the hook flushes on unmount.

Related: [[sync-fixes]], [[progress-loss-android-tauri-plugin-deadlock-5859]],
[[multi-provider-cloud-sync-5062]], [[git-push-socks-proxy]].
