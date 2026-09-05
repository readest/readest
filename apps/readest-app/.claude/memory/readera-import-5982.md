---
name: readera-import-5982
description: ReadEra backup import (#5982) - format, XPointer body/body quirk, anchoring order, and what is NOT imported
metadata:
  type: project
---

PR #6032 MERGED 2026-09-02 as squash 8b8fbe14d (branch `feat/readera-import`, off 63fb3230e;
worktree removed). UNVERIFIED on a device: no real ReadEra-read file was ever imported. Per-book ReadEra import for issue #5982, built on the existing `ImportAnnotationsDialog`
(same row list as the Moon+ Reader `.mrexpt` import). Sample backup:
`~/Documents/books/issues/5982/ReadEra-Premium_2026-08-31_13.56.bak`.

**Scope the user chose (binding):** per-book in the reader; highlights + notes, bookmarks,
reading progress. Collections -> groups and status/rating were explicitly declined.

**Format.** The export is `ReadEra-<plan>_<date>_<time>.bak` (the picker takes `.bak`;
an earlier `.dat` guess was wrong), a plain zip holding `library.json` (+ `meta.json`,
`prefs.xml`, `search-history.xml`) and NO book files, so an import can only attach to books
already in Readest. Matching is title/filename/author (ReadEra keys on whole-file sha1/md5,
Readest on partialMD5 - the hashes never line up). `library.json` = `{docs, colls, words}`;
each doc has `data`, `citations` (highlights, note_type 3), `bookmarks` (note_type 2).
Deleted docs stay in the file with `doc_delete_time` - skip them. `note_data` is a
JSON *string*; `note_extra` is the user's note (only 225 of 2788 have one); `note_mark` 0-4
is a palette index whose order the backup does not record.

**The load-bearing quirk:** ReadEra XPointers keep the source document's own `body` inside
the fragment - `/body/DocFragment[N]/body/body/...` (460 of ~626 reflowable locators in the
sample), or `/body/DocFragment[N]/body/html/body/...` on older DOM versions (94). KOReader
XPointers have neither. `XCFI.resolveXPointerPath` consumes `^/body/DocFragment[N]/body` and
resolves the rest against `document.body`, so that extra level MUST be stripped or every
XPointer fallback misses. `autoBoxing` steps are synthetic CREngine boxes and must go too.
Both live in `normalizeReadEraXPointer` (`src/utils/readera.ts`).

**Anchoring order** (`src/services/annotation/providers/readera.ts`): whitespace-collapsed,
case-insensitive, cross-node text search of `note_body` inside the ReadEra-named section ->
normalized XPointer -> section start (the last one is what `unmatched` counts). Bookmarks skip
the text search, since their `note_body` is a user label ("Bookmark 1"), never an excerpt.
No cross-section rescan: the DocFragment/page index is trusted, per the
[[kosync-percentage-reanchor-impossible-path-5980]] rule that a spine index is calculated,
never estimated.

**Page-only locators.** The majority of `doc_position`s and 33 notes (all PDF bookmarks)
carry no `xPath` at all, only `page`/`ratio`/`pagesCount`. Those map to that page's section
ONLY when the book is paged (`!sections.some(s => s.cfi)`), where the page IS the section and
nothing is lost - such a note is NOT counted as `unmatched`. On a reflowable book the page
number is ReadEra's own pagination and says nothing about the spine, so the locator is
dropped rather than guessed ([[kosync-percentage-reanchor-impossible-path-5980]]).

**Two things that are easy to get wrong:**
- `XCFI` always emits `/6/{2(i+1)}!` from its own `adjustSpineIndex`, so its output has to be
  rebased onto the section's real `section.cfi`. PDF sections have no `cfi` at all, so
  `CFI.fake.fromIndex(index)` supplies the base there.
- PDF locators are `/page[N]/block/line/char@x:y` with a **0-based** page index (confirmed
  statistically against `ratio` x `pagesCount`), while `DocFragment[N]` is 1-based.

Reading position is adopted only when the book has no `config.location` of its own.
Note ids are `readera-${note_uri}`, so re-importing the same backup is a no-op.

Verified end-to-end in `src/__tests__/services/readera-import-real-book.test.ts`: a
ReadEra-shaped zip built in-test against `sample-alice.epub` AND `sample-alice.pdf`, whose
CFIs are resolved back to the text they should cover. Reverting the `body/body` strip fails 4
of the 8 EPUB tests; making the PDF page index 1-based fails both PDF tests. The PDF suite
needs the `pdfjsLib.GlobalWorkerOptions.workerSrc` setup from `pdf-cfi.test.ts`, and the PDF
`BookDoc` has NO `resolveCFI` - resolve by hand with `CFI.parse` + `CFI.fake.toIndex` +
`CFI.toRange`. The real 665 KB backup is the user's personal library and must never be
committed as a fixture. See also [[verify-lint-excludes-format-check]].

**CodeRabbit review (b9e682a2c).** Four fixes: (1) the Annotator's
`citations.length === 0 && bookmarks.length === 0` early return dropped a progress-only
document, so the empty-file toast now fires only when the CONVERSION yields neither notes nor
a location; (2) the location fallback guard now checks `xPath.startsWith('/body/DocFragment[')`
instead of any `xPath`, so a PDF `/page[N]/block/...` position still lands on its page;
(3) `findReadEraTextRange(doc, text, requireUnique)` returns null on a second occurrence, and
the note loop passes `Boolean(note.position?.xPath)` so an ambiguous phrase defers to the
XPointer while a locator-less note still takes the first hit; (4) the substring title match
now needs `min/max length >= 0.5` (`containsTitle`) - CodeRabbit asked for 0.8, but that
rejects "The Little Prince" vs "The Little Prince (Illustrated)" (0.59), which an existing
test covers, while 0.5 still rejects "Dune" vs "Dune Messiah" (0.33). Declined: caching the
flattened haystack (<5 notes per section) and hoisting the real-book conversion into
`beforeAll` (test isolation beats ~4 s).

**Matching by file md5 (b42365c4b).** Every `library.json` doc carries `doc_md5` AND `doc_sha1`
of the WHOLE file plus `doc_file_size`, and `uri` == `sha-1:<doc_sha1>` (1108/1118 live docs in
the sample; the 10 exceptions have neither hash - the only duplicate md5 IS that group).
`aliases` holds a `size:<bytes>-<mtime>-<device>` fallback key, which is what makes the uri a
content hash. Readest keys books by `partialMD5`, so the hashes never line up on their own:
`getReadEraFileMd5(book.hash, file)` computes `fullMD5` (js-md5 incremental, 4 MB chunks) of
`bookData.file` - the open book's File is already in memory - and caches the PROMISE per book
hash for the session, and it runs ONLY after `findReadEraDocForBook` comes back empty. This
also buys a strict title rule: containment now needs >= 12 chars of shorter title (so "Dune"
never matches "Dune 2" or "Dune Messiah") because a renamed file is caught by the md5 instead.
NOT verified against a real ReadEra-read file (no local book overlaps the sample library), but
a wrong guess only costs one hash and falls through to the title path.

The work was done in the shared `dev` tree, which also held an unrelated one-tap-highlight
edit to `Annotator.tsx`; the PR was split out by filtering that file's `git diff` down to the
ReadEra hunks and `git apply`ing it in a fresh `pnpm worktree:new` tree. Locale files could
NOT be copied across (the newer main had keys `dev` lacked): re-run `pnpm i18n:extract` in the
worktree, then fill each `__STRING_NOT_TRANSLATED__` from the old tree's file by key. Memory
files were left out of the PR, since the repo commits them separately (see d49fd8ba5).
