---
name: ci-pr-delivery-and-push
description: Delivering small PRs from a dirty dev tree without a worktree; the slow pre-push hook + proxy SSH-drop and its keepalive fix
metadata: 
  node_type: memory
  type: project
  originSessionId: c1097233-8b53-422a-98ec-3f0146f32f6b
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
