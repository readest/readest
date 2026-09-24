---
name: html-import-6198
description: "#6198 HTML (.html/.htm) import MERGED #6281 — Readability-cleaned, rendered like .md via the shared htmlBook builder; fixed the table-fit font race and the linked-image indent overhang on the way; CSS-variable images stay lost"
metadata: 
  node_type: memory
  type: project
  originSessionId: 14642481-059b-43ef-b527-ce013bc95023
  modified: 2026-09-18T16:10:37.970Z
---

Issue #6198 (import HTML saved by SingleFile). Built 2026-09-18/19, MERGED as
PR #6281 (four commits; CodeRabbit's four findings: RTL dir + duplicate ids
fixed, remote-image isolation and `:only-child` text siblings declined by
design). Not device-verified on native builds.

**Shape.** `src/utils/html.ts` (`makeHtmlBook`) → `sanitizeForParsing` → drop
`.sf-hidden` → lift headings out of short wrapper divs → Readability → fallback
to the whole body → `sanitizeHtml` → `src/utils/htmlBook.ts` (`buildHtmlBook`,
the section/TOC/XHTML/transform half moved out of `md.ts`, shared by both).
Format `HTML` in `BookFormat`/`EXTS`/`MIMETYPES`, `html`+`htm` in
`SUPPORTED_BOOK_EXTS`, folder-import group. Author is EMPTY on purpose:
Readability's byline picked Wikipedia's "Authority control" box.

**Traps found on the sample (Pamir Mountains).**
- Readability deletes `<div><h2>…</h2><span>[edit]</span></div>` (text < 25
  chars, heading density < 0.9): 13 of 15 headings vanished. Fix = lift the
  heading out of a DIV wrapper with < 25 chars of decoration and no media.
- Readability demotes every `h1` to `h2`, so an HTML book is one section; the
  TOC still comes from h2+.
- `<meta name="author">` and JSON-LD never reach Readability: `sanitizeForParsing`
  strips `<meta>`/`<script>`. Also breaks convertToEpub's meta byline fallback.
- SingleFile de-duplicates repeated images into `:root{--sf-img-N:url(data:…)}`
  and uses them as `background-image: var(--sf-img-N)` on `<span>`s (11 defs,
  64 uses here, mostly icons + location-map markers). Styles are stripped, so
  those are LOST and location-map labels ("PAMIR", "HINDU KUSH") become stray
  text. UNFIXED; reconstruct `<img>` from the vars if it ever matters.
- Section stylesheet lives in `htmlBook.ts` (`SECTION_STYLE`, was `MD_STYLE`).

**Table-fit font race (reader bug, FIXED here).** `decideTableFit` in
`src/utils/scrollable.ts` measured ONCE on the first ResizeObserver tick; with
`font-display: swap` the cells measure in the fallback font, the wrapper gets
`scroll-wrapper-fit` (overflow visible), then the real font widens the table
past the column: the peaks table spilled into the next column and the infobox
map (max-width 100% of its over-wide cell) painted a strip on the next page —
the user read it as "#6252 didn't take". #6252 only clamps bare images. Fix =
re-measure when `fonts.status` leaves `loading` (poll, never `fonts.ready`,
iOS<=16 #5654) and on each incomplete `<img>` load inside the wrapper. Verified
in Chrome: wrapper went FIT:650/663 → SCROLL:642/664 after reload.

**Image strip on the next page = paragraph indent, not width (FIXED here).**
The location map (`<p><span><a><img></a></span></p>`, 661px natural) is
clamped to the column by `max-width:100%` but the `<p>` carries the reader's
`text-indent` (2em = 32px), so the full-width inline image starts 32px in and
overhangs the column by the indent — a strip in the next page's margin. The
existing exemption `p:has(> img:only-child), p:has(> span:only-child > img:only-child)`
in `getParagraphLayoutStyles` (style.ts) never matched the linked-image shape;
added `p:has(> a:only-child > img:only-child)` and the span+a variant. Repro
recipe: host the reader in a same-origin `<iframe style=width:1300px>` written
via `document.write` on the LAN origin (window resize is ignored on this Mac),
then compare `img.getBoundingClientRect().right` with its `<p>`'s right.

**Why:** the next SingleFile/HTML report will hit the same three Readability
quirks, and the fit race can bite any EPUB whose table straddles the column.
**How to apply:** probe `wrapper.className` + `clientWidth/scrollWidth` through
the reader's shadow-DOM iframe before touching image CSS; a FIT wrapper wider
than its column is this race.
