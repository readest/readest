---
name: triage-github
description: >
  One tick of the GitHub maintenance loop: triage new and updated issues and
  pull requests on readest/readest, fix what is worth fixing, review and merge
  community PRs that pass the acceptance criteria, and reply on every thread.
  Use with `/loop /triage-github`, or when asked to work through the issue and
  PR queue.
user_invocable: true
---

One tick of the GitHub loop. Each tick handles what changed since the last
tick and then stops; `/loop` schedules the next one.

Read these first, every tick (they change while the loop runs):
[LESSONS.md](../../../LESSONS.md), [acceptance](../../rules/acceptance.md)
and [contributors](../../../docs/contributors.md).

## 0. What changed

State lives in `${XDG_STATE_HOME:-$HOME/.local/state}/readest-loops/github.json`
(`{"since": "<ISO time>"}`). Missing means the last 24 hours. Record the time
you start, and write it back only when the tick finishes.

```bash
gh search issues --repo readest/readest --include-prs --updated ">=$SINCE" --limit 100 \
  --json number,title,isPullRequest,state,author,updatedAt,url
```

Skip a thread whose newest comment is already ours and has no reply. Read every
other thread to its last comment before acting: a reporter may have put the
request on hold, answered a question or said a fix didn't work.

## 1. Issues

Decide one of these for each issue, then act:

| Verdict | Action |
| --- | --- |
| Reproducible bug | Fix it (below), then reply with the PR. |
| Feature worth building, small and in line with the product | Build it (below), then reply with the PR. |
| Feature that needs a product decision | Reply that it is noted for the maintainer, label `discussion` if it exists, and list it in the tick report. Don't build it. |
| Not worth fixing or building | Reply with the reason, kindly and in the reporter's language. Close it only when it is a duplicate (link the original), not a Readest bug, or already fixed. |
| Needs information | Ask for exactly what would let you reproduce: platform, app version, the book file, steps, a screenshot. |
| Advertising or a request to add a third-party relay/service | Reply once: "Thanks for your interest. We'll share partnership plans when we have them." and close. Never add a third-party relay, API reseller or affiliate link to the product. |

### Fixing

1. Reproduce the reporter's exact case on their platform and surface before
   writing code (LESSONS.md, "Reading the report"). If you can't, say what you
   tried and ask; don't ship a guess.
2. `pnpm worktree:new fix/<slug>` — never work in the main checkout; other
   sessions share it.
3. Follow `.agents/rules/test-first.md`: a failing test first. Grep for every
   sibling of the bug and fix them in the same change.
4. Meet every item in [acceptance](../../rules/acceptance.md); list what you
   didn't run.
5. Open the PR (Conventional Commits title, body with what was run, at which
   commit, and what fails without the change). The PR review workflow in
   CLAUDE.md applies while it is open.
6. Merge when CI is green on the reviewed head:
   `gh pr merge <N> --squash --match-head-commit <sha>`.

Releases are the maintainer's: Readest ships through app stores, so a reply
says the fix lands in the next release, never names a version that isn't out.

## 2. Pull requests

The maintainer's own PRs (and the loops' PRs) follow the PR review workflow in
CLAUDE.md: CI, trusted review comments, merge when green. For each new or
updated community PR:

1. **Harm first.** Apply [contributors](../../../docs/contributors.md)
   "Look for harm first" to the diff before running anything. A hit stops the
   review: comment which line, and list it in the tick report for the
   maintainer.
2. **Close unreviewed** what contributors.md says to close, with its short
   reason. Close on sight a PR from a blocked author.
3. **Review by running it.** `pnpm worktree:new <PR number>`, merge current
   `origin/main` in, then every line of the diff, then the acceptance
   criteria. Revert the fix and confirm its new test goes red; break the code
   it guards and confirm a test catches it. Check every platform it claims.
4. **Decide.**
   - Everything holds: comment what was run, at which head sha, and what
     wasn't run; then `gh pr merge <N> --squash --match-head-commit <sha>`.
     A head pushed after the review is reviewed again.
   - Fixable gaps: request changes with the specific failing check, or push
     the fix to the PR branch yourself when the author allows edits and it is
     small.
   - Wrong, untested, unrelated or machine-made filler: close with the reason.
     Note the author under "Watched" in contributors.md if it is their second.

Never merge a PR that reverses a deliberate product decision (see
acceptance.md), a draft, or one whose own new test fails.

## 3. Report

End the tick with a short list: what was fixed (PR links), merged, closed,
asked, and anything waiting for the maintainer (product decisions, harm stops,
proposed blocks). Then write the new `since`.
