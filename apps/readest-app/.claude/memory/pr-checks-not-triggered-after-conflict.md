---
name: pr-checks-not-triggered-after-conflict
description: A push to a PR that conflicts with main (or is resolving one) can get NO "PR checks" run at all; `gh pr checks` says "no checks reported"; retrigger with close+reopen
metadata:
  type: project
---

Seen on #6617 (2026-10-04): two maintainer pushes to a contributor fork branch (one made
while the PR conflicted with main, one being the conflict-resolving merge) produced zero
workflow runs. `gh pr checks N --watch` exits immediately with "no checks reported", and
`gh api "repos/readest/readest/actions/runs?head_sha=<sha>"` returns total_count 0 (nothing
in `status=action_required` either). Probably because GitHub could not build the PR's test
merge at push time.

**How to apply:** after pushing to a PR, confirm a run exists for the new head sha before
treating a quiet `gh pr checks` as green. If none exist, `gh pr close N && gh pr reopen N`
fires `pull_request: reopened` (PR checks has no workflow_dispatch). That keeps the
approval and adds no commit. See [[feedback-pr-watch-fix-conflicts]].
