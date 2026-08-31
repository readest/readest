---
name: duplicate-book-calibre-uuid-5959
description: "#5959 updated AO3/calibre EPUB imports as a duplicate book because dc:identifier is a random uuid re-minted on every export"
metadata:
  type: project
---

Issue #5959 (filed 2026-08-30). Fix MERGED 2026-08-30 as #5961 (squash 053aba67f, 3 commits).
UNRELEASED and never device-verified: no build has imported the two real files end to end. Reddit report
https://www.reddit.com/r/readest/comments/1w1mmdn/not_updating_fic_with_new_epub_file/ (u/MandoSkirata);
both EPUBs archived at `/Users/chrox/Documents/books/issues/5959/{old,new}.epub` with a README.

Re-importing an updated EPUB of a book already in the library creates a SECOND entry instead of
merging. `importBook()` (`src/services/bookService.ts`) dedupes on `partialMD5` first (always
differs for an updated file, expected) then on `metaHash` = `md5("title|authors|identifiers")`
(`getMetadataHash()` in `src/utils/book.ts`). AO3 builds its EPUBs with calibre, and calibre mints
a FRESH random `dc:identifier opf:scheme="uuid"` on every export — the two repro files are
identical in title and creator and differ only in that uuid (`08bc8344-…` vs `d559a18b-…`) and the
calibre timestamp. So the metaHash differs and the merge never runs.

Worse: `getPreferredIdentifier()` ranks schemes `['uuid', 'calibre', 'isbn']` — the LEAST stable
identifier wins over the most stable one when a file carries several.

**Why:** any calibre-produced EPUB re-download (AO3, FanFicFare, calibre library exports) hits this,
so it is a whole class of "Readest won't update my book" reports, not one user's file.

**How to apply:** a fix has to make a bare random uuid non-identifying for metaHash (fall back to
`title|authors`, reorder preference to isbn/url first) WITHOUT over-merging distinct volumes that
share a title and author — `belongsTo.series` / `series_index` probably has to feed the hash.
Second commit fixes the other half of the thread: a download saved as `name.epub (1)` (marker AFTER
the extension) was dropped by every ingress whitelist because they all did `name.split('.').pop()`,
which reads the extension as `epub (1)`. Fixed with `getFileExtension`/`stripDuplicateMarker` in
`src/utils/path.ts` + `hasAllowedExtension` in `useFileSelector`, used by useFileSelector,
useAndroidFilePicker and useDragDropImport, plus marker stripping in `importBook` and the
DocumentLoader probes. Both mobile pickers now toast the skipped names (reusing the already
translated `Failed to import book(s): {{filenames}}`) instead of returning an empty selection that
the caller cannot tell from a cancel. NOTE the loader never cared: `isZip()` sniffs PK magic bytes.
Third commit answers the CodeRabbit review: a metaHash match re-keys the row to the new hash dir and
DELETES the old one, so the user's own cover art was lost and `existingBook.coverImageUrl` still
pointed into the deleted dir. Fix = copy `oldBookDir/cover.png` forward BEFORE the cover step (the
`!exists` guard then protects it), gated on `existingBook.coverUpdatedAt` — set by NOTHING but an
explicit cover edit, so it is the reliable "user chose this" signal. PRE-EXISTING for every metaHash
re-import, not new in this PR. Picker toast now names the rejected SUBSET (mixed picks were silent
about the dropped half) and is scoped to `type === 'books'` because the reused string
`Failed to import book(s): {{filenames}}` (translated in 34 locales) would misdescribe an audio or
dictionary pick; a neutral key would ship untranslated.

Still unfixed: no "replace the file of this book" action for an existing entry. See [[user-report-skill]].
