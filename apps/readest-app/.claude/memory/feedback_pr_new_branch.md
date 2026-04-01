---
name: Always use a new branch for new PRs
description: Each new PR/issue should get its own fresh branch from main, never reuse an existing feature branch
type: feedback
---

Always create a new branch from main for each new PR or issue. Never reuse an existing feature branch for unrelated work.

**Why:** The user corrected this when a storage fix was committed on the `feat/full-sync-annotations` branch instead of a dedicated branch. Mixing unrelated changes on the same branch makes PRs harder to review and manage.

**How to apply:** Before committing fixes, create a new branch like `fix/<topic>` from `origin/main`. Only reuse a branch if the work is directly related to that branch's existing purpose.
