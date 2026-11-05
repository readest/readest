---
name: koreader-push-needs-matching-plugin
description: "koreader-e2e: `ko.sh push` of one Lua file onto an older installed plugin crashes KOReader natively; use `deploy`. Also `check` 'signed in' can be stale"
metadata:
  type: project
---

`ko.sh android push library/librarywidget.lua` from current main onto a device plugin at an older release (0.12.10) crashed KOReader natively on Add to Readest: a tombstone, no Lua traceback. `ko.sh android deploy` of the whole plugin worked at once (found 2026-11-06, PR #7360).

**Why:** a single file from main can need modules the older install lacks, and the failure looks like a bug in the change under test.

**How to apply:** check `_meta.lua` version first; `push` only onto a build of the same tree, otherwise `deploy`. Pull the plugin dir first so it can be restored exactly.

`ko.sh check` printing "readest: signed in" only means a token is stored. On the Xiaomi test phone (serial 368b0948) the refresh token had died, so opening the library returned `400 Invalid Refresh Token` and signed the plugin out. Any write that needs the cloud can't be tested until the user logs in again. Related: [[koreader-kindle-e2e-gotchas]].
