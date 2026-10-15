---
name: feedback-pr-review-no-posting-offer
description: "When reviewing someone else's PR, deliver findings and stop; don't offer to post/approve/request changes"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 3920fdf8-272b-42e1-a916-f45890af0c19
  modified: 2026-10-13T07:25:17.414Z
---

When asked to review a contributor's PR, end with the findings. Don't close by offering to post a review comment, approve, or request changes.

**Why:** chrox said "don't ask, we will decide" after a PR #6703 review ended with an offer to post it. The maintainers decide what goes on the PR.

**How to apply:** after a /pr review, report the findings and the test results, then stop. Only post to GitHub when explicitly told to. Related: [[feedback-pr-review-trust-policy]].
