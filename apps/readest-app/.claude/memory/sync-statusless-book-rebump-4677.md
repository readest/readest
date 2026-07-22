---
name: sync-statusless-book-rebump-4677
description: Books with no reading status get re-pinned to top of library after every sync (updated_at rebump); PR
metadata: 
  node_type: memory
  type: project
  originSessionId: f943703d-f8c5-4ad9-9c2c-fc2c02d8b62c
---

# Statusless books re-pinned to top of library after every sync (PR #4677)

**Symptom:** a fixed set of books stayed pinned at the top of a `updatedAt`-desc ("date read") library. Reading/closing another book moved it to front, but the next cloud sync floated those books back above it. Gone after logout → caused by the sync round-trip.

**Root cause** (`src/pages/api/sync.ts` POST handler, books branch ~line 422): when a pushed book is NOT newer than the server (`clientIsNewer` false), it rewrites `updated_at = new Date().toISOString()` if `statusChanged`. The check was `status.reading_status !== serverBook.reading_status`. A locally-imported book that never got a status sends `reading_status: undefined` (dropped by `JSON.stringify`); the server stores `null`. `undefined !== null` ⇒ true ⇒ spurious rewrite. The rewrite re-writes `undefined` (→ stays `null`), so it NEVER converges. Discriminator is purely client-side: books that round-tripped through a PULL have `readingStatus: null` (set by `transformBookFromDB`) and don't trigger it; never-pulled imports keep `undefined`.

**Amplifiers:** (1) the 1-day re-sync window (`useSync.ts:98` `lastSyncedAtBooks = stored - ONE_DAY_IN_MS`) re-pushes every recently-touched book each sync. (2) the rewrite runs in one batch `upsert` transaction → all affected rows get the SAME `now()` ⇒ identical-to-the-ms timestamps (the tell-tale signature).

**Fix:** `readingStatusChanged(a,b) = (a ?? null) !== (b ?? null)` — treat undefined/null both as "no status". Existing inflated timestamps age out naturally; no migration. NOT a DB trigger (Alice kept her config time, proving the app writes the value).

**CDP verification recipe (Xiaomi, on-device):** the `pnpm dev-android` build = release APK with `--features devtools` → WebView debugging on → `tauri.localhost` + `webview_devtools_remote_<pid>` socket. Discover socket from `/proc/net/unix`, `adb forward tcp:PORT localabstract:<sock>`, drive via Node 24 native `WebSocket` to `/json/list` page target. The page can call `fetch('https://web.readest.com/api/sync?since=0&type=books', {Authorization: Bearer <localStorage token>})` directly to read cloud `updated_at` per book. Decisive evidence = compare in-app `PUSH_SENT` (client sends old ts) vs `PUSH_RETURNED` (server returns fresh identical `now()`) for the statusless books only. Console object args replay as `Array(N)` previews with stale objectIds — log pre-stringified JSON and/or stash into a `window.__SYNCDBG` ring buffer read via `Runtime.evaluate(returnByValue)`. Related: [[android-cdp-e2e-lane]], [[cdp-android-webview-profiling]]. Touches #4634 reading-status field-level merge.
