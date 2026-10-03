---
name: opds-calibre-pubdate-vs-date-added-6003
description: "#6003 calibre OPDS imports the date ADDED as the publication date; atom:published outranks dc:date in foliate opds.js"
metadata:
  type: project
---

Issue #6003 (filed 2026-09-01). foliate-js#88 MERGED 2026-09-01 as squash commit
799ab10. readest#6008 (branch `fix/opds-calibre-pubdate`, worktree
/Users/chrox/dev/readest-fix-opds-calibre-pubdate) pins ca3f118..799ab10 and is
still OPEN, NOT device-verified. The bump also carries foliate-js#87 (paginator
drag page turn), which landed between the old pin and #88 and cannot be excluded
without diverging the pin from main; flagged in the PR body. Reported by u/sfgeekygir1 on
r/Calibre, not r/Readest — https://www.reddit.com/r/Calibre/comments/1w20i2y/

Books pulled from a **calibre** OPDS catalog get calibre's **"Date" column
(added-to-library)** as their publication date instead of **`pubdate`**. Wrong in
the OPDS browsing view *before* any download, and written into the library on
import, so sort-by-publication-date is wrong for every OPDS book.

**Root cause = two halves, and the fix ALREADY SHIPPED ONCE AND MISSED.**

`atom:published` means OPPOSITE things in the two calibre servers:
- calibre own server (`srv/opds.py` ACQUISITION_ENTRY): `<published>` = `mi.timestamp`
  = date ADDED; `<dcterms:date>` = `mi.pubdate`; emits NO `dcterms:issued`.
- Calibre-Web (`cps/templates/feed.xml`): `<published>` = `Books.pubdate` = the REAL
  one; emits no DC date at all.
=> any ordering MUST read the DC date ABOVE `atom:published` to satisfy both.
RFC 4287 agrees: `atom:published` is when the ENTRY hit the feed, not the book.

1. Parser, `packages/foliate-js/opds.js` `getPublication()`. Upstream was CORRECT
   (ad5ec4d 2023-12: `dcterms:issued ?? filterDC('date')`, no atom:published).
   Flipped four times in our fork:
   - foliate-js#10 (5b585f5, 2026-04-13) put `atom:published` FIRST. PR was about
     `id`/`updated` for subscription dedupe (#3844/#3837); the date change rode
     along and its summary calls it a "fallback" while the code made it outrank
     both DC sources. THIS is where the bug entered.
   - foliate-js#14 (f25de8a) re-aligned with upstream, dropping it.
   - 2204a28 (chrox, 2026-04-28 "opds: add id and updated fields") re-applied #10
     on the re-aligned tree, restoring atom:published first. Ships in v0.12.1.
   - foliate-js#66 (25ae018, 2026-08-17) targeted THIS EXACT BUG - its text even
     says "Calibre-based catalogs may use `<published>` for the date a book
     entered the catalog" - but hoisted only `dcterms:issued`, which calibre's
     own server NEVER emits, leaving `filterDC('date')` at the bottom. Ships in
     v0.12.6, so 0.12.6 does NOT fix it.
2. App: ffdcfca0a (#5477, for #5270, first release v0.12.1) made feed metadata beat
   the file. Before it the imported book kept the OPF date and the library was
   right; the parser bug was display-only. Note #5477's own commit message lists
   what it meant to carry - "title, author, publisher, language, subjects,
   identifier, description" - `published` is NOT in that list, and #5270 only
   asked for cover + title/author. The field that broke the report was never part
   of the requested change.

**Fix (shipped as foliate-js#88):** `dcterms:issued ?? filterDC('date') ?? atom:published`. `filterDC` covers
both `dc:date` and `dcterms:date`; safe for calibre, Calibre-Web (no DC date ->
falls through) and #66's catalog. foliate-js commit + submodule re-pin (see
[[epub-embedded-video-kotobee-1812]]).

**Why:** #5477 turned every foliate OPDS parsing quirk into a metadata-corruption
bug. Feed-wins-over-file means the parser's field precedence is now load-bearing,
not cosmetic. And a drive-by precedence change inside a PR about unrelated fields
survived four years of upstream correctness and one dedicated fix attempt.

**How to apply:** when an OPDS metadata field looks wrong, check `getPublication()`
in `packages/foliate-js/opds.js` FIRST - the Atom-vs-DC precedence there decides
what `applyOPDSMetadata` writes. Reproduce with a synthetic entry through
`getPublication()`; no calibre server needed. NEVER verify an OPDS field fix
against one server - calibre and Calibre-Web disagree on `atom:published`, which
is exactly how #66 shipped a fix that missed. readest#6008 adds the 5 precedence tests the parser NEVER had
(both calibre shapes + issued + Calibre-Web fallback + no-date). Already-imported books keep the bad value; a fix only helps new
downloads or "Download Again". See [[opds-fixes]].

**Worktree submodule gotcha (cost a force-push here):** in a `pnpm worktree:new`
tree, `packages/foliate-js`'s `origin` is the parent repo's LOCAL module store
(`/Users/chrox/dev/readest/.git/modules/packages/foliate-js`), not GitHub, and its
`origin/main` can be STALE - here it was 4 commits behind (2b6ea0a vs ca3f118), so
branching from it silently produced a branch that REVERTED #83/#84/#85/#86, and
`git push` pushed into the local store instead of GitHub. Always
`git remote add gh git@github.com:readest/foliate-js.git && git fetch gh main`,
branch from `gh/main`, and push to `gh`. foliate-js PRs are SQUASH-merged, so
after a merge the branch SHA is orphaned: re-fetch `gh main` and re-pin to the
squash commit, never to the pushed branch head. Check with
`git diff --submodule=log -- packages/foliate-js` before committing the bump: a
correct re-pin shows ONLY your commit with `>`, never any `<` lines.
