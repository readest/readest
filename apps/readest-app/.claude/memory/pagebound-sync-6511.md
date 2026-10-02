---
name: pagebound-sync-6511
description: "#6511 Pagebound progress sync — MERGED #6528 (6c3ca474a), unreleased; private API quirks verified live; in-app + release verified"
metadata:
  node_type: memory
  type: project
  originSessionId: e7d30397-6094-4bd6-b2bb-48f67456c909
  modified: 2026-10-01T13:24:31.004Z
---

#6511 Pagebound progress sync: MERGED #6528 (6c3ca474a) 2026-10-01, unreleased; worktree + branch removed. Follow-up #6531 (saveConfig write ordering) OPEN. Progress + status only (notes would be PUBLIC forum posts). Tauri-only: API sends no CORS headers.

Verified LIVE against prod with chrox's account (Node fetch + real PageboundClient, test entries deleted after): login, auto-match, shelve, scaled page update, finished, interested->current, token renew. NOT yet tested inside the Tauri app (plugin-http, settings form, link dialog).

Private API quirks (no docs; shapes from ShelfSync + pagebound.co bundle):
- POST /user_books 500s on `''` for finished_reading_at / total_page_count; send null.
- Typesense search must `sort_by=rating_count:desc` (web does), else study guides outrank the book.
- API token = JWT `{user_id}` with NO exp. A stale token never gets 401: GET /books answers anonymously (user_book null), writes 422 "User must exist", /auth/get_authed_user 500. So validate via get_authed_user before writing, renew via Firebase refresh token.
- Formats: print | digital | audio. Status PUT may be partial (web finish flow sends only status/date/finished_reading_at).
- Node fetch here needs `NODE_USE_ENV_PROXY=1` (Google APIs blocked without the 8118 proxy) + sandbox off.

Related: [[hardcover-link-book-5846]]

CodeRabbit round 1 (2026-10-01), fixed in 92df4eae1: auto-match now EXACT normalized title (or a "Series: Title" part, each part also searched); live "Mistborn: The Final Empire" top hit was a dramatized audio adaptation. No prefix match ("X: Study Guide" must fail -> Link Book). In-flight push guard (double POST /user_books on unshelved book). Session callback ignores renewals after disconnect. DECLINED: renew-only-on-401 (Pagebound returns 500 for stale token), 1-min gate on close flush, per-book config write queue (same as Hardcover rememberLink).
Secret-scanning alert #2 = Pagebound's PUBLIC Firebase web key in PageboundClient.ts; not a Readest leak; recommended "false positive", awaiting chrox.

2026-10-01 later: merged main (locale conflicts = take main + re-extract + reapply translations; worktree foliate-js submodule must be synced to main's pin or pdf-canvas tests fail). Search now TITLE ONLY (author spelled differently e.g. "J.R.R." and Typesense needs all tokens), prefer compact-author match (e9a9c6c07). MenuItem noIcon description misaligned (fixed 435526ccd, also Hardcover row). Covers broken ONLY under `next dev` (middleware COEP require-corp; CDNs send no CORP) — release build VERIFIED by chrox. In-app Push Progress VERIFIED on chrox's account (The Hobbit 70% p222/317, kept). Release build recipe: `pnpm tauri build --no-bundle --config '{"build":{"beforeBuildCommand":"pnpm build"}}'` (skips Sentry upload), binary target/release/readest (lowercase), wrap in .app.
