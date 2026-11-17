---
name: worktree-new-pr-rebases-onto-main
description: "`pnpm worktree:new <PR#>` rebases the PR onto origin/main (force-push risk); recovering a conflicted setup, incl. foliate gitlink + Android gen by hand"
metadata:
  node_type: memory
  type: project
  originSessionId: 1397d54d-f940-4bd6-aad5-111f9219655d
  modified: 2026-11-15T13:09:16.616Z
---

`pnpm worktree:new <PR#>` leaves local branch `pr-<N>` rebased onto origin/main (shows "ahead X, behind Y" vs the fork branch). Pushing fixes from it would force-push over the contributor's commits.

**Why:** hit on PR #6672 (2026-10-09); `git reset --hard` to the fork head was blocked by the auto-mode classifier as destructive.

**How to apply:** before committing fixes to someone's PR, `git switch -c pr-<N>-fork --track <fork-remote>/<branch>` in the worktree, commit there, `git push <fork-remote> HEAD:<branch>`. Commit only the PR's files — the foliate-js submodule shows `M` on an older base. Run `git submodule update packages/foliate-js` after switching, or the pre-push hook's full suite fails on PDF canvas tests (main's foliate vs the fork base's tests; hit on #6964, 2026-10-21). If the rebase conflicts (e.g. locale files on #6997, 2026-10-23), the script exits at `git rebase origin/main` and leaves the worktree mid-rebase with no submodules, `node_modules`, vendor or simplecc dist; a rerun fails ("refusing to fetch into branch checked out"). Recover with `git rebase --abort`, switch to the fork branch as above, then run the rest of `scripts/worktree-new.ts` by hand (submodule init from `.git/modules`, `pnpm install`, copy `public/vendor` + `packages/simplecc-wasm/dist`). A PR whose head already merges main also conflicts: the rebase replays the original commit against main's later changes (#7395, 2026-11-09). For web-only work the by-hand setup needs the two `src-tauri/plugins/*` submodules (dev-web imports `tauri-plugin-turso/guest-js` via a tsconfig path) but can skip `packages/tauri`, which has no `.git/modules` cache and clones from GitHub for minutes. After `worktree:rm`, delete both local branches and run `git submodule init` (see [[worktree-rm-deinits-shared-git-config]]).

If `worktree:new` dies at `git fetch "<fork>"` with "Could not resolve host: github.com" (HTTPS DNS fails here while ssh.github.com:443 works, 2026-11-15 on #7450), set the fork remote to SSH (`git remote set-url <fork> git@github.com:<fork>/readest.git`) and rerun; the script only adds an HTTPS remote when none exists.

When the fork branch later conflicts with main (only appended locale keys on #7420, 2026-11-12), merge `origin/main` into `pr-<N>-fork` rather than rebasing, so the push stays fast-forward. Resolve each `translation.json` as main's file plus the PR's keys (json.dumps indent=2, ensure_ascii=False keeps main's formatting). `git submodule update packages/foliate-js` then fails ("did not contain <sha>"); fetch it from the main checkout's working submodule instead: `git -C packages/foliate-js fetch /Users/chrox/dev/readest/packages/foliate-js <sha>` and check it out. The merge carries main's `.github/workflows` changes, so push over SSH (see [[push-workflow-file-needs-ssh-not-gh-oauth]]). A conflicted PR gets no CI run on push; the merge push triggers it.

A foliate-js gitlink conflict (PR pinned to a companion foliate-js PR, #7422, 2026-11-12) also stops the script at the rebase. Recover the same way: merge `origin/main` into the PR branch, set the gitlink with `git update-index --cacheinfo 160000,<sha>,packages/foliate-js`, and commit. To build an APK from that worktree, also run the script's Android gen steps by hand: `rm -rf src-tauri/gen/android && pnpm tauri android init && pnpm tauri icon ../../data/icons/readest-book.png`, then `git checkout` gen/android and icons, and symlink `gen/schemas` and `gen/android/keystore.properties` from the main checkout. Run the dev-android build through `pnpm exec dotenv ...`: the bare `dotenv` on PATH is a different tool, which exits 0 without building anything.
