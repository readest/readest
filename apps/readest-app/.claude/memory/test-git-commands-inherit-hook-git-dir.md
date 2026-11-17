---
name: test-git-commands-inherit-hook-git-dir
description: A test that runs git in a temp repo must clear GIT_* env; the pre-push hook exports GIT_DIR and the test then rewrites the real repo
metadata:
  node_type: memory
  type: feedback
  originSessionId: 2538dc3c-08e2-4839-ae15-5d7ac9e6ca70
  modified: 2026-11-16T13:22:20.640Z
---

A unit test that shells out to `git` in a temp directory must delete every `GIT_*` env var first and assert `git rev-parse --absolute-git-dir` is inside the temp dir. The husky pre-push hook runs the suite with `GIT_DIR` set to the worktree's git dir, so `git init`/`config`/`checkout`/`commit` in the test hit the real repository.

**Why:** 2026-11-16, #7565's first draft of `worktree-merge-main.test.ts` passed when run by hand, then on `git push` it set `core.bare=true` (the main checkout at /Users/chrox/dev/readest showed "(bare)" and `git status` failed), wrote `user.name=Test`/`user.email`/`commit.gpgsign=false` into the shared `.git/config`, moved local `main`, `origin/main` and the PR branch onto fake commits, and switched the worktree to a `pr` branch. Restored from reflogs; nothing reached GitHub.

**How to apply:** reproduce with `GIT_DIR=<decoy>/.git pnpm test --run <file>` against a throwaway repo and check the decoy is unchanged. After any push whose hook ran new git-using tests, snapshot `.git/config` and `for-each-ref refs/heads` before and after. To recover: prior values come from reflogs (`git reflog show <branch>`) and from the author/signature of commits made just before (a signed commit by the global identity means no local `user.*`/`commit.gpgsign` was set).

Related: [[feedback-pr-watch-fix-conflicts]], [[worktree-new-pr-rebases-onto-main]].
