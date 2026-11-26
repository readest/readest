---
name: push-ssh-drops-during-pre-push-hook
description: "git push exits 141 / 'Connection to ssh.github.com closed by remote host … Broken pipe' after the ~3 min pre-push test run; remote not updated. Push over HTTPS via gh instead."
metadata:
  type: reference
---

The pre-push hook runs the full vitest suite (~3 min). Over SSH, git opens the
connection to `ssh.github.com:443` before the hook and GitHub closes it while
it sits idle, so the push dies afterwards with SIGPIPE (exit 141) and the
branch is NOT updated. The suite's "passed" output makes it look fine; a `-q`
push piped through grep/tail shows nothing at all. `ServerAliveInterval`
keepalives worked once and failed the next time: not a fix.

Push over HTTPS with gh's credentials, hook still enabled (ref discovery, hook,
then the pack in a separate request, so nothing idles):

```bash
git -c credential.helper= -c credential.helper='!gh auth git-credential' \
  push https://github.com/readest/readest.git HEAD:refs/heads/<branch>
```

For a community PR whose branch lives in a fork, push to the PR's head repo
instead (`gh pr view <N> --json headRepositoryOwner,headRepository,headRefName`):
`https://github.com/<owner>/<repo>.git HEAD:refs/heads/<headRefName>`.

Not for changes under `.github/workflows/` (the gh OAuth token lacks workflow
scope, see [[push-workflow-file-needs-ssh-not-gh-oauth]]).

Always confirm with `git ls-remote origin refs/heads/<branch>` (or the PR's
`headRefOid`) before saying a push landed. Seen 3x on #7815 (2026-11-23).

Related: [[feedback-bounded-waits]]
