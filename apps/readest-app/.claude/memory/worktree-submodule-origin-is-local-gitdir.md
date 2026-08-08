---
name: worktree-submodule-origin-is-local-gitdir
description: "in a pnpm worktree:new worktree the foliate-js submodule origin points at the local .git/modules gitdir, not GitHub, so git fetch origin main silently returns a stale main"
metadata: 
  node_type: memory
  type: project
  originSessionId: baccdf36-54f1-4398-92a0-80a42087d950
  modified: 2026-08-07T14:19:43.904Z
---

Inside a worktree made by `pnpm worktree:new`, the `packages/foliate-js` submodule's `origin` is **`/Users/chrox/dev/readest/.git/modules/packages/foliate-js`**, not `git@github.com:readest/foliate-js.git`. So `git fetch origin main` there succeeds, prints nothing alarming, and hands back whatever stale `main` the primary checkout happens to have — which can be several commits *behind* the submodule pointer you are standing on.

**Why:** it silently produces a wrong answer instead of an error. Chasing a just-merged foliate-js commit, `git log origin/main -3` in the worktree showed a tip two commits older than HEAD and `merge-base --is-ancestor` reported "not merged", which reads exactly like a squash merge and sends you down the wrong path. Compounding it: the worktree's refspec is `+refs/heads/*:refs/remotes/origin/*`, so fetching from the gitdir only sees its **local branches** — a `git fetch origin main` you ran in the primary checkout updates `refs/remotes/origin/main` there, which the worktree's refspec will never pick up.

**How to apply:** when you need a real remote SHA from a worktree's submodule, fetch the URL explicitly and use `FETCH_HEAD`:

```
git fetch git@github.com:readest/foliate-js.git main
git checkout FETCH_HEAD          # then `git add packages/foliate-js` in the superproject
```

Always confirm with `git rev-parse HEAD` against the SHA GitHub shows for the merge commit, and diff the merged commit against the old pointer to prove the merged content is what you wrote (squash merges can absorb review edits).

Related: [[cursor-autohide-blanked-during-selection]], [[worktree-rebase-submodule-drift]], [[feedback_use_worktree]].
