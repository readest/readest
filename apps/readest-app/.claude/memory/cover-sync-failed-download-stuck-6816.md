---
name: cover-sync-failed-download-stuck-6816
description: "#6816 synced cover blank/unchanged on Android: per-file cover download failure adopted the new coverHash and never retried; MERGED #7116 (c8d39a53b) UNRELEASED; reporter trigger UNCONFIRMED"
metadata:
  node_type: memory
  type: project
  originSessionId: 1cd1b731-00a4-4670-b82e-edb39da0a589
  modified: 2026-10-27T13:20:13.582Z
---

#6816: cover changed on web, Android shows blank/old cover. Happy path does NOT reproduce on 0.12.16 (PNG/JPEG/GIF/8.8 MB JPEG all synced, 2026-10-27). Reproduced the stuck state by `svc wifi disable` ~1.8 s after pull-to-sync: phone adopted new coverHash/coverUpdatedAt, coverDownloadedAt stayed set, old cover.png on disk, later syncs never refetched. Fix: `downloadBookCovers` per-file catch sets `coverDownloadedAt = null` (#7116, merged c8d39a53b, unreleased). Community PR #7079 (drop `uploadedAt` gate in needsCoverRefresh) was closed: wrong cause + would loop on never-uploaded books.

**Why:** reporter (MilamberNA) never confirmed image type/size; the real trigger may differ. Not verified with a fixed Android build.

**How to apply:** if #6816 recurs after the release ships, the retry path is ruled in; look elsewhere (thumbnail cache keyed bookHash-coverHash, asset URL WebView cache).
Repro recipe: web picker accepts only png/jpg/jpeg/gif; release Android WebView is debuggable (`webview_devtools_remote_<pid>` → CDP); read phone `Readest/Books/library.json` and cover.png via `http://asset.localhost/<urlencoded path>` (Range bytes=0-1 gives size); localhost:3001 = `pnpm build-web && pnpm start-web -p 3001` hits the production API and holds the test account session (`readestapp`), dev-web can't (no R2 creds).
