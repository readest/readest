---
name: concurrent-sessions-share-next-out-dir
description: "Two agent sessions running pnpm dev-* in the same checkout clobber each other's .next/out; the tell is ENOENT on _buildManifest.js.tmp or a missing _ssgManifest.js asset"
metadata: 
  node_type: memory
  type: project
  originSessionId: 9d293ac4-41e7-4c2f-accf-b6a7b26e7e1b
  modified: 2026-08-07T05:00:24.049Z
---

`pnpm dev-macos` / `dev-android` / `dev-ios` all run `next build` into the
SAME `apps/readest-app/.next` and `out/`, and the usual fix for a stale build
(`rm -rf .next`) deletes files the other session's build is mid-write on.
Symptoms, both of which look like a broken change but are not:

```
Error: ENOENT ... open '.next/static/<id>/_buildManifest.js.tmp.<rand>'
error: failed to read asset at .../out/_next/static/<id>/_ssgManifest.js
```

Before diagnosing a build failure, check for a competing build:
`ps aux | grep -E "next build|tauri (build|android|ios)"`. If one is running,
**wait for it** (`while kill -0 <pid> 2>/dev/null; do sleep 15; done`) instead
of cleaning again — cleaning again just breaks their build too.

Seen 2026-08-07: two Claude Code sessions in `/Users/chrox/dev/readest`, one
building macOS and one Android, took three failed builds to spot. `git status`
showing files you never touched (another session's edits) is the early tell
that you are sharing a checkout. Use `pnpm worktree:new` for anything that
needs its own build — see [[feedback_use_worktree]].

Related: [[turbopack-dev-stale-chunk-phantom]] (the genuine stale-`.next` case
this gets mistaken for).
