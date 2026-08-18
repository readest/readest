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
