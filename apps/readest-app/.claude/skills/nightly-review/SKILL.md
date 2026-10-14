---
name: nightly-review
description: >
  The retrospective loop: review the commits merged since the last review for
  what had to be fixed again, what shouldn't have merged and what was verified
  too thinly; record lessons in LESSONS.md, promote repeated ones into the
  rules, clean up code that is rotting, and propose blocks for authors who keep
  sending low-quality PRs. Use with `/loop /nightly-review` (it does nothing
  until a day has passed), or when asked for a retrospective.
user_invocable: true
---

Agents write, review and merge most of Readest's changes. This loop is how they
learn: each day's merged work is reviewed, and what went wrong becomes a rule
that every later session reads.

## 0. Window

The first line of [LESSONS.md](../../../LESSONS.md) is
`<!-- reviewed-through: <sha> (<date time>) -->`. The window is
`<sha>..origin/main` after `git fetch`. If it is under ~20 hours old, stop:
nothing to do this tick.

Work in a fresh worktree (`pnpm worktree:new chore/lessons-<date>`).

## 1. Review each commit

For every commit in the window, read the commit, its PR (body, review
comments, CI on the merged head: `gh pr view N --json body,comments,reviews,statusCheckRollup`)
and its linked issues to their last comment. Put it in a bucket when the
evidence supports it:

- **Rework**: a later commit fixed, reverted or finished it; the issue was
  reopened, or the reporter said it still fails.
- **Shouldn't have merged**: scope beyond its goal, a reversed product
  decision, a red or cancelled CI run at merge, a community PR with gaps the
  review missed.
- **Verified too thinly**: no test that fails without it, no record of what
  was run, a platform claimed but not tried, a check left out instead of
  listed as not run.
- **Done right**: a model of the opposite. These go in too: agents learn
  "do this" as well as "don't".

Look ahead past the window's end for follow-ups; look back for older lessons
the window repeats.

Also read the Reply Desk (https://claude.ai/artifact/1HeqnCW2ey2T7BsE17NVLg,
`drafts` decided in the window): each `note`, each `edited` that differs from
`draft`, and each dropped draft is the maintainer correcting the loop. The
same correction on separate days is a lesson like any other.

## 2. Write the lessons

Each lesson in LESSONS.md is a one-sentence rule, then the evidence:

```markdown
**<one-sentence rule>**
- <sha> (#PR): <what went wrong and what it cost>. Fixed in <sha>.
- Done right: <sha> (#N) <what it did>.
- Seen N× (YYYY-MM-DD, YYYY-MM-DD).
```

- An existing lesson seen again: add the evidence, and add the day to its
  `Seen` list. `Seen` counts distinct days, not commits.
- A new pattern: add a lesson under the closest section, `Seen 1×`.
- No evidence, no lesson. A lesson is general enough to recur and specific
  enough that a reviewer can check it.
- Add a dated paragraph under the intro: the window, how many commits, and in
  a sentence or two what went wrong.

**Promotion.** A lesson seen on 3 or more distinct days moves into the rules:
add it to [acceptance](../../rules/acceptance.md) (or the `.agents/rules/`
file it belongs to) as a rule with its evidence, and leave a one-line entry
under "Moved to the rules" in LESSONS.md. From then on every review checks it.

Keep LESSONS.md lean: it is loaded into every session. Evidence older than
about two weeks is trimmed to the most telling example once a lesson is
promoted.

Public repo: never include user counts, payment data, user ids or emails.

## 3. Clean up

From the files the window touched, pick the code most likely to make the next
change harder: dead code, a copy of a helper that already exists, a function
that grew a branch per bug, tests that assert implementation. One cleanup per
PR, each with the acceptance checks, and only where behaviour stays identical
(say how you showed that).

## 4. Authors

Apply [contributors](../../../docs/contributors.md) "Blocking an author" to
the window's community PRs. Agents only propose: add evidence under
"Watched", and put a proposed block in the report for the maintainer. Never
block or close an author's PRs on sight until the maintainer has listed them
as blocked.

## 5. Ship

Set `reviewed-through` to the window's last sha, commit LESSONS.md (and any
promoted rule) as `chore(agent): lessons from <date range>`, open the PR, and
merge it when CI is green with `--match-head-commit`. Report: commits
reviewed, lessons added, lessons promoted, cleanup PRs, proposed blocks.
