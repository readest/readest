---
name: worktree-new-pr-rebases-onto-main
description: "`pnpm worktree:new <PR#>` rebases the PR onto origin/main, so committing there and pushing back would need a force-push to the contributor's fork"
metadata:
  node_type: memory
  type: project
  originSessionId: 1397d54d-f940-4bd6-aad5-111f9219655d
  modified: 2026-10-09T16:26:43.425Z
---

`pnpm worktree:new <PR#>` leaves local branch `pr-<N>` rebased onto origin/main (shows "ahead X, behind Y" vs the fork branch). Pushing fixes from it would force-push over the contributor's commits.

**Why:** hit on PR #6672 (2026-10-09); `git reset --hard` to the fork head was blocked by the auto-mode classifier as destructive.

**How to apply:** before committing fixes to someone's PR, `git switch -c pr-<N>-fork --track <fork-remote>/<branch>` in the worktree, commit there, `git push <fork-remote> HEAD:<branch>`. Commit only the PR's files — the foliate-js submodule shows `M` on an older base. After `worktree:rm`, delete both local branches and run `git submodule init` (see [[worktree-rm-deinits-shared-git-config]]).
