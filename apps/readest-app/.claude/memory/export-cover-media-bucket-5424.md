---
name: export-cover-media-bucket-5424
description: "#5424 cover in md export + Readwise: Readwise takes only a fetchable image_url (max 2047, never base64); covers publish to media/book_covers via assets.readest.com"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6ede1611-f694-4f16-bd86-e088f7cfb1ea
  modified: 2026-08-02T09:11:39.103Z
---

Issue #5424: include the book cover when exporting annotations (markdown file +
Readwise push). MERGED #5435 (merge commit 69ae39c26, 2026-08-02; worktree and
branch removed). Final cover line: `![cover|300](url)` — user asked for
size 300 + centering, then vetoed inline HTML, so Obsidian pipe width only
(no centering; pure markdown cannot center). Readwise's own default is a plain
unsized `![rw-book-cover]({{image_url}})`; its hosted covers are ~355x530 so
the effective size matches our |300. Still open on infra side: confirm the
readest-public lifecycle/retention rule is scoped to `temp/` so
`media/book_covers/` objects stay durable.

Research findings (verified against readwise.io/api_deets + reporter's real
export):
- Readwise NEVER base64-embeds covers. Its exports link
  `![rw-book-cover](https://readwise-assets.s3.amazonaws.com/media/uploaded_book_covers/...)`.
- The highlight CREATE API takes `image_url` (max 2047 chars, so data URIs are
  impossible); Readwise fetches it and re-hosts on its own S3. Export/list
  endpoints call the field `cover_image_url`.

VERIFIED in Chrome 2026-08-02 (dev-web, signed in): checkbox -> real upload ->
`https://assets.readest.com/media/book_covers/b3d61257/bb02...png` serves 200
and renders. GOTCHA (looked like a 503, was NOT): the web app is cross-origin
isolated (`COEP: require-corp` in middleware.ts for Turso SharedArrayBuffer;
only `/s` gets credentialless) and R2 sends no CORP header, so a plain <img>
to assets.readest.com is BLOCKED — the extension's network log misreports it
as status 503 while curl gets 200. Fix: preview <img> gets
`crossorigin="anonymous"`; the readest-public bucket CORS allowlists the app
origins (localhost:3000/3001/8787/8788, tauri://localhost, web.readest.com...)
for GET so the CORS request satisfies COEP. Proved in-page: plain img BLOCKED,
cors img LOADED 333x512. Tauri + external md readers never affected (no COEP).
Optional infra hardening: a Cloudflare Transform Rule adding
`Cross-Origin-Resource-Policy: cross-origin` on assets.readest.com would make
plain embeds work everywhere.

Implementation decisions:
- `readest-public` bucket is now ALSO served at `https://assets.readest.com`
  (`READEST_PUBLIC_ASSETS_BASE_URL`). `media/` prefix = durable objects (unlike
  `temp/` which has bucket retention); upload API branch validates against a
  `PUBLIC_MEDIA_KINDS` allowlist and keys as
  `media/book_covers/<uuid-first-segment>/<coverHash>.png` (content-addressed,
  idempotent re-upload, mirrors the Discord presence upload from #5352).
- `getPublicCoverUrl` (src/utils/cover.ts): public `book.coverImageUrl` wins,
  else publish local cover.png; session success cache + 60s failure backoff
  because the Readwise auto-push debounces on every annotation change.
- Markdown export checkbox default OFF (publishing a cover to public storage
  is a privacy decision); Readwise toggle `includeCoverImage` default ON
  (public metadata cover URLs were already being sent before this change).
- The `media`/`temp` option threads through 4 layers:
  AppService.uploadFileToCloud -> cloudService -> libs/storage uploadFile ->
  /api/storage/upload.

Related: [[discord-cover-fallback-5352]], [[storage-upload-temp-key]]
