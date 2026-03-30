---
name: Always rebase before PR
description: Rebase to origin/main before creating pull requests
type: feedback
---

Always rebase the branch onto origin/main before creating a pull request.

**Why:** The user wants PRs to be up-to-date with main to avoid merge conflicts and keep a clean history.

**How to apply:** Before running `gh pr create`, always run `git fetch origin && git rebase origin/main` first. If there are conflicts, resolve them before proceeding.
