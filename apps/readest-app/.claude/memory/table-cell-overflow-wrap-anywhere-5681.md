---
name: table-cell-overflow-wrap-anywhere-5681
description: "#5681 transcript table shredded its label column into a stack of letters: overflow-wrap:anywhere on td/th makes each cell's min-content one character, so auto table layout starves the short column (MERGED #5686)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2c7d5537-b6af-409d-bb71-006c1fc3f1df
  modified: 2026-08-13T16:26:53.519Z
---

`td, th { word-break: break-word; overflow-wrap: anywhere; }` in `getColorStyles()`
(`src/utils/style.ts`) collapsed the speaker column of a transcript table
("Angela:" / "Pip:" beside long prose) into a one-character sliver, so the label
rendered as `A / n / g / el / a:` (#5681, A Good Girl's Guide to Murder).

**Why:** `overflow-wrap: anywhere` — and its legacy alias `word-break: break-word`,
which per spec means `word-break: normal` + `overflow-wrap: anywhere` — counts
mid-word break opportunities when computing **min-content intrinsic size**. Auto
table layout distributes constrained width between each column's min and max
content; with min-content down to one character, the greedy prose column takes
everything and the label column is squeezed below its own word width.
`overflow-wrap: break-word` looks identical at render time but explicitly does
NOT affect intrinsic sizing — that difference is the whole fix. Measured in
Chromium: label cell 30px / 2 lines with `anywhere`, 42px / 1 line with
`break-word`; both `word-break: break-word` alone and `overflow-wrap: anywhere`
alone reproduce it.

**How to apply:** In EPUB CSS, never use `overflow-wrap: anywhere` (or
`word-break: break-word`) on table cells. `break-word` still breaks a long token
that overflows a fixed-width cell, and a table too wide for its column scrolls in
its `.scroll-wrapper` (#4391) — that wrapper, not word shredding, is how wide
tables have been contained since #4029. MERGED #5686 (`181ac99a8`) 2026-08-13; regression test in
`src/__tests__/document/paginator-table-layout.browser.test.ts` with fixture
`sample-table-transcript.epub` (asserts the label occupies one line box and the
cell is at least as wide as the unbroken word). Verified in Chrome against the
reported book.

Related: [[css-style-fixes]], [[paginator-scroll-fixes]].
