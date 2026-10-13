---
name: koplugin-sync-tmpname-android-6364
description: 0.12.10 koplugin sync failed on ALL Android (os.tmpname -> /tmp unwritable) + full pullBooks ANR; PR #6364 OPEN; runInSubProcess memory numbers
metadata:
  type: project
---

0.12.10 koplugin (#6321) runs every sync RPC in a forked worker (`_dispatchInSubprocess`, used whenever `UIManager.looper` is nil = all devices). The response file came from `os.tmpname()`, which LuaJIT hardcodes to `/tmp/lua_XXXXXX`. Android `/tmp` is `shell:shell 0771` -> every call fails in 1 ms, status=nil, "cannot create sync response file" (user sees `upload-url-failed`); sign-in still works. Kindle `/tmp` = 64 MB tmpfs `/var`, filled by FastMetrics `fm-out-*` (147 KB / 10 min, cleared on reboot) -> responses >free space truncated.

Second bug found while verifying: first `pullBooks` after re-login = whole library (1778 rows), one autocommit per row on /sdcard -> >12 s on UI thread -> Android ANR kill; cursor saved after loop so it repeats every launch.

Fix MERGED #6364 (df79ae036, 2026-09-22): response file in settings dir; pullBooks loop in one BEGIN/COMMIT (0.9 s for 1778). Xiaomi-VERIFIED. chrox: no version bump, no new test.

Fork memory (child self-reads /proc/self/smaps; Android unrooted): Private_Dirty ~7 MB idle parent, ~115 MB when forked during library open (CoW copies from BOTH sides). Kindle 1-8 MB, one 19 MB spike. Possible cut: `collectgarbage("stop")` in the child. Kindle remote restart: `kill -TERM <reader pid>` then `setsid nohup ./koreader.sh --kual &`. See [[kindle-ssh-deploy-debug-recipe]].
