---
name: worktree-rebase-submodule-drift
description: "Rebasing a worktree onto an origin/main that bumped foliate-js leaves the submodule at the old commit; pre-push full-suite fails on the new submodule's tests"
metadata: 
  node_type: memory
  type: project
  originSessionId: 33b70e98-fb55-467a-b03f-e4065491bc7e
---

When a `pnpm worktree:new` worktree is rebased onto a newer `origin/main` that
**bumped a submodule pointer** (e.g. `packages/foliate-js`), the worktree's
submodule working tree stays at the OLD commit. New upstream tests that import
the bumped submodule code then fail, and the **pre-push hook runs the full
`pnpm test`**, so the push is rejected (not a flake, not your diff).

Symptom seen on #4741 PR: rebase pulled in #4764 (foliate search modes, #4560)
which bumped foliate-js `20ab3ec1 -> 982f168c` and added
`foliate-search-modes.test.ts` importing `foliate-js/search.js`; 8 tests failed
because the worktree submodule was still `20ab3ec1`.

**Fix:** sync the submodule to the commit recorded in the index. The worktree's
submodule `origin` is a local `file://` path (`.../.git/modules/...`) and
`git submodule update --init` fails with `transport 'file' not allowed`. Fetch
the exact commit from GitHub instead:

```
git ls-tree HEAD packages/foliate-js            # expected commit (e.g. 982f168c)
cd packages/foliate-js
git fetch https://github.com/readest/foliate-js.git <commit>
git checkout <commit>
```

Then re-run the failing test and `git status --porcelain packages/foliate-js`
(should be clean) before pushing. Run this check after ANY rebase of a worktree
when `git log <base>..origin/main -- packages/foliate-js` is non-empty.
See [[feedback_pr_rebase]], [[feedback_use_worktree]].
