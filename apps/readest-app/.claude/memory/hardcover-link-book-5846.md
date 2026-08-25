---
name: hardcover-link-book-5846
description: "#5846 Hardcover picks the wrong book (audiobook / duplicate) with no way to fix it: manual Link Book picker + shelf-first, readable-only auto-match; link persisted in BookConfig.hardcover"
metadata: 
  node_type: memory
  type: project
  originSessionId: b58cf444-b72c-4377-bc4d-74be43fb34af
  modified: 2026-08-24T19:01:07.009Z
---

Issue #5846 (2026-08-24): no-ISBN books fall back to title search, take hit #1
(an audiobook entry), add it as a second "currently reading" entry, and the toast
says "synced". Branch `feat/hardcover-link-book`, worktree
`~/dev/readest-feat-hardcover-link-book`, spec
`docs/superpowers/specs/2026-08-25-hardcover-link-book-design.md` (LOCAL ONLY:
`docs/superpowers` is gitignored since .gitignore:71; older specs predate it).
Built 2026-08-25; PR #5857 opened and MERGED same day (`fc25b6206`), three
commits (client+types, hook+UI, locales). Worktree and local branch removed;
the spec copy lives in the main checkout's gitignored docs/superpowers/specs/. Independent review (opus subagent) caught 2
P1s before push: on-shelf audiobook duplicate winning the auto-match, and the
false "rides cloud sync" claim.

**What shipped**
- `BookConfig.hardcover?: { bookId, title }` (`HardcoverBookLink`). DEVICE-LOCAL:
  `transformBookConfigToDB` (src/utils/transform.ts) whitelists columns, so the
  cloud push drops it (reviewer caught my "rides cloud sync" claim); WebDAV wire
  drops it too. Syncing needs a `book_configs` column + migration (follow-up).
  A successful auto-match is persisted as the link too (KOReader-plugin
  semantics) but ONLY fills a missing link (a push takes seconds; a manual pick
  made meanwhile must win).
- `HardcoverClient`: `QUERY_SEARCH_BOOKS` = `search(... per_page: 20) { ids }`
  (ranked ids, replaces the 3-shape `results` blob); `QUERY_GET_BOOKS` =
  `books(where:{id:{_in}})` hydrate with title/pages/release_year/
  users_read_count/cached_image/cached_contributors + nested
  `editions(where readable, order_by users_count desc_nulls_last, limit 1)` +
  `user_books`. Auto-match (`pickAutoMatch`, shared with the picker) = first hit
  on shelf AND readable, else first readable, else null; an on-shelf
  audiobook-only duplicate (the issue's exact state) must NOT win. `pushProgress`
  returns the link and THROWS when unresolved or when Hardcover has no page
  count (both used to return silently + toast "synced"). `searchBooks()` feeds
  the picker.
- `HardcoverSyncMapStore.clearForBook()` after persisting a relink to a different
  book (previous = stored link, else the opening search's auto-match, for
  pre-feature installs that synced notes); unlink does NOT clear, else a
  same-book re-match duplicates every note.
- UI: BookMenu > Hardcover Sync > "Link Book" (linked title as description) ->
  `hardcover-link-book` event -> `HardcoverLinkDialog` hosted by ReaderContent.
- 13 i18n keys added to all 34 locales via a node script (not the scanner).

**NOT verified live.** Desktop settings.json and the web.readest.com session both
have Hardcover disconnected (no token), so the GraphQL shapes were only checked
against billiam/hardcoverapp.koplugin's production queries. The one construct
not literally in the koplugin is the nested `editions(...)` under `books`
(koplugin queries root `editions(where:{book_id})`). First thing to verify with
a connected account: open a no-ISBN book, Hardcover Sync > Link Book, confirm
results render (covers via `cached_image.url`, authors via
`cached_contributors[].author.name`), then Push Progress.

**Why:** the reporter's correct book was already "currently reading" on their
shelf; readest never looked there and audiobook-only hits were never filtered
from search (the `reading_format_id !== 2` check only guarded user editions).

**How to apply:** any future Hardcover match logic must respect
`config.hardcover` first. Edition picker ("Change edition") and storing the
Hardcover book id on note mappings (cross-device relink) are still open.
Related: [[hardcover-progress-edition-id-4792]] (never send book id as
edition_id), [[i18n-extract-prunes-keys]].
