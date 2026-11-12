---
name: feedback-stash-shared-across-worktrees
description: "git stash is one list for every worktree; a stash/pop \"revert check\" on clean paths pops the user's old stash"
metadata:
  node_type: memory
  type: feedback
  originSessionId: ece20b1c-ca02-4678-964b-d74dd7c4ae48
  modified: 2026-11-04T07:20:54.399Z
---

Never do a "fails without the fix" check as `git stash push -- <paths> && test && git stash pop`
unless those paths have uncommitted changes. In a worktree where the fix is already
committed, the push stashes nothing and the pop applies the top of the stash list, which
is shared by every worktree of the repo (here, the maintainer's own `stash@{0}`). On
2026-11-04 that applied an unrelated memory-file stash into a PR worktree. It conflicted,
so git kept the entry and nothing was lost.

**Why:** the stash list belongs to the shared `.git`, not the worktree; a no-op push
gives no error.

**How to apply:** for a revert check, copy the fixed files aside, write the base version
in with `git show origin/main:<path> > <path>`, run the test, then copy the files back.
If a stash pop ever misfires: leave the stash entry alone and `git checkout HEAD -- <files>`
for the files it touched. Related: [[git-push-socks-proxy]].
