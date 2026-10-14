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

Nothing reaches GitHub without the maintainer's approval. Every comment,
review, close and merge below is drafted to the **Reply Desk**
(https://claude.ai/artifact/1HeqnCW2ey2T7BsE17NVLg, collection `drafts`,
through the `ArtifactData` tool) and done only after it is approved there.
Fixing locally, in worktrees, needs no approval.

## Send what was approved

Start each tick by querying `drafts` for `status == "approved"`. For each:

1. Re-read the thread. If someone other than us commented after the draft's
   `createdAt`, don't post: set `status: "stale"`, a one-line `staleReason`
   naming the new comment, a fresh `draft` that answers it, `edited: null`,
   and a new `createdAt`. It goes back to the maintainer.
2. If `sendWith` is `fix-pr`, push the `fix.branch` and open its PR first,
   then add `Fix: #<PR>` to the end of the reply.
3. Post `edited ?? draft` exactly, from a file: `gh issue comment N
   --body-file`, `gh pr comment`, or `gh pr review N --request-changes
   --body-file` when `verdict` is `request-changes`. Then do `then`: `close`
   closes the thread; `merge` runs `gh pr merge N --squash
   --match-head-commit <headSha>`, and fails safely if the head moved.
4. Update the draft: `status: "sent"`, `sentAt`, `sentUrl` (the comment's
   URL). Pin every write with `if_version`.

A non-empty `note`, and any difference between `draft` and `edited`, is the
maintainer's feedback on how the loop writes. Follow it in this tick's new
drafts; the nightly review turns repeated feedback into lessons.

## Drafting

One document per thread, id = the thread number (a newer draft for the same
thread replaces a `pending` or `stale` one; never touch an `approved` or
`sent` one). Fields: `number`, `kind` (`issue`|`pr`), `title`, `url`,
`author`, `lastComment` `{author, at, text}` (excerpt), `verdict`,
`verdictLabel`, `summary` (one line), `decision` (what the maintainer must
decide, or null), `fix` (`{branch, commit, run[], notRun[]}` or null),
`sendWith` (`next-tick`|`fix-pr`), `then` (`close`|`merge`|null),
`headSha` (for `merge`), `draft`, `edited: null`, `note: ""`,
`status: "pending"`, `order`, `createdAt`. Write all of a tick's drafts in
one `batch`. The replies are posted as the maintainer: never say "the
maintainer will decide"; say what happens next in the first person plural.

## 0. What changed

State lives in `${XDG_STATE_HOME:-$HOME/.local/state}/readest-loops/github.json`
(`{"since": "<ISO time>"}`). Missing means the last 3 days. Record the time
you start, and write it back only when the tick finishes.

Only threads created in the last 3 days are the loop's. Older ones are the
maintainer's backlog, mostly large feature requests: leave them alone even
when they get a new comment.

```bash
CREATED=$(date -u -d '3 days ago' +%Y-%m-%d)
gh search issues --repo readest/readest --include-prs --created ">=$CREATED" \
  --updated ">=${SINCE%%T*}" --limit 100 \
  --json number,title,isPullRequest,state,author,createdAt,updatedAt,url
```

GitHub search takes dates only: a full timestamp in `--updated` silently
matches nothing. Filter `updatedAt >= SINCE` on the result, and ignore an
update that is only our own comment.

Skip a closed thread, and one whose newest comment is already ours and has no
reply. Read every other thread to its last comment before acting: a reporter
may have put the request on hold, answered a question or said a fix didn't
work. Use `gh issue view N --json body,comments` and `gh pr view N --json ...`
(plain `gh issue view` fails on the deprecated Projects-classic field), and
`gh api graphql` for a PR's `reviewThreads` to see which findings are still
unresolved.

Hand independent issues to parallel forks, each in its own worktree and on
its own dev-server port.

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
   sessions share it. If the script stops early, finish by hand: restore
   `src-tauri/gen/android` with `git checkout --`, and copy `public/vendor`
   and `packages/simplecc-wasm/dist` from the main checkout before
   `pnpm lint`.
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

End the tick with a short list: what was sent from the desk, what was fixed
locally, how many drafts now wait on the desk, and anything waiting for the
maintainer (product decisions, harm stops, proposed blocks). Then write the
new `since`.
