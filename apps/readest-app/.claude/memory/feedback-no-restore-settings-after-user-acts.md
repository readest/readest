---
name: feedback-no-restore-settings-after-user-acts
description: "Never copy a settings backup back over an app's settings once the user may have used the app in between; it wiped a fresh KOReader sign-in"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 5336425d-49ea-4088-830b-4496cf377519
  modified: 2026-10-23T12:26:22.666Z
---

Don't "restore" an app's settings file (KOReader `settings.reader.lua`, etc.) from a backup taken earlier in the session once the user may have interacted with the app since. Check the live file first (e.g. compare `expires_at`/mtime); if it changed, leave it.

**Why:** on 2026-10-23 (#6933 verification) I restored the emulator settings backup while the user was signing in; their new Readest session was overwritten and they had to sign in again.
**How to apply:** prefer not backing up/restoring at all for verification runs that only read state; if cleanup is needed, restore only the pieces you changed (e.g. a plugin symlink), never the whole file. See [[koplugin-macos-fork-getaddrinfo-6933]].
