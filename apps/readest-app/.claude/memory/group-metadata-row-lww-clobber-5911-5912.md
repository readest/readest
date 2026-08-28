---
name: group-metadata-row-lww-clobber-5911-5912
description: "#5911 book groups and #5912 book descriptions erased by whole-row LWW; root cause chain + the groupUpdatedAt field-clock fix"
metadata: 
  node_type: memory
  type: project
  originSessionId: 736daaa1-8a21-4626-a304-ecc99676bdc9
  modified: 2026-08-28T10:03:23.438Z
---

**#5911** (clean install + WebDAV full sync wipes book groups) and **#5912**
(third-party sync loses book descriptions) are ONE defect. **#5910** (reader menu
says "Never synced" for third-party sync) is separate. **PR #5905 fixed NONE of
the three** — it touched only `engine.ts`, `runLibrarySync.ts` and 3 lines of
`useBooksSync.ts`; `merge.ts`, `wire.ts`, `transform.ts`, `api/sync.ts` and the
reader menu are untouched. All three reporters run 0.12.1, which predates it.
Investigated AND FIXED 2026-08-28. **MERGED as PR #5921 (squash 80f196a9b)**;
issues #5911 + #5912 CLOSED, branch deleted. Analysis posted to all three issues.
**NOT device-verified, and the DB migration 022 + the server books merge in
`pages/api/sync.ts` are DEAD until a web deploy** -- until then only the
file-sync (WebDAV/iCloud/Drive/S3) half is live.

## Root cause

