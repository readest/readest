---
name: opds-feed-cover-5270
description: "#5270 OPDS feed cover ignored at import; rel substring match trap; dev-mode proxy allows localhost so a local OPDS feed can be driven end to end"
metadata: 
  node_type: memory
  type: project
  originSessionId: a11c86f6-7e70-420b-b0f3-bfb1f3314391
  modified: 2026-08-03T17:41:43.218Z
---

**#5270 "readest doesn't use the covers / metadata provided by OPDS"** — cover half MERGED #5471 (2026-08-03, `11ae9e135`). **Metadata half MERGED #5477** (2026-08-04, `ffdcfca0a`). Issue fully resolved.

**Metadata half:** new `src/services/opds/metadata.ts` — `getOPDSBookMetadata(pub)` (pure map to `OPDSBookMetadata`, a `Partial<BookMetadata>` with `author` widened to `string | string[]` like MarkdownMetadata; emits only non-empty fields; description = typed content `SYMBOL.CONTENT || content` before plain `description`, through `getOPDSDescriptionHtml` since BookDetailView renders HTML) + `applyOPDSMetadata(book, m)` (per-field feed-wins merge, `normalizeMetadataIsbn`, re-derives title/author/primaryLanguage ONLY for feed-provided sources so "Download Again" can't reset a user-edited title via a silent feed, bumps `updatedAt`+`metadataUpdatedAt` — unlike coverUpdatedAt there's no upload-first hazard because metadata travels in the book row; never touches `sourceTitle`/`metaHash`). Wired in `page.tsx handleDownload` (add `publication` to the useCallback deps!) and autoDownload via `PendingItem.metadata` filled in `collectNewEntries` (map there — the Symbol-keyed content must not need to serialize). `OPDSPerson`/`OPDSSubject` had to become exported (tsgo TS4023 on the exported signature).

New `src/services/opds/cover.ts` holds both halves of the fix:
- `getOPDSCoverHref(pub)` — full `rel=".../image"`, then thumbnail, then any image.
- `applyOPDSCover({appService, book, coverUrl, username, password, customHeaders})` — reuses the book download's proxy/basic-auth/custom-header/`skipSslVerification` path, writes over `Books/<hash>/cover.png`, then refreshes `coverHash` + `coverImageUrl`. Best effort; failure keeps the extracted cover.

Wired after `importBook` in BOTH acquisition paths: `app/opds/page.tsx` `handleDownload` (before the cloud upload is queued) and `services/opds/autoDownload.ts` (href rides on the new `PendingItem.coverHref`, filled in `collectNewEntries`).

**The trap that made the pre-existing cover picker wrong:** `REL.COVER.some(rel => img.rel?.includes(rel))` is a *substring* test, and `http://opds-spec.org/image/thumbnail` CONTAINS `http://opds-spec.org/image`. An entry listing its thumbnail first had the thumbnail chosen as the full-size cover. Match exact rel tokens instead (`Array.isArray(rel) ? rel : (rel ?? '').split(/\s+/)`), like `opdsPublication.ts` already did. `PublicationCard`'s THUMBNAIL filter is safe by luck (the reverse containment does not hold).

**Cover sync fields:** set `coverHash` (the `coverHash === partialMD5(cover.png)` invariant, [[bug-patterns]] / #4544) but deliberately NOT `coverUpdatedAt` — matches what `importBook` itself does. Bumping `coverUpdatedAt` on an already-`uploadedAt` book would make peers fetch a cover the cloud does not have yet; `library/page.tsx handleUpdateMetadata` only bumps it after a successful `uploadBookCover`. New books propagate fine anyway: `needsCoverRefresh` returns true on `!local.coverDownloadedAt`.

**E2E trap (2026-08-04):** the local-feed verification failed twice NOT because of the code but because `next dev` served stale chunks — see [[turbopack-dev-stale-chunk-phantom]]: `rm -rf .next` before EVERY dev-server start. The stale runs doubled as the negative control (library showed the EPUB's "Alice's Adventures in Wonderland"; fresh chunks showed the feed's title). Dump the persisted record from the page via IndexedDB `AppFileSystem`/`files`, key `Readest/Books/library.json` — faster than driving the details UI.

**Verifying an OPDS change end to end locally (reusable):** `src/app/api/opds/proxy/route.ts` has `isPrivateHostAllowed = () => process.env.NODE_ENV === 'development'`, so under `pnpm dev-web` the SSRF guard lets `http://localhost:*` through and a throwaway Node OPDS feed server works. Recipe: serve an Atom acquisition feed + `sample-alice.epub` + a *deliberately different* cover PNG, then a throwaway spec in `e2e/tests` navigates `/opds?url=<encoded feed>`, clicks Download, and reads the library cover's byte length via `fetch(img.src)` in the page. OPDS cover 2738 B vs the EPUB's embedded 327217 B made it unambiguous, and disabling the wiring flipped the number, which is what proves the check discriminates. See [[settings-panel-screenshot-via-playwright]], [[web-e2e-local-devserver-cold-compile-flake]].

Known behavior change, flagged in the PR and not objected to: "Download Again" on a book you already own replaces a hand-edited cover with the catalog's.
