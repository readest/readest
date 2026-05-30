---
name: Don't push on every change
description: Commit when work is done; don't auto-push every iteration during active debugging
type: feedback
originSessionId: 49a72b36-8f45-4a57-87e1-e10563bac47a
---
Don't `git push` after each commit while a bug is being actively iterated on. Commit locally as needed but hold the push.

**Why:** When a fix doesn't actually solve the user-reported bug, every push is wasted CI cycles + remote churn the user has to look past on the PR. The user is testing live and will tell us when something's actually verified.

**How to apply:** During debugging or fix iterations on a single user-reported bug, commit locally only. Push when (a) the user confirms the fix works, (b) the user explicitly asks to push, or (c) we hit a clean done-state on a multi-step task. New commits + lint/test green is not enough.
