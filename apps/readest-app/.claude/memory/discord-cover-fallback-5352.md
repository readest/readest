---
name: discord-cover-fallback-5352
description: "#5352 Discord Rich Presence covers fall back to the book icon — not book-specific; the cover URL is re-minted hourly and any failure is cached for 1h"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2f9b2241-d329-4a5a-8fb6-2f469e789c65
  modified: 2026-07-28T16:33:44.018Z
---

Issue #5352 (open, Windows 11, v0.11.20): Discord Rich Presence shows the open-book
icon instead of the cover "for some books". Reporter later saw the two books that
*had* worked stop working too.

Investigated 2026-07-28. Findings:

- **Not book-specific.** Downloaded all four EPUBs the reporter shared and ran the
  real `processDiscordCover` in Chromium (`pnpm test:browser`) on their extracted
  covers. All four produce valid `image/jpeg` blobs (31–66 KB); the two "failing"
  books (Lord of the Flies, Milk and Honey) process fine. Cover content /
  extraction is eliminated as a cause.
- **The pipeline demonstrably works for this user.** The working screenshot shows
  the cover with a **black bar** on one side plus the baked-in Readest icon —
  exactly `processDiscordCover` output (portrait cover drawn on a 512×512
  transparent canvas, then encoded as JPEG, which has no alpha). So they are
  signed in, uploads reach R2, and Discord does resolve external
  `https://storage.readest.com/...` URLs. The failure is a flaky link, not config.
- **The fallback image is visually ambiguous.** `book_icon` is a real registered
  Discord art asset (id 1462683620484321403) *and* the Readest app icon is the same
  open-book artwork. So "icon shown" cannot distinguish
  "client returned no URL" (`discord_rpc.rs` `unwrap_or("book_icon")`) from
  "Discord failed to resolve the URL". Check `GET /api/v9/oauth2/applications/<id>/assets`
  to re-verify.
- **The public cover URL is re-minted every clock hour.**
  `src/pages/api/storage/upload.ts` temp branch builds
  `temp/img/<YYYYMMDDHH>/<user8>/drp_<hash>.jpg` — `slice(0,10)` of the ISO string
  is hour-granular. Client cache (`src/utils/discord.ts`) is also 1 h, so every
  book hands Discord a brand-new, never-before-seen URL at least once an hour.
- **Any single failure is sticky for an hour.** `coverUrlCache` stores `url: null`
  on failure and short-circuits for `CACHE_DURATION`, with no distinction between
  permanent (no `cover.png`) and transient (network/API) failure and no retry.
  Only `console.warn`, nothing in the Tauri log, so users can't report the cause.
- **Desktop uploads carry no Content-Type.** `tauriUpload` → `upload_file`
  (`src-tauri/src/transfer_file.rs`) sets only `Content-Length`, so R2 stores the
  JPEG as `application/octet-stream`. The R2 presign signs `content-length` only
  (`src/utils/r2.ts` `X-Amz-SignedHeaders=content-length`), so a size mismatch
  between `file.size` (a HEAD over the asset protocol for desktop `RemoteFile`)
  and the on-disk length would 403 the PUT.
- `processDiscordCover` has no timeout; if an `Image` neither loads nor errors the
  promise never settles, `isUpdatingRef` stays true and presence updates stop
  entirely for that book.

FIXED — MERGED #5382 (merge commit 4edc3901, 2026-07-28; worktree and branch
removed): dropped `timeStr` from the temp key in
`upload.ts` and keyed the upload filename on `book.coverHash || book.hash`, so
the public URL is stable per cover; split the negative cache in `discord.ts`
into missing-cover (1 h) vs upload failure (60 s, doubling, capped 15 min).
Tests: `src/__tests__/api/storage-upload-temp-key.test.ts`,
`src/__tests__/utils/discord-cover-cache.test.ts`.

Still open, deliberately out of scope: desktop PUT sends no Content-Type so R2
serves `application/octet-stream`; failures only reach `console.warn`, never the
Tauri log; `processDiscordCover` has no timeout; transparent→black JPEG bars.

Related: [[cover-stale-inplace-mutation-memo]], [[svg-cover-stretch-duokan-5375]]
