---
name: feedback-pr-watch-fix-conflicts
description: Watching an open PR means reviews AND CI checks AND merge conflicts; fix failing checks and obvious conflicts without being asked
metadata:
  node_type: memory
  type: feedback
  originSessionId: 80ca3f1a-5d6f-4f5c-b032-84116cb54b02
  modified: 2026-10-03T07:06:33.783Z
---

When monitoring a PR I opened, watch three things, not just reviews: (1) review/comments, (2) CI checks (`gh pr checks <n>`; any `fail` → pull the failed log with `gh run view <run> --job <job> --log-failed`, reproduce locally, fix), (3) merge conflicts (`gh pr view <n> --json mergeable` == CONFLICTING → merge origin/main, no force push).

**Why:** chrox, PR #6582 (2026-10-03): "also fix the obvious conflicts in the PR", then "the PR check has fails, remember when monitor PR also check the PR check not only the reviews". I had reported the PR as fine while `test_web_app (1)` was red.

**How to apply:**
- The watch loop must break on a failed check too, and never call a PR "green" without `gh pr checks`.
- Local gates must include `pnpm test:browser` (the CI web job runs it). The plain `pnpm test` jsdom suite missed a browser-only failure.
- Locale conflicts: take main's `public/locales`, run `pnpm run i18n:extract`, refill this branch's keys from `git show HEAD:...`.
- After merging main, re-sync submodules (stale foliate-js = dozens of unrelated test failures).
- Escalate non-obvious code conflicts instead of guessing.

Related: [[feedback-pr-review-trust-policy]].
