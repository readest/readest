---
name: worktree-new-rebases-pr-force-push
description: "pnpm worktree:new <PR#> rebases the contributor's branch onto origin/main, so pushing back to their fork needs a force push; cherry-pick onto the real head instead"
metadata: 
  node_type: memory
  type: project
  originSessionId: da8305fd-859c-49bd-99af-f8afabbfaa12
  modified: 2026-08-16T08:44:54.578Z
---

`pnpm worktree:new <PR#>` checks out the PR **rebased onto the current
`origin/main`**, so the local branch immediately diverges from the fork's real
head. Pushing maintainer fixes back from that worktree is a **force push that
rewrites the contributor's commits**, which is almost never what "update the PR"
should mean.

Seen on #5736: worktree HEAD had 9 commits vs upstream's 2
(`git rev-list --left-right --count @{upstream}...HEAD` -> `2  9`), even though
only one commit was mine.

**How to apply** — before pushing to someone else's fork:

1. `git rev-parse @{upstream}` vs `gh pr view <N> --json headRefOid`. Equal means
   a plain push is fine; different means the branch was rebased.
2. Check whether the rebase is even load-bearing:
   `git diff --stat <old-base> <new-base> -- <files your commit touches>`.
   Empty means your fix is base-independent.
3. Confirm it applies without checking anything out:
   `git merge-tree --write-tree --merge-base=<your-commit^> <pr-head> <your-commit>`
   (exit 0 + a lone tree SHA = clean).
4. Prove equivalence:
   `git diff HEAD <that-tree> -- $(git show --name-only --format= HEAD)` — empty
   means byte-identical content on the old base.
5. Then `git checkout -b <tmp> <pr-head>`, `git cherry-pick <your-commit>`,
   re-run `pnpm lint` + `pnpm test` (the base differs from the one you developed
   on), and push **without** `--force`.

Rebasing the contributor's branch onto main is a separate, history-rewriting
decision — leave it to the user. Related: [[worktree-rebase-submodule-drift]],
[[worktree-rm-deinits-shared-git-config]], [[feedback_pr_rebase]].

**Two more traps (seen on #6325, 2026-09-28):**
- A leftover local `pr-<N>` branch from an earlier review makes `worktree:new <N>`
  die with `! [rejected] ... -> pr-<N> (non-fast-forward)` once the contributor
  force-pushes. Check it isn't checked out and holds only their commits
  (`git log --format='%h %an' pr-<N> --not FETCH_HEAD origin/main`), then
  `git branch -D pr-<N>` and rerun. Delete both `pr-<N>` branches after merging.
- The fork remote the script adds is an `https://` URL, which fails here
  (`send-pack: unexpected disconnect`). Push to the SSH URL instead:
  `git push --no-verify git@github.com:<owner>/readest.git <tmp>:<head-branch>`
  (see [[git-push-socks-proxy]]).

**Merge-conflict PRs (#6518, 2026-10-01):** to fix conflicts without a force push, branch from the fork head (`git fetch <fork> <branch>; git checkout -B pr-N-merge FETCH_HEAD`) and `git merge origin/main`, then push to the fork over SSH. Locale conflicts are usually both sides appending keys: do a per-key 3-way JSON merge from index stages `:1:`/`:2:`/`:3:`, then confirm `pnpm i18n:extract` gives no diff. An existing `../readest-pr-N` worktree makes `worktree:new N` die with "refusing to fetch into branch checked out"; reuse it, and if it never finished setup, init the submodules from `.git/modules` by hand (the plugin's Cargo workspace also needs turso, webview-upgrade and packages/tauri).

**Rebase conflict mid-setup (#6612, 2026-10-04):** if the PR conflicts with main, `worktree:new N` dies at `git rebase origin/main`, leaving the worktree mid-rebase with no submodules, deps or .env. Recover: `git rebase --abort; git checkout pr-N; git merge origin/main`, then run the rest of `scripts/worktree-new.ts` by hand (copy everything from "Repoint submodule URLs" on into a scratch .ts with `repoRoot`/`worktreePath`/`gitStdio` hardcoded, skip the Android gen re-init but keep `genDir`, and run it with `npx tsx`). Single-file tests need `pnpm test <path>`, because bare `npx vitest` skips the dotenv files and fails with `InvalidCharacterError`.
