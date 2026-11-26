---
name: worktree-merge-leaves-foliate-on-old-pin
description: "Merging origin/main into a worktree doesn't move its foliate-js checkout to main's new pin, so tests run on old foliate; `git submodule update` can't fetch the pin from the local mirror"
metadata:
  node_type: memory
  type: project
  originSessionId: 5f0921a1-b44e-4346-bfb8-e2d21c29f2b6
  modified: 2026-11-25T06:10:05.731Z
---

`git merge origin/main` in a worktree updates the recorded foliate-js pin but not the checkout. `git status` shows ` M packages/foliate-js` and `git submodule status` shows `+<old sha>`. Lint and tests then run on the old foliate. On 2026-11-25 the gift-cards branch had passed a full suite this way after a merge that brought in #7854's pin.

`git submodule update packages/foliate-js` then fails: "Fetched in submodule path ... but it did not contain <sha>". The worktree's foliate `origin` is the main checkout's `.git/modules/packages/foliate-js` (see [[footnote-fb2-span-notes-7564]]). There the pinned commit sits only on the mirror's remote-tracking refs (`refs/remotes/origin/*`), which a plain fetch doesn't bring over. A pin on foliate main is on `refs/remotes/origin/main`. An off-main pin is only on its `*-on-pin` branch (see [[cfi-range-start-between-children-7482]]), so fetching main alone misses it.

Fix, from the worktree root (fetches every remote-tracking ref, so it covers both):
`git -C packages/foliate-js fetch origin '+refs/remotes/origin/*:refs/remotes/origin/*' && git -C packages/foliate-js checkout --detach <pin>`
Checked 2026-11-26 from an empty repo with the mirror as `origin`: a fetch of main alone brought main's pin a4b72589 but not the off-main a8c708f; the fetch above brought both.

**Why:** a merge is reported as tested when its foliate code wasn't.

**How to apply:** after every merge of main in a worktree, check `git submodule status` for `+` before running checks, and move the checkout as above when it has no local changes. See also [[worktree-submodule-deinit-shared-config]].
