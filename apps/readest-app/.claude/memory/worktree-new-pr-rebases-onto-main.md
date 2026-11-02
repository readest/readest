---
name: worktree-new-pr-rebases-onto-main
description: "`pnpm worktree:new <PR#>` rebases the PR onto origin/main, so committing there and pushing back would need a force-push to the contributor's fork"
metadata:
  node_type: memory
  type: project
  originSessionId: 1397d54d-f940-4bd6-aad5-111f9219655d
  modified: 2026-10-21T07:44:56.255Z
---

`pnpm worktree:new <PR#>` leaves local branch `pr-<N>` rebased onto origin/main (shows "ahead X, behind Y" vs the fork branch). Pushing fixes from it would force-push over the contributor's commits.

**Why:** hit on PR #6672 (2026-10-09); `git reset --hard` to the fork head was blocked by the auto-mode classifier as destructive.

**How to apply:** before committing fixes to someone's PR, `git switch -c pr-<N>-fork --track <fork-remote>/<branch>` in the worktree, commit there, `git push <fork-remote> HEAD:<branch>`. Commit only the PR's files — the foliate-js submodule shows `M` on an older base. Run `git submodule update packages/foliate-js` after switching, or the pre-push hook's full suite fails on PDF canvas tests (main's foliate vs the fork base's tests; hit on #6964, 2026-10-21). If the rebase conflicts (e.g. locale files on #6997, 2026-10-23), the script exits at `git rebase origin/main` and leaves the worktree mid-rebase with no submodules, `node_modules`, vendor or simplecc dist; a rerun fails ("refusing to fetch into branch checked out"). Recover with `git rebase --abort`, switch to the fork branch as above, then run the rest of `scripts/worktree-new.ts` by hand (submodule init from `.git/modules`, `pnpm install`, copy `public/vendor` + `packages/simplecc-wasm/dist`). After `worktree:rm`, delete both local branches and run `git submodule init` (see [[worktree-rm-deinits-shared-git-config]]).