`groupId`/`groupName` and `metadata` (which carries `description`) resolve on the
WHOLE-ROW `updatedAt` clock with **raw, clearing assignment**. `updatedAt` is
bumped by operations that have nothing to do with either — most importantly
`cloudService.uploadBook` (`src/services/cloudService.ts:225` sets
`book.updatedAt = Date.now()` on every UPLOAD), driven through
`transferManager.executeBookTransfer` as a queue, which produces **sequential
timestamps seconds apart** — exactly the reporter's "19 records with sequential
updatedAt within ~8 seconds" fingerprint. Every other field with this hazard was
given its own clock: `readingStatusUpdatedAt` (#4634 / mig 015), `coverUpdatedAt`
(#4544 / mig 017), `metadataUpdatedAt` (#5438 / mig 018). **Groups never got
one**, and metadata's clock is bypassed on the unstamped-legacy tie
(`pickFresherMetadata` returns null when `0 === 0`, so the row spread stands).

## Probe results (all run against the real engine, probes then deleted)

| Probe | Result |
|---|---|
| A | file sync: local ungrouped row, newer `updatedAt` -> **group erased in pushed library.json** |
| B | same but timestamps **TIE** -> **group erased** (pull side `shouldApplyRemoteBookMetadata` is strict `>`, push side blindly writes local over remote) |
| C | book found only as a remote hash dir -> shelved `author:'Unknown'`, **no metadata, no groups**, `updatedAt: Date.now()` so it outranks every real row (`engine.ts:~965`) |
| D | `mergeBookMetadata` with metadata-less remote -> metadata preserved (`?? local`) OK |
| E | `{...localRow, ...cloudRow}` in `useBooksSync.updateLibrary` on a TIE -> **`groupId: undefined`, `metadata: null`** |
| F | pushed index DOES carry metadata + groups OK |
| G | metadata-less local row -> **erases `metadata.description` in library.json** (#5912 propagation) |
| I | full #5911 chain end to end: BOOX publishes ungrouped row -> PC's own GROUPED row is overwritten on pull |

`transformBookFromDB` always materialises the `groupId`/`groupName`/`metadata`
keys (value `undefined`/`null` when the column is empty), so the spread in
`updateLibrary` always overwrites — and the comparison is `>=`, so a mere TIE
clobbers.

## Why the reporter's clean install triggered it

`isReadestCloudEnabled = settings.readestCloud.enabled ?? !hasAnyThirdPartyEnabled(settings)`
(`cloudSyncProvider.ts:70`). A WebDAV-only user resolves to **false**, so their
group edits NEVER reach Readest Cloud — the cloud rows stay frozen at whenever
cloud was last on. A clean install has no backend configured yet, so it resolves
to **true**: signing in immediately restores those stale ungrouped rows. Then the
WebDAV Full Sync's index re-push writes them over the good rows. That validates
the reporter's own suggestions 2 and 3.

## The fix as shipped

Full field-clock mirroring 015/017/018: migration `022_add_group_updated_at.sql`
(+ base `schema.sql`), `groupUpdatedAt` on `Book` / `group_updated_at` on
`DBBook`, `transform.ts` both ways, `resolveGroupMerge()` + `bookGroupChanged()`
+ propagation row in `src/pages/api/sync.ts`, shared `pickFresherGroup()` /
`bookGroupDiffers()` in `src/utils/book.ts` used by BOTH client merges,
stamping at every group mutation site (`GroupingModal` x4, `ingestService`,
`useClipUrlIngress`).

**THE LOAD-BEARING DESIGN CHOICE — an unstamped TIE does NOT fall back to the
row winner** (unlike metadata/status/cover). On a tie the side that HAS a group
wins. Without this the fix would only prevent NEW damage: every existing row is
unstamped, so a legacy fleet would stay broken. This DID change the #4942
contract — `merge.test.ts` "propagates group removal" had to be restamped, and
an unstamped removal from an old client no longer propagates (fail-safe on
purpose).

Also: an absent `metadata` blob never wins on ANY clock (#5912) — in
`mergeBookMetadata`, `resolveMetadataMerge` and `useBooksSync.updateLibrary`.
Nothing in the app empties `book.metadata`, so absent always means "never had
one".

**PERF TRAP, got it WRONG the first time (commit af4c3355f) and chrox caught it
-- fixed in 22a8841f3.** The clock-free repair clauses made
`shouldApplyRemoteBookMetadata` fire for a WHOLE LIBRARY at once on the first
run after the fix. I gated the cover/config GETs on a new
`isRemoteBookClockNewer` and thought that was enough. It was not: the expensive
part is the WRITES -- `store.updateBookMetadata` -> `useLibraryStore.updateBook`
-> `saveLibraryBooks` rewrites the ENTIRE library file PLUS its `.bak` per book.
181 books = 181 full-library writes on a background sync, quadratic in bytes.

**RULE (chrox, restated): incremental sync is ALWAYS O(changed), by default.
Repair belongs to Full Sync.** Same rule as [[file-sync-converge-5900]]. When
checking O(changed), count LOCAL LIBRARY WRITES, not just remote requests --
`saveLibraryBooks` is whole-file, so any per-book call is O(library) each.

Fix = split the two concerns:
- `isRemoteBookMissingLocally` (repair this device's shelf) -> `fullSync` ONLY.
- `resolvePublishedBook` (stop the DAMAGE) -> unconditional and FREE. The
  propagation is entirely PUSH-side: the index re-push rebuilds library.json
  from the local rows, so a tied row republished its empty copy over the peer's.
  Resolving each row against the remote index entry happens in-memory over a map
  the push already walks -- no request, no write. It claims only "publishing
  must never DELETE what the remote already had"; the local row still wins the
  row on its own clock.

So incremental never repairs and never writes, yet can no longer empty a peer's
shelf; Full Sync puts a device's own groups/descriptions back.

Gates: `pnpm test` 10349 passed / 16 skipped, `pnpm lint` clean,
`pnpm format:check` clean. All three new guards mutation-checked (7 / 3 / 6
tests flip red when each is deleted).

**#5910 is NOT fixed** — reader menu sync row reads only the four Readest-Cloud
`BookConfig` stamps, and its tap dispatches `sync-book-progress` which
`useFileSync`/KOSync do not listen for, so the manual action is inert for a
third-party-only user.

**`resolvePublishedBook` must resolve the METADATA GROUP on `metadataUpdatedAt`,
not prefer any non-empty local blob** (CodeRabbit r3880791184, fixed 8211233aa).
Unreachable under `'silent'` -- a newer `remote.metadataUpdatedAt` alone makes
`isRemoteBookClockNewer` true, so the reconcile applies it to the local row
BEFORE the push. Reachable under **`'send'`**: that strategy applies nothing
from the remote, so the entire reconcile block is skipped and the publish
resolver is the only guard. Probe: send published "Stale blurb" over "Newer
blurb", silent did not. Resolve as a GROUP (title/author/tags/blob/stamp move
together, like `mergeBookMetadata`) or the published row pairs one device's
title with another's description.

RULE: whenever you add a guard on the PUSH/publish path, check it under `'send'`
separately -- `canPull` false skips every reconcile block, so the publish path
is load-bearing alone there.

**GOTCHA (shared repo, parallel sessions):** chrox's session committed+pushed to
whatever branch the shared worktree was on, so PR #5921 silently picked up their
AZW3 commit (377a26164) + a foliate re-pin as its BASE, putting
`repro-5918.azw3`, `utils/file.ts` and the submodule in my PR diff. Fix =
`git checkout -B <branch> origin/main` + `git cherry-pick <mine...>` +
`--force-with-lease`. ALWAYS `git diff --name-only origin/main..HEAD` before
declaring a PR clean. Their commits were safe on their own branch (74aea1bf4).

Related: [[file-sync-converge-5900]], [[sync-fixes]], [[sync-clock-skew-lastsynced-5661]].
