---
name: koplugin-exit-orphan-sync-workers-6685
description: "#6685 exiting KOReader right after a book closes left forked sync workers running; MERGED #7293 (7ca49cd82) UNRELEASED: quit wrapper delivers finished results, kills the rest after 5 s; segfault never reproduced"
metadata:
  type: project
---

#6685 (2026-11-03): without Turbo, close-time pushes fork workers, and `UIManager:quit()` empties the task queue before their polls run, so the workers outlive KOReader. The reporter's PW2 segfaulted at exit 5 of 8 times when that happened.

MERGED 2026-11-03 as #7293 (head 7ca49cd82), UNRELEASED: `readest_syncclient` keeps a set of worker pids (`trackWorker`/`untrackWorker`; also used by syncbooks downloadBook/downloadCover) and wraps `UIManager.quit` at module load: up to 50 × 100 ms wait, then `terminateSubProcess` + blocking reap. Review follow-ups: a finished sync RPC worker's poll runs during the wait (a refresh that completes there still saves the rotated token), and cover downloads write `<hash>.png.<pid>.part` and rename it only after a 200. Book downloads finishing in the wait still leave `.part` (not a regression: their completion updates the library DB, so it isn't run in quit). Follow-up for stale `.part` files not filed yet. A plugin can't hook after `UIManager:run` returns (it is already running when plugins load), and KOReader gives plugins no exit event, so the wrapper goes on quit.

**Why:** Kindle Voyage (5.13.6): main left orphaned workers in 2 of 5 exits; the fix left 0 of 4. No segfault in either build, so the crash link is the reporter's claim only. The test network timed out every TLS push, so only the kill path ran on the device.
**How to apply:** if the reporter still sees segfaults with #7293, the crash is elsewhere in the teardown. Android also calls quit on APP_CMD_DESTROY, so a stuck worker adds up to 5 s there (not verified). Recipe: [[koreader-kindle-e2e-gotchas]].
