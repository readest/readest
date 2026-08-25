---
name: git-push-socks-proxy
description: This machine reaches GitHub only through a SOCKS proxy; a push whose pre-push hook holds the SSH link idle stalls/drops. How to push reliably.
metadata: 
  node_type: memory
  type: reference
  originSessionId: 576eb196-dbd0-46a7-8cc7-d34100408d05
  modified: 2026-08-25T10:45:59.392Z
---

**Environment:** shell has `http_proxy=https_proxy=http://127.0.0.1:8118`, and
`~/.ssh/config` routes `Host github.com` -> `HostName ssh.github.com` `Port 443`
via `ProxyCommand nc -x 127.0.0.1:8119 %h %p` (SOCKS at 8119). GitHub is reachable
ONLY through that proxy.

**What fails:**
- A DIRECT `ssh://git@ssh.github.com:443/...` with `-o ProxyCommand=none` is
  firewalled: `Connection closed by 20.205.243.160 port 443`. (So the trick of
  "bypass the proxy with a direct ssh URL" does NOT work here, even though another
  session's push command was seen using it.)
- A normal `git push` through the proxy stalls: `.husky/pre-push` runs
  format:check + lint + test (~2.5 min) AFTER the SSH connection to
  `git-receive-pack` is already open, so the link sits idle and the proxy
  stalls/drops it. Symptoms: `git push` hangs for minutes at the receive-pack
  stage, or `fatal: the remote end hung up upon initial contact` / `Broken pipe`.
  The ssh-config comment documents exactly this ("Broken pipe on push").

**What works:** run the three hook gates manually first, then push with keepalives
and skip the (redundant) hook so the pack transfers immediately on a fresh link:

```
cd apps/readest-app && pnpm format:check && pnpm lint && pnpm test   # gates
cd <worktree-root>
GIT_SSH_COMMAND="ssh -o ServerAliveInterval=15 -o ServerAliveCountMax=8" \
  git push --no-verify -u origin <branch>
```

Keep `origin = git@github.com:readest/readest.git` (goes through the working
proxy). Push in the background ([[feedback_dont_push_every_change]]). ls-remote and
`gh` API calls (small) work fine through the proxy without special handling.
Only skip the hook with `--no-verify` after you have actually run the gates —
see [[verification.md]] / project rules. Related: [[push-workflow-file-needs-ssh-not-gh-oauth]].
