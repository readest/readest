---
name: koplugin-stale-sync-responses-6417
description: koplugin readest_sync_*.json response files piled up in settings/ on every KOReader exit; PR #6461 sweeps them on first dispatch
metadata:
  type: project
---
#6417 (2026-09-29): without Turbo, `_dispatchInSubprocess` creates the response file before forking and deletes it only in `poll`; exit-time syncs never reach `poll`. MERGED #6461 (de167eb65) UNRELEASED: once-per-process sweep of `^readest_sync_%d+_%d+%.json$` before the first request. Not device-tested.

**Why:** onExit cleanup can't work — the orphaned child may still write after the UI exits; the next start is the first safe point.
**How to apply:** follows [[koplugin-sync-tmpname-android-6364]] (why the file lives in settings/). Trap: `git commit` in the main checkout picked up unrelated dirty memory files + foliate-js; commit with explicit pathspecs (`git commit -- <paths>`).
