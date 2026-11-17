---
name: feedback-pr-review-no-posting-offer
description: "Reviewing a contributor's PR: fix every issue found and push it to that PR (rework it whole if needed); don't stop at findings or offer to post"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 3920fdf8-272b-42e1-a916-f45890af0c19
  modified: 2026-11-17T04:13:26.806Z
---

When reviewing a contributor's PR, fix the issues found and update that PR: commit the fixes on its branch and push. If the approach itself is wrong, rework the whole PR and push the rework to the original PR, not a new one. Don't end with findings plus an offer to post, approve or request changes.

**Why:** chrox, 2026-11-17 on #7512: "always try to fix any issues found in the pr and update the pr, if necessary we need to rework the whole pr and then update to the original pr". Earlier (#6703, 2026-10-13): "don't ask, we will decide" about offering to post a review.

**How to apply:** after a /pr review, write the failing test, apply the fix in the worktree, run the checks, merge origin/main if it conflicts (never rebase or force-push), push to the PR branch, then report what changed and what ran. Merging stays the maintainer's call. Related: [[feedback-pr-review-trust-policy]], [[feedback-pr-watch-fix-conflicts]].
