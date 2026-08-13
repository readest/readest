---
name: worktree-shared-target-stale-plugin-cache
description: "Worktrees SYMLINK target/ to the main repo's shared cargo target; a deleted worktree's cached tauri plugin build-script outputs poison tauri-build (\"failed to read plugin permissions\") in every other worktree"
metadata: 
  node_type: memory
  type: project
  originSessionId: c14ae948-5947-4c4a-b2cf-1e5bc7b0567b
  modified: 2026-08-10T08:24:19.104Z
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

**Now auto-prevented (dev commit `1e2e27fe2`, 2026-08-10):** `scripts/worktree-rm.ts`
runs package-scoped `cargo clean -p` for the six local path crates
(`tauri-plugin-{fs,native-tts,native-bridge,webview-upgrade,turso}` + `Readest`)
right after `git worktree remove`, best-effort. So `pnpm worktree:rm` no longer
leaves dangling paths. Manual recovery below is still needed for worktrees
removed with plain `git worktree remove` (bypassing the script). NOTE the app
crate (`Readest`) clean forces a ~2-3 min recompile on the next Rust build in
ANY checkout — cost of the guaranteed fix. Cleaning the plugins alone does NOT
suffice: the app's own `build.rs` caches the stale path and only re-runs when
the app crate is cleaned.

**Manual fix — surgical, never `cargo clean` the shared target (hours of rebuilds
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
