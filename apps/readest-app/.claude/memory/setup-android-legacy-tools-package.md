---
name: setup-android-legacy-tools-package
description: "android-actions/setup-android defaults to installing the removed `tools` SDK package, failing every Android CI leg"
metadata:
  type: project
---

`android-actions/setup-android` (all versions through v4.0.1, and still on the
action's `main` as of 2026-09-17) defaults its `packages` input to
`tools platform-tools`. Google removed the obsolete `tools` package from the SDK
repository, so the action now dies at the **setup Android SDK** step:

```
Warning: Failed to find package 'tools'
Error: The process '.../cmdline-tools/20.0/bin/sdkmanager' failed with exit code 1
```

This broke the nightly Android leg on 2026-09-16 (run 35155788186). Nothing in
the repo changed — the remote SDK repository did, so it fails with no diff and
there is no newer action tag to bump to.

**Fix (MERGED #6238):** pin `packages: 'platform-tools'` on every call site —
`nightly.yml`, `release.yml`, `android-e2e.yml`. The NDK is unaffected; it comes
from the explicit `sdkmanager "ndk;28.2.13676358"` step that runs after.

**Why:** the action's default is the whole failure; we never used `tools`.
Leaving the input unset means any future default change breaks CI again.

**How to apply:** when an Android leg fails in under a minute with no code
change, read the *setup Android SDK* step, not the build. Verify a workflow-file
fix cheaply by dispatching `android-e2e.yml` on the branch — it exercises the
same setup step and publishes nothing, unlike a nightly dispatch which rewrites
`nightly/latest.json` in R2. Workflow-file pushes need SSH, see
[[push-workflow-file-needs-ssh-not-gh-oauth]].

Gotcha when polling steps: GitHub reports not-yet-started steps as `pending`,
not `queued` — a monitor filter that only excludes `queued|in_progress` will
report a step as finished before it has started. Wait on a non-null
`conclusion`.
