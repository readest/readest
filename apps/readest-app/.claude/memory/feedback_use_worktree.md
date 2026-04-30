---
name: Use worktree for PR/issue/feature work
description: Always create a git worktree with pnpm worktree:new before reviewing PRs, fixing issues, or implementing features
type: feedback
originSessionId: 650f8ff2-980d-459f-ad23-ba0af56e28b5
---
Always use `pnpm worktree:new <branch-name|pr-number>` to create an isolated worktree before starting work on:
- Reviewing a GitHub PR (e.g., `pnpm worktree:new 3809`) → worktree at `~/dev/readest-pr-3809`
- Fixing a GitHub issue (e.g., `pnpm worktree:new fix/issue-123`) → worktree at `~/dev/readest-fix-issue-123`
- Implementing a feature request (e.g., `pnpm worktree:new feat/my-feature`) → worktree at `~/dev/readest-feat-my-feature`

Worktree directory convention: `readest-<name>` in the parent of the repo root (`~/dev/`), with slashes replaced by dashes.

Use `pnpm worktree:rm <branch-name|pr-number>` to clean up when done.

**Why:** Keeps the current bare repo branch untouched. Each task gets its own isolated workspace with submodules, dependencies, env files, and vendor assets already set up.

**How to apply:** Before touching any code for a PR review, bug fix, or feature, run `pnpm worktree:new` first. Work inside the new worktree directory (e.g., `~/dev/readest-pr-3809/apps/readest-app/`). Clean up with `pnpm worktree:rm` after merging or finishing.
