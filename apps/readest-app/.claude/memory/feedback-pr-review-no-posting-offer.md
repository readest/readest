---
name: feedback-pr-review-no-posting-offer
description: "Reviewing a contributor's PR: fix every issue found and push it to that PR (rework it whole if needed; if the branch can't be pushed, close it and open our own PR); never ask the contributor to change things"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 3920fdf8-272b-42e1-a916-f45890af0c19
  modified: 2026-11-17T04:13:26.806Z
---

When reviewing a contributor's PR, fix the issues found and update that PR: commit the fixes on its branch and push. If the approach itself is wrong, rework the whole PR and push the rework to the original PR. Only if the contributor's branch can't be pushed (maintainerCanModify false, push refused): close their PR with a short note and open a new PR from our own branch that carries the fix, crediting them. Never ask the contributor to make the changes, and don't end with findings plus an offer to post, approve or request changes.

**Why:** chrox, 2026-11-17 on #7512: "always try to fix any issues found in the pr and update the pr, if necessary we need to rework the whole pr and then update to the original pr". Again 2026-11-17 on #7568: "always fix the found issues and update the pr or if necessary rework the pr instead of asking the contributor to do anything, if the contributors branch cannot be pushed close the pr and open a new pr". Earlier (#6703, 2026-10-13): "don't ask, we will decide" about offering to post a review.

**How to apply:** after a /pr review, write the failing test, apply the fix in the worktree, run the checks, merge origin/main if it conflicts (never rebase or force-push), push to the PR branch (check `maintainerCanModify` first), then report what changed and what ran. Merging stays the maintainer's call. After a PR merges, remove its worktree (`pnpm worktree:rm pr-<N>` from the monorepo root; owner, 2026-11-18: "after merging a PR, also clear the worktree of that pr"). Related: [[feedback-pr-review-trust-policy]], [[feedback-pr-watch-fix-conflicts]].
