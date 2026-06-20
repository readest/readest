---
name: dependabot-pnpm-overrides
description: How to fix transitive-dependency Dependabot/CVE alerts in the readest monorepo (pnpm overrides location + style)
metadata: 
  node_type: memory
  type: project
  originSessionId: cdc9c728-a2c7-4a9e-b87a-44046560a4fa
---

Transitive npm security advisories (Dependabot alerts against `pnpm-lock.yaml`) are fixed by pinning a **minimum patched version** in the `overrides:` block of **`pnpm-workspace.yaml`** at the monorepo root — NOT `package.json`'s `pnpm.overrides`.

**Why:** the repo uses pnpm 9+ (`pnpm@11.x`), which reads `overrides`/`patchedDependencies`/`catalog` from `pnpm-workspace.yaml`. A `pnpm.overrides` block added to root `package.json` is silently ignored — `pnpm install` runs fast and the lockfile doesn't change. There is already a long list of security pins in that `overrides:` block (glob, undici, qs, body-parser, etc.).

**How to apply:**
1. `gh api repos/readest/readest/dependabot/alerts/<N>` → get package + `first_patched_version` + vulnerable range.
2. Confirm parent ranges allow the patch (`cat node_modules/.pnpm/<parent>@*/.../package.json | grep '"<pkg>"'`).
3. Add/raise the entry in `pnpm-workspace.yaml` `overrides:` in the existing style: `<pkg>: '>=<patched>'` (e.g. `shell-quote: '>=1.8.4'`). **Check for an existing too-low pin** — e.g. `qs: '>=6.14.2'` still allowed the vulnerable 6.15.1; had to raise to `'>=6.15.2'`.
4. `pnpm install --lockfile-only` then `pnpm install`. Verify with `pnpm why -r <pkg>` (should show only the patched version). Stale dirs may linger in `node_modules/.pnpm` but are harmless if the lockfile has zero refs to the old version.
5. Dependabot **alert numbers are not GitHub issue numbers** — don't use `Closes #N`; alerts auto-dismiss when the vulnerable version leaves the default-branch lockfile. Reference the `/security/dependabot/<N>` URLs in the PR body instead.

First done in PR #4523 (shell-quote 1.8.4 / GHSA-w7jw-789q-3m8p, qs 6.15.2 / GHSA-q8mj-m7cp-5q26). Diff stays scoped to just the bumped packages; prefer this over `pnpm update <pkg>` which incidentally refreshes unrelated in-range patches (e.g. react-is). See [[feedback_pr_new_branch]] [[feedback_use_worktree]].
