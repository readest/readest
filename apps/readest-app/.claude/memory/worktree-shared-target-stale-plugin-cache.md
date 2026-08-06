---
name: worktree-shared-target-stale-plugin-cache
description: "Worktrees SYMLINK target/ to the main repo's shared cargo target; a deleted worktree's cached tauri plugin build-script outputs poison tauri-build (\"failed to read plugin permissions\") in every other worktree"
metadata: 
  node_type: memory
  type: project
  originSessionId: c14ae948-5947-4c4a-b2cf-1e5bc7b0567b
  modified: 2026-08-06T06:17:52.229Z
---

Every `pnpm worktree:new` worktree symlinks `target ->
/Users/chrox/dev/readest/target` (one shared cargo target for all worktrees).
Tauri plugin build scripts emit ABSOLUTE paths (permission file locations
derived from CARGO_MANIFEST_DIR) into `target/debug/build/<pkg>-<hash>/output`.
When the worktree that produced those outputs is deleted, the cached paths
dangle, but cargo still considers the fingerprints fresh — so the next
`tauri-build` run in ANY worktree dies with:

```
failed to run tauri-build: failed to read plugin permissions
Caused by: failed to read file '/Users/chrox/dev/readest-<dead-worktree>/packages/tauri-plugins/plugins/fs/permissions/app.toml'
```

Seen 2026-08-06 on the icloud PR #5532 rebase: `pnpm test:rust` had passed
minutes earlier, then the #1217 worktree got removed post-merge and the next
Readest build-script rerun (triggered by a capabilities/default.json mtime
bump from the rebase) read 26 packages' stale outputs.

**Fix — surgical, never `cargo clean` the shared target (hours of rebuilds
for every worktree):**

```
cd <worktree>
grep -rln "<dead-worktree-dirname>" target/debug/build --include=output \
  | sed 's|.*/build/||; s|-[0-9a-f]\{16\}/output||' | sort -u
# then: cargo clean -p <pkg> for each name, from apps/readest-app/src-tauri
```

Re-verify with the same grep returning 0, then rerun `pnpm test:rust`.
A "workspace-root cargo target" claim appears in
[[tauri-dangling-sourcemap-comments-5498]]; the SYMLINK makes it effectively
global. See also [[worktree-rebase-submodule-drift]] for the sibling
rebase trap (submodule pointer drift).
