---
name: file-sync-converge-5900
description: "#5900 WebDAV/file sync never converged across devices; root causes and the fix, MERGED as PR #5905"
metadata: 
  node_type: memory
  type: project
  originSessionId: 1d46dba2-18c6-424a-b6f7-8e19dc3004f5
  modified: 2026-08-27T14:19:36.946Z
---

#5900 "WebDAV Full Sync does not converge library state across devices" (3 devices:
Windows PC 148 books, Android 147, BOOX Leaf 3 129). **MERGED 2026-08-27 as PR #5905
(merge fda5a364a).** Fixed ON TOP OF @jadhavgaurav's PR rather than as a competing
one: their commit d484e68dc kept as the base, follow-ups e2c14d95f + 78c97decc +
58821eac6 pushed to their fork branch (maintainerCanModify was true; the worktree
head already equalled the real PR head so it was a fast-forward, NOT a force push).
PR retitled "fix(sync): converge multi-device file sync (#5900)". Worktrees and
branches cleaned up. NOT verified on real multi-device hardware -- reporter verify
pending.

**Three independent defects, all in `src/services/sync/file/engine.ts`:**

1. **`send` rewrote library.json without reading it.** The index pull was gated on
   `canPull` (`strategy !== 'send'`) but the final re-push only needs `canPush`
   (true for both `silent` and `send`). So a Send Only run rebuilt the shared index
   from `allBooksMap` alone: `uploadedHashes` reset to whatever this run reconfirmed
   (the reporter's "143 then 144 with 4 different ones missing"), and peer-only books
   and tombstones vanished. Fix: pull unconditionally (pure read); keep every
   remote-APPLYING behavior gated on `canPull`.

2. **THE convergence bug (the BOOX-stuck-at-129 symptom).** Revival requires
   `remoteRow.updatedAt > localRow.deletedAt`, but republishing a live row over a
   tombstone carried the row's OLD `updatedAt`. A book last edited BEFORE the peer
   deleted it can never win, so: peer pushes tombstone -> PC (send) pushes live row
   with stale updatedAt -> peer ignores it, re-pushes tombstone -> forever, neither
   shelf changing. Under `silent` this cannot happen (deletion propagation either
   applies the tombstone or declines it because `local.updatedAt >= rb.deletedAt`,
   which already proves the published row wins). Fix = **revival stamp**, send-mode
   only: when publishing a live row over a remote tombstone, set
   `updatedAt = rb.deletedAt + 1`, persist via `store.updateBookMetadata`, and update
   `allBooksMap`. `deletedAt + 1`, NOT `Date.now()` — smallest winning value and it
   cannot lose to a peer whose clock runs ahead ([[sync-clock-skew-lastsynced-5661]]).

3. **Failures were invisible.** `result.failures` / `failedBooks` have NO consumer
   anywhere (the "diagnostic log in the Settings UI" the comment promises does not
   exist), and a failed `pushLibraryIndex` was swallowed with `console.warn` — so a
   run that converged nothing toasted "N book(s) synced". Added
   `SyncLibraryResult.indexPushFailed`; `useBooksSync` now treats it as a failed file
   pass. Also `runFileLibrarySyncPass` spread the LAST backend's result over the
   earlier ones, erasing their failure counts — now accumulates.

**Trap found while reviewing PR #5905** (@jadhavgaurav, fixes defect 1 only): seeding
`uploadedHashes` under `send` silently makes `needsFilePush` skip files the remote
index claims are uploaded. Send Only stops re-verifying book files on the default
incremental path (`runLibrarySync.ts` passes `fullSync: false`) — i.e. it starts
trusting the very record #5900 says is wrong. Guard is
`(!canPull || !uploadedHashes.has(hash))`, mirroring the `if (!canPull) return true`
that PR added to `isLocalNewer`. Verified by probe: main uploads the file, #5905 does
not.

**CodeRabbit r3872750732 (concurrent index writers), fixed in 78c97decc.** The
index re-push is a read-modify-write over the WHOLE run, so a peer writing
library.json mid-run gets erased. Their prescription (provider-level If-Match on
the observed ETag) is NOT implementable where it matters: `ICloudProvider` has no
ETag concept (ubiquity-container filesystem) and `WebDAVProvider` only forwards
what the server sends, which many omit — that's why `FileHead.etag` is optional.
Fix = re-read library.json right before the PUT and fold peer entries in by hash
(ours wins on conflict), narrowing the window from minutes to milliseconds; NOT
closed, and the comment says so. TWO TRAPS: (a) an unconditional re-read undoes
the etag change-probe short-circuit — `engine-sync-paths.test.ts` "a local change
under an unchanged remote index pushes without re-pulling" catches it; gate the
re-read on `head().etag === remoteEtag`; (b) folding peer `emptyDirs` back in
resurrects a record this run disproved by listing the dir — track
`confirmedNonEmptyDirs` and exclude. Note the index is largely self-healing
anyway (union-by-hash CRDT: every row is owned by a device that re-publishes it).

**PERFORMANCE RULE chrox stated (load-bearing, 2026-08-27): an incremental sync
must NEVER read the whole local or remote dir; and the hardening belongs on Full
Sync only — the default incremental path should be as fast as possible EVEN IF it
sometimes loses eventual consistency.** Measured, 148-book quiet Send Only run:
main = 296 HEADs / 149 writes / 84KB; after 58821eac6 = 1 HEAD / 0 writes / 0B.
Three O(library) offenders: (1) `needsFilePush` bypassing `uploadedHashes` under
send (I added that as a "regression guard" over PR #5905 — WRONG, reverted:
#5905's seeding is what makes send incremental, drift is Full Sync's job);
(2) `isLocalNewer` returning true unconditionally under send (#5905's blind-push
guard) -> re-pushed every config + re-probed every cover; now send uses the same
cursor as silent and BLIND LOCAL-AUTHORITATIVE OVERWRITE MOVED TO `fullSync`
(class doc + contributor's test updated); (3) the discovery `list()` of books/ is
gated on an etag, but iCloud has NO etag and many WebDAV servers omit it, so it
re-listed every run — fixed by caching a content `fingerprint` next to the etag in
`remoteIndexCache` and using it when there's no etag. The CodeRabbit pre-push
reconcile is now `if (fullSync)` only.

RULE OF THUMB for this engine: incremental = pure metadata diffing, O(changed),
best-effort; Full Sync = the audit/repair pass (re-verifies files, reconciles
concurrent writers). The existing code comments already said this; violating it
is the recurring mistake.

**Verification recipe that worked:** run a probe test against the PR branch and again
with `git checkout origin/main -- src/services/sync/file/engine.ts` to get a hard
before/after. vitest v4 swallows `console.log` in these runs — write probe output to a
file with `appendFileSync` instead. Mutation-test each guard by deleting the single
added line and confirming a test flips red.

**Contributing on top of someone's PR (worked cleanly here):** `gh pr view --json
maintainerCanModify,headRefOid`; confirm the local worktree head == headRefOid
(if `pnpm worktree:new <pr>` rebased it, DON'T push, see
[[worktree-new-rebases-pr-force-push]]); `git remote set-url --push <fork>
git@github.com:<owner>/readest.git` because the auto-added fork remote is HTTPS
and won't auth; push `git push --no-verify <fork> <local>:<their-branch>` in the
background with `GIT_SSH_COMMAND='ssh -o ServerAliveInterval=30'`
([[git-push-socks-proxy]]). Keep their commit and their test file untouched;
drop YOUR duplicate tests, not theirs.

Related: [[books-sync-inflight-change-dropped]], [[sync-fixes]].
