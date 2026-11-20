---
name: ci-only-race-repro-inject-delay
description: Reproduce a browser test that only flakes on CI by injecting a temporary delay into foliate-js at the suspected gap
metadata:
  node_type: memory
  type: reference
  originSessionId: b43865f2-71d1-415d-8bd8-0527d8043608
  modified: 2026-11-17T17:32:34.347Z
---

A browser test that passes locally but flakes on CI is usually a test racing an async step that a slow runner widens. To prove it, add a temporary `await new Promise(r => setTimeout(r, 300))` at the suspected gap in `packages/foliate-js` and run the file. It should fail the same way CI did. Fix the test to wait on a real signal, confirm it passes with the delay still in place, then `git checkout` the foliate file. Don't use git stash for this (see [[feedback-stash-shared-across-worktrees]]).

Example, #7598 (merged d265a4a8c): the pull tests in `paginator-single-section-scroll.browser.test.ts` dragged once the chapter appeared in `getContents()`. `pull.from` is only set after `#loadAdjacentSection` resolves, so the drag was sometimes ignored. `grab()` now waits for `create-overlayer` plus one task.

Also: `git worktree remove` needs `--force` on readest worktrees because they contain submodules. Check `git status` first.
