---
name: ci-pr-delivery-and-push
description: Delivering small PRs from a dirty dev tree without a worktree; the slow pre-push hook + proxy SSH-drop keepalive fix; pushing a rebased PR branch to a contributor fork needs SSH, not HTTPS
metadata: 
  node_type: memory
  type: project
  originSessionId: c1097233-8b53-422a-98ec-3f0146f32f6b
  modified: 2026-08-08T09:09:11.218Z
---

How CI/config PRs get delivered in this repo when `dev` has unrelated uncommitted WIP, and the push gotcha.

**Packaging a commit onto a fresh PR branch WITHOUT `pnpm worktree:new`** (the worktree script does a full `pnpm install` + `tauri android init` + icon gen — disproportionate for a YAML/package.json-only PR, and you can't `git checkout` a branch in the dev tree because the user's WIP blocks it):
1. Edit the target files in the dev tree (only files NOT in the user's WIP set — verify with `git status --short -- <files>`), `git add` just those, commit on `dev` (mirrors how the user wanted the pin committed).
2. Re-parent onto `origin/main` (or onto the existing PR-branch tip for a fast-forward add) via a temp index — no checkout, no worktree, dev working tree untouched:
   ```
   export GIT_INDEX_FILE=$(mktemp); git read-tree <BASE>
   git update-index --cacheinfo 100644,$(git rev-parse HEAD:<path>),<path>   # per changed file
   TREE=$(git write-tree); unset GIT_INDEX_FILE
   NEW=$(git log --format=%B -n1 HEAD | git commit-tree $TREE -p <BASE>)
   git update-ref refs/heads/<branch> $NEW
   ```
3. Verify `git diff --stat <BASE>..<branch>` shows ONLY the intended files, then push.

This is how PR #4547 (pin `android-emulator-runner` + shard `test_web_app`) was built on top of `origin/main` while `dev` carried 49 files of unrelated dictionary/goodreads WIP.

**Push gotcha (now fixed in `~/.ssh/config`):** `git push` opens the SSH connection BEFORE running the pre-push hook; the husky hook runs the FULL vitest suite (~55s, 5271 tests) + format + lint. The user pushes through a SOCKS proxy (`nc -x 127.0.0.1:8119` → `ssh.github.com:443`), so the idle connection got dropped during the hook → "Broken pipe", ref never transferred (remote stayed at old SHA — always `git ls-remote` to confirm). Fix added: `ServerAliveInterval 15` + `ServerAliveCountMax 60` under `Host github.com`. Also: **`--no-verify` is safe once the hook has already passed** on the same tree — re-running it just re-opens the idle window. See also [[feedback_dont_push_every_change]], [[feedback_use_worktree]].

**Pushing to a contributor's fork (PR review flow) — use SSH, never the HTTPS remote.** `pnpm worktree:new <pr#>` rebases the PR onto current `origin/main`, so updating the PR branch needs `--force`, and the rebase drags in whatever main touched since — including `.github/workflows/*`. `gh`'s OAuth token has no `workflow` scope, so the HTTPS remote it configures (`https://github.com/<user>/readest.git`) rejects the push:

```
! [remote rejected] refusing to allow an OAuth App to create or update
  workflow `.github/workflows/android-e2e.yml` without `workflow` scope
```

Push to `git@github.com:<user>/readest.git` instead — SSH isn't subject to the OAuth scope check and the user's key already has access when the PR has `maintainerCanModify: true` (check with `gh pr view <n> --json maintainerCanModify`). `gh auth refresh -s workflow` would also fix it but needs an interactive browser, so it's the user's to run.

Pin the lease to the SHA actually fetched from the fork rather than bare `--force`, so a commit the contributor pushed meanwhile aborts the push instead of being clobbered:
`git push --force-with-lease=<branch>:<fetched-sha> git@github.com:<user>/readest.git HEAD:<branch>`

**Better: avoid the rewrite entirely with a fast-forward.** The force is only needed because `worktree:new` rebased the PR onto current `origin/main`. Nothing requires pushing *that* version. Instead branch from the fork's actual tip and cherry-pick your commit onto it:

```
git fetch <user> <branch>                    # note the tip SHA
git branch -f tmp-ff <fork-tip>; git checkout tmp-ff
git cherry-pick <your-commit>
git diff <your-commit> tmp-ff -- <files you touched>   # must be empty
git push --force-with-lease=<branch>:<fork-tip> git@github.com:<user>/readest.git HEAD:<branch>
```

The push is then a fast-forward (`<fork-tip>..<new>`), the contributor's commit SHA and PR timeline stay intact, and GitHub still tests the merge with main. Note `git diff <yours> <cherry-picked>` over the *whole tree* is expected to show whatever main gained since the PR branched — diff only your touched paths. Keep `--force-with-lease` anyway as the race guard, then `git checkout <pr-branch>; git branch -D tmp-ff`. Repeat per follow-up commit (the lease SHA becomes your previous push). Used four times on PR #5496 (2026-08-05).

**Offer the fast-forward FIRST, not as an afterthought.** On #5562 (2026-08-08) the options put
to the user were stash/commit/apply and then force-push-the-rebase, and the fast-forward above
was never mentioned — so the contributor's three SHAs got rewritten for no reason. Read this
memory before proposing how to deliver a review fix to someone else's PR.

**`maintainerCanModify` flips to `false` the moment the PR merges**, and the push then fails
with a bare `! [remote rejected] (permission denied)` that looks like an SSH/key problem and is
not. Before debugging a denied fork push, check `gh pr view <n> --json state,maintainerCanModify`
— `state: MERGED` means there is nothing left to push.

**A squash-merged PR makes your local copy of it un-rebasable.** GitHub squashes N commits into
one, so patch IDs no longer match and `git rebase origin/main` replays all N against the squash
and conflicts on every file. Do NOT resolve those conflicts. Abort, confirm the squash captured
everything (`git diff <your-last-local-commit> origin/main -- <the PR's paths>` must be empty),
then drop them wholesale by replaying only what came after:
`git rebase --onto origin/main <your-last-commit-of-that-PR> <branch>`. Hit on #5562 (2026-08-08),
where `dev` carried four local commits of a PR that landed as one squash plus one unrelated commit
on top; the `--onto` form left `dev` as exactly `origin/main` + that one commit.

**Recovering from a rewrite already pushed:** the fork's original commits usually still exist
locally (they were fetched before the rebase — `git cat-file -e <sha>` to confirm). Branch from
the original tip, cherry-pick your commit onto it, and force-push once more; the end state has
the contributor's SHAs intact with your fix on top, and their clone pulls it as a fast-forward
with no `reset --hard` needed.

The husky pre-push hook runs the full suite on the exact pushed tree, so its output doubles as final verification of the pushed commit.
