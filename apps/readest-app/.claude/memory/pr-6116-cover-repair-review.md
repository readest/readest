---
name: pr-6116-cover-repair-review
description: "#5931 S3 Full Sync never restores covers for rows Readest Cloud restored; PR #6116 (jadhavgaurav) MERGED 2026-09-07 as 0041b7b3e (my 636819a47 on top of the contributor); repair is a pull-side fullSync pass so Receive Only heals too; not device-verified"
metadata:
  type: project
---

Issue #5931: Readest Cloud restores metadata-only rows (no file, no cover); the S3/WebDAV
Full Sync then never pulls the covers because discovery skips any hash already in
`allBooksMap`, metadata reconciliation only pulls a cover when the remote clock is
STRICTLY newer, and `pushBookCover` resolves `no-source` and nothing pulls.

PR #6116 (@jadhavgaurav, head 7e4d1e126, base main) reviewed 2026-09-07, verdict =
needs one change before merge. Fix = `pushBookCover` reports `remoteExists` from
the HEAD it already pays; the push loop pulls the cover on `no-source && remoteExists
&& canPull`, saves it, stamps `coverDownloadedAt`, persists via
`store.updateBookMetadata` (which regenerates `coverImageUrl`, does NOT bump
`updatedAt`, so no Readest Cloud upsert storm). Tests (4) pass; lint clean; full
suite 10984 passed, 3 timeout flakes pass in isolation.

**Defect (CodeRabbit r-comment, VERIFIED by probe):** the repair lives inside
`if (canPush && booksToPush.length > 0)`, so `strategy: 'receive'` ("Receive only",
a real FileSyncForm option) + Full Sync repairs nothing (`coversDownloaded` = 0).
Probe test kept at the session scratchpad `engine-cover-repair-receive.probe.test.ts`.

**Fix pushed 2026-09-07 as 636819a47 on top of the contributor's 7e4d1e126** (fast-forward to
`jadhavgaurav:fix/file-sync-repair-missing-covers-5931`, maintainerCanModify true; PR body
rewritten + comment posted; MERGED 2026-09-07 as 0041b7b3e). Design = a pull-side pass right after
deletion propagation, `if (fullSync && canPull && remoteIndex?.books)`: for each live indexed
row, `loadBookCover(local)`; if missing, `pullBookCover` (GET, 404 = null), `saveBookCover`,
stamp `coverDownloadedAt`, `updateBookMetadata`, `allBooksMap.set`, `coversDownloaded++`.
The `remoteExists` plumbing was dropped. Test file now 6 cases incl. Receive Only and an
incremental guard (mutation-checked: removing the `fullSync` gate flips exactly that test).
TRAP: `engine-group-metadata-5911.test.ts` "a Full Sync repair pulls no cover it does not
need" used a fake store with NO local cover, so the repair legitimately GETs; fixed by giving
that fake a local cover (its intent is "field repair never pulls a cover already here").
Full suite 10976 passed. Not device-verified.

Worktree removed after merge. It had to be reset to the REAL PR head before committing
(worktree:new had rebased it onto main) ([[worktree-new-rebases-pr-force-push]]).
Fixing on top of a contributor PR recipe: [[file-sync-converge-5900]].
