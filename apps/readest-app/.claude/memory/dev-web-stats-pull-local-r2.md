---
name: dev-web-stats-pull-local-r2
description: "On pnpm dev-web, /api/sync?type=stats 500s 'archive segment N unavailable: missing object' for any account with compacted stats: next dev's STATS_ARCHIVE_R2 is an empty local bucket. Compare cross-device stats in Tauri, which uses the production API"
metadata:
  type: project
---

`next dev` runs `initOpenNextCloudflareForDev()` with local bindings, so `STATS_ARCHIVE_R2` (src/libs/statsArchive.ts) is an empty miniflare bucket while the `stat_archives` manifest rows come from the production DB. A full stats pull (`since=0`) on localhost fails on the first archived segment, and the browser's OPFS statistics.db keeps only its own events. Found 2026-10-23 on #6986: localhost:3000 showed 9h 24m for an account Tauri showed at 108h 26m.

**Why:** Tauri (and production web) call `https://web.readest.com/api`, which reads the real bucket; dev-web calls its own `/api`.

**How to apply:** don't read a short stats history on dev-web as an app bug. To check cross-device stats, use a Tauri build and query `~/Library/Application Support/com.bilingify.readest/Readest/statistics.db` (copy it with its -wal first). Dead ends: the wrangler OAuth login has no R2 scope, so `remote = true` on the binding needs a re-login granting R2; pointing dev-web's `getAPIBaseUrl` at production was blocked by the permission classifier as traffic redirection.
