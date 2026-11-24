---
name: feedback-leave-tauri-fork-unless-needed
description: "Don't change the readest/tauri fork (packages/tauri submodule) when the fix works from the readest repo, even if the fork holds the original cause"
metadata:
  node_type: memory
  type: feedback
  originSessionId: f044d97d-3a41-4747-a7a6-1c05ef7f2f6c
  modified: 2026-11-20T13:33:03.355Z
---

Leave the readest/tauri fork (`packages/tauri`) untouched when a fix in the readest repo (plugins, Swift/Kotlin, app code) is enough, even when the fork holds the line that caused the bug.

**Why:** on #7471 (2026-11-20) the fork's `set_prefers_home_indicator_hidden(true)` caused the blank Dynamic Island, but the native-bridge plugin could override it. The owner: "if the fix in the fork of tauri is not needed, then don't touch it". A fork change costs a fork PR plus a submodule bump.

**How to apply:** fix in the readest repo first. Bring a fork change up only when nothing else works, and say plainly what it buys (e.g. #7471: a ~0.8 s blank island at launch) so the owner can choose.

Related: [[dynamic-island-home-indicator-7471]].
