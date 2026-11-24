---
name: worktree-submodule-deinit-shared-config
description: "In a worktree, `git submodule deinit` drops the entry from the SHARED .git/config and uninitializes it in the main checkout; `update --init --recursive` fails on simplecc-wasm"
metadata:
  node_type: memory
  type: feedback
  originSessionId: bcb43d5a-9a9c-4808-a1cf-2d27d85db81e
  modified: 2026-11-20T09:07:41.219Z
---

To move a `pnpm worktree:new` worktree to current main (e.g. to build main's APK
after a merge), check out `origin/main` and run only
`git submodule update packages/foliate-js`, then `pnpm install --frozen-lockfile`.

- `git submodule update --init --recursive` there aborts on `packages/simplecc-wasm`
  (the script fills that dir itself) and initializes the gstack skills submodule at
  a wrong, dirty commit.
- `git submodule deinit` in a worktree removes `submodule.<name>.*` from the git
  config that all worktrees share, so the main checkout's submodule reads as
  uninitialized (`-<sha>`). The files stay. Fix with `git submodule init <path>` in
  the main checkout (URL from `.gitmodules`).

**Why:** 2026-11-20, after merging #7693: deinit of a stray gstack checkout in the
fix worktree uninitialized gstack in /Users/chrox/dev/readest; restored with
`submodule init` (files and pin a3259400a were intact).

`pnpm worktree:rm` does the same: `scripts/worktree-rm.ts:44` runs `submodule deinit
--force` in the worktree (since #3810), so after it foliate-js, tauri, qcms, js-mdict,
tauri-plugin-turso and tauri-plugin-webview-upgrade read `-<sha>` in the main checkout.
Restore each with `git config submodule.<path>.url <url from .gitmodules>` (they had
url only, no `active`). Script fix not made yet; reported to the owner 2026-11-20.

**How to apply:** after any `pnpm worktree:rm`, run `git submodule status` in the main
checkout and restore any `-` entries. Never `--init --recursive` or `deinit` inside a worktree; if a
stray submodule checkout dirties `git status`, `git -C <path> checkout <pin>` it
instead. See [[ios-worktree-device-build-gotchas]], [[feedback-stash-shared-across-worktrees]].
