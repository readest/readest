---
name: worktree-rm-deinits-shared-git-config
description: "pnpm worktree:rm runs git submodule deinit, which writes to the SHARED .git/config, so it deregisters submodules for the primary checkout and every other worktree"
metadata: 
  node_type: memory
  type: project
  originSessionId: c108a474-3341-4a1b-ab6c-0c7c8fe02958
  modified: 2026-08-13T08:59:07.813Z
---

`pnpm worktree:rm <branch>` calls `git -C "$worktreePath" submodule deinit --force -- <sub>` for
every submodule listed in `.gitmodules` (`apps/readest-app/scripts/worktree-rm.ts` ~line 44).

**Worktrees share `.git/config` with the primary checkout**, and `deinit` removes the
`submodule.<path>.url` / `.active` keys from it. So removing ONE worktree deregisters those
submodules **repo-wide**. After a single `worktree:rm`, `git submodule status` in
`/Users/chrox/dev/readest` printed `-` (uninitialized) for foliate-js, tauri, tauri-plugins,
tauri-plugin-turso, tauri-plugin-webview-upgrade, qcms, js-mdict and tao.

**Why it is easy to miss:** nothing is actually broken on disk. The directories keep their
content, their `.git` files still point at `.git/modules/...`, `git -C packages/foliate-js log`
works, and superproject `git status` is clean. Only submodule-aware commands go wrong —
`git submodule status` reports uninitialized, and `submodule update` / `foreach` silently SKIP
those paths. That is a booby trap for the next `worktree:new` or a rebase that moves a pointer.

**Fix (non-destructive, no content touched)** — re-register by explicit path, do NOT bare
`git submodule init`, which would also register the intentionally-skipped ones (the flutter
submodule under localsend has `update = none`; see [[localsend-integration]]):

```
cd /Users/chrox/dev/readest
for p in packages/foliate-js packages/tauri packages/tauri-plugins packages/qcms \
         packages/js-mdict packages/tao \
         apps/readest-app/src-tauri/plugins/tauri-plugin-turso \
         apps/readest-app/src-tauri/plugins/tauri-plugin-webview-upgrade; do
  git submodule init -- "$p"
done
git submodule status   # every line must start with a space, not '-'
```

**How to apply:** after ANY `pnpm worktree:rm`, run `git submodule status` in the primary
checkout and re-init anything showing `-`. Hit 2026-08-11 removing the #5625 worktree, and
again 2026-08-13 removing the #5664 and #5673 worktrees (same 8 paths every time).

**Verified 2026-08-13 on `dev`:** bare `git submodule init` restored exactly the pre-rm set and
nothing else — on `main`/`dev` `.gitmodules` lists only those 10 paths and no localsend entry
(the `update = none` flutter submodule lives in the *fork* repo's own `.gitmodules`, not this
superproject's), and `init` can only register paths that are in `.gitmodules`. Keep the
path-explicit loop for branches that carry extra submodules. No `submodule update` is needed
either way: the working dirs are untouched, and `init` alone preserved branch checkouts
(`packages/tao` stayed on `fix/ios-scene-configuration-role`). Diff `git submodule status`
before and after the rm to confirm.

**Partial-removal failure mode (2026-08-13, bulk clear of 26 merged worktrees):** on a worktree
with dirty submodule content, `pnpm worktree:rm` can exit nonzero yet still deregister the
worktree and delete most of the directory — a retry then fails with "no worktree found" while a
partial tree (no `.git` link) remains on disk. Check `git worktree list`; if it's already gone,
just `rm -rf` the leftover directory and `git worktree prune`. One rm or twenty-six, the shared
config is deinit'd the same way — re-init once at the end, not per removal.

Related: [[worktree-submodule-origin-is-local-gitdir]], [[worktree-rebase-submodule-drift]],
[[worktree-shared-target-stale-plugin-cache]], [[feedback_use_worktree]].
