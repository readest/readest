---
name: kosync-fb2-docfragment-xpointer-6896
description: KOSync FB2 positions landed KOReader on the cover (EPUB DocFragment XPointers); fixed in #6905
metadata:
  type: project
---

#6896 (filed 2026-10-18), MERGED #6905 (2d37bbfc2) on 2026-10-19: xcfi now maps FB2 both ways and push sites pass the book format.
Before it, Readest's `getXPointerFromCFI` (`src/utils/xcfi.ts`) always built
`/body/DocFragment[N]/body/...`. CREngine opens FB2 natively, with no DocFragments, and its XPointers look like
`/FictionBook/body[1]/section[3]/p[9]/text().322`. The DocFragment form is `isXPointerInDocument=false`,
and `getPageFromXPointer` returns 1, the cover. Reverse direction: `isXPointerProgress` only accepts `/body...`,
so KOReader's FB2 positions fall back to percentage.

**Why:** foliate splits FB2 into one HTML section per top-level `<section>` and renames tags (title→header,
title/p→h1, epigraph/cite/poem→blockquote, subtitle→h2, empty-line→br), so the path differs from CREngine's.

**How to apply:** FB2 positions are `/FictionBook/body[1]/<tag>[N]` counted per tag (image/title/epigraph/section), notes bodies `body[N]`.
The fix's oracle is `xpointer-oracle.lua` + `xcfi.crengine-oracle.test.ts`. Verify without a device: `~/Documents/books/issues/6896/fb2xp.lua` runs headless CREngine via the KOReader
emulator's `./luajit` (`~/dev/koreader/koreader-emulator-*/koreader`). The same recipe works for any
"KOReader can't resolve our XPointer" report. Related: [[kosync-percentage-reanchor-impossible-path-5980]].
