---
name: push-workflow-file-needs-ssh-not-gh-oauth
description: "Pushing a commit that touches .github/workflows/ over an HTTPS remote fails with 'refusing to allow an OAuth App ... without workflow scope'; push the same commit over the SSH URL instead"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 0aab6391-7cfd-458c-b99f-854295b713d4
  modified: 2026-08-18T14:31:36.204Z
---

Contributor-fork remotes added by `pnpm worktree:new` are often **HTTPS**
(`https://github.com/<user>/readest.git`), which authenticates through the `gh`
OAuth token. That token does not carry the `workflow` scope, so any push whose
commits modify `.github/workflows/**` is rejected:

```
! [remote rejected] push-5605 -> feat/package-for-nix
  (refusing to allow an OAuth App to create or update workflow
   `.github/workflows/pull-request.yml` without `workflow` scope)
```

The rejection is about the **credential**, not permissions: `maintainerCanModify`
was already true, and every non-workflow file in the same commit would have
pushed fine.

**How to apply** — push the same ref over the SSH URL, which uses the user's SSH
key and is not subject to the OAuth scope check:

```bash
git push --no-verify git@github.com:<user>/readest.git <local>:<their-branch>
```

Seen on #5605 (2026-08-18): HTTPS `dastarruer` remote rejected, the identical
push to `git@github.com:dastarruer/readest.git` succeeded as a fast-forward
(`7a0236e05..7549a5a1d`).

The alternative, `gh auth refresh -h github.com -s workflow`, is interactive
(browser/device code), so it needs the user to run it; SSH avoids the round trip.
Verify no force happened afterwards with
`git merge-base --is-ancestor <old-head> <new-head>`.

Related: [[git-push-prepush-hook-runs-full-suite]],
[[worktree-new-rebases-pr-force-push]], [[feedback_use_worktree]].
