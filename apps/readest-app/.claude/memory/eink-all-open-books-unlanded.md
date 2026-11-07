---
name: eink-all-open-books-unlanded
description: "#7360 merged at f9e9eb423 without the two-book E-Ink fix; local branch fix/eink-all-open-books (ebed93db0) is unpushed, two CodeRabbit findings unanswered"
metadata:
  type: project
---

PR #7360 (five user-report fixes) was merged 2026-11-05 at `f9e9eb423`. The last commit missed the merge and sits on local branch `fix/eink-all-open-books` (`ebed93db0`, on `33624b741`), not pushed, worktree removed.

It fixes two CodeRabbit findings on `f9e9eb423` that have no reply yet: E-Ink only refreshed the selected book, so with two books open the other stays `animated` with no `eink` and keeps animating until reopened; and a clear whose rescan was superseded can overwrite a reopened Manage Cache dialog with "Cache cleared".

**Why:** owner merged while the push was in its pre-push hook.

**How to apply:** if the owner wants it, open a PR from that branch, then answer both threads on #7360. Checked with two books on dev-web (both views followed E-Ink) and the settings tests on main; the full suite ran on the pre-rebase commit only.
