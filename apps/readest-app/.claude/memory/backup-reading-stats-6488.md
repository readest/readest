---
name: backup-reading-stats-6488
description: "#6488 library backup dropped reading stats (statistics.db lives in Data dir, backup walks Books only); fix = root statistics.json via getEventsForPush(0) + applyRemoteEvents on restore; Xiaomi-verified"
metadata:
  node_type: memory
  type: project
  originSessionId: 14e2c4c2-9a62-447b-9ecd-fa538cb4191c
  modified: 2026-09-30T06:38:18.948Z
---

#6488: backup zip = library.json + settings.json + live `<hash>/` dirs of the **Books** dir only. `statistics.db` is opened with base `'Data'` (sibling of Books), so no backup ever held reading sessions; on a default Android install it is app-private (unreachable without cloud).

Fix (branch `feat/backup-reading-stats-6488`, commit 07f9ce32c, worktree + branches removed, PR #6490 MERGED 2026-09-30 at 795e4956b (incl. flaky paginator drag-test fix); CodeRabbit nit (rest before touchend) MERGED #6493): backup adds root `statistics.json` = `StatisticsDb.getEventsForPush(0)` ({books, events}); restore feeds it to `applyRemoteEvents` (md5 match, `max(duration)` on conflict). Both in try/catch so a missing db never fails a backup. Old versions ignore unknown root entries (restore only reads library.json/settings.json at root), old backups have no entry.

**Xiaomi-verified 2026-09-30** with `pnpm dev-android` over the sideloaded 0.12.10 (`install -r` worked: same release keystore, installer=null): 3,676 events / 93 books / 44 h in the zip; restore of a zip with one extra marker event -> exactly +1 row, 0 dupes, 0 durations changed. The marker (1 s, page 95, book 32bb20d7…, startTime 1781665447) stays in that phone's stats.

Not done: dialog copy still says "library and settings"; restore result doesn't report stats. Push cursor means restored events older than the device's push cursor are not re-pushed to cloud.

Related: [[backup-keep-awake-6291]], [[ios-backup-share-sheet-6375]]
