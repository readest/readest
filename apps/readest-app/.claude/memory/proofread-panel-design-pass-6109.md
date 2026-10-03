---
name: proofread-panel-design-pass-6109
description: "PR #6109 (54wedge, TTS rules in the proofread panel) MERGED 2026-09-07 as squash 2e021e4c3; toggleRule dropped `scope` so library-scoped rules were never written - the hidden toggle was a symptom, not the bug"
metadata: 
  node_type: memory
  type: project
  originSessionId: 36e8617f-0012-4044-b2b6-5059e5ad403c
  modified: 2026-09-07T10:05:21.712Z
---

2026-09-07. PR #6109 from **54wedge** adds "Only for TTS" to the Proofread
Replacement Rules panel. Reviewed, reworked, pushed onto their branch as
`104060e95`, and **MERGED** as squash commit `2e021e4c3` on origin/main.
Worktree and local branches cleaned up.

Process note worth repeating: `pnpm worktree:new` rebased the branch, so the
fix was committed there first and then **cherry-picked onto the real PR head**
before pushing — a fast-forward (`2e5a4d754..104060e95`), contributor commits
intact, no history rewrite. See [[worktree-new-rebases-pr-force-push]]. Both
pre-flight checks came back empty (`git diff <pr-head> HEAD~1 -- <touched
files>` and the `git merge-tree` equivalence proof), so the rebase was not
load-bearing. `maintainerCanModify=true` is what allows the push to the fork.
Because GitHub squash-merged, the branch tips are NOT ancestors of
origin/main — verify the content landed (grep the file on origin/main) rather
than trusting `merge-base --is-ancestor` before deleting branches.

**The review finding worth keeping:** the PR hid the enable/disable switch on
library-scoped rules because "the toggle doesn't work at all". The switch was
fine; `proofreadStore.toggleRule` was not. It called
`updateRule(env, bookKey, ruleId, { enabled: !rule.enabled })` **without
`scope`**, and `updateRule` routes on `updates.scope === 'library'` — so a
library rule went down the book branch, which maps over the *book's*
`proofreadRules`, never finds it, and writes nothing. `removeRule` and
`saveEdit` both pass scope explicitly, which is why only the toggle looked
dead. Fixed by passing `scope: rule.scope` and using `enabled: rule.enabled ===
false` (the list renders `enabled !== false` as on, so `!undefined` would have
re-enabled a legacy flag-less rule). Regression tests live in
`src/__tests__/store/proofread-store.test.ts`.

Still open on that surface: 54wedge reports selection-scoped rules stop
applying after any toggle or edit (untouched here), and `ProofreadPopup`'s
`range.deleteContents()` path can drop markup when the selection spans
elements.

Related: [[proofread-gate-reflowable-formats]],
[[adhoc-visual-check-daisyui-theme-tokens]].
