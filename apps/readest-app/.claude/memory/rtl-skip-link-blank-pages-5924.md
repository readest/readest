---
name: rtl-skip-link-blank-pages-5924
description: "#5924 blank pages mid-chapter in RTL EPUBs: the a11y skip link's `left: 0` pinned the measured section width to the whole expanded iframe"
metadata:
  type: project
---

**#5924** (Persian EPUB, "blank pages in middle of the chapter"): 2-6 completely
blank pages inside a chapter. Reporter saw it on an Onyx Boox Go 7 but not a
Pixel; chrox reproduced it on desktop by **slightly resizing the window**.
**MERGED #5926** (squash `86493e801`, 2026-08-28); branch deleted local+remote,
`dev` fast-forwarded. Single file, no new tests at chrox's request. Reporter
verify pending; never device-tested on the Boox.

## Root cause

`src/utils/a11y.ts` injects `#readest-skip-link-last-pos` as
`position: absolute; left: 0; width/height: 1px`. **`left: 0` resolves against
the initial containing block — the iframe viewport, which foliate's paginator
has already expanded to hold every rendered column — NOT the single-column
`<html>` box** (`expand()` sets `documentElement.style.width = columnSize`).

In an **RTL** book columns flow right-to-left, so the iframe's left edge is
*past the end* of the text. `paginator.js expand()` sizes the section from
`#contentRange.getBoundingClientRect()` over the body contents, so the stray
1×1 box dragged `contentRect.left` to x=0 and `contentSize` came out **exactly
equal to the current iframe width** — a ratchet: the section can never shrink
below whatever width it was last expanded to.

Live measurements on the reporter's book (613px columns), `left:0` vs `left:auto`:

| elW | contentSize (left:0) | contentSize (left:auto) | pages |
| --- | --- | --- | --- |
| 4291 | 4291 | 3654 | 7 vs 6 |
| 5517 | 5517 | 1815 | **9 vs 3** |
| 3065 | 3065 | 2428 | 5 vs 4 |

`contentSize === elW` for *every* view is the ratchet's signature.

- **Why a relayout is needed:** the first layout happens while the iframe is
  still narrow, so x=0 is inside the content. The bug only bites on a later
  layout that needs *fewer* columns than the old iframe width.
- **Why RTL only:** in LTR the ICB's left edge is where the flow *starts*, so
  `left: 0` is always inside the content.
- **Why it reads as "middle of a chapter":** the phantom columns sit at the end
  of an XHTML *section*, and a TOC chapter spans several files.

## Fix

`left: 'auto'` — the out-of-flow box stays at its static position in the first
column. Same thing the sibling `#readest-skip-link-next-section` already does,
with the same hazard documented for #4126. Accessibility is untouched: the link
is still `body`'s first child, so NVDA's virtual cursor reaches it first.

## Rules

- **Never give an injected out-of-flow element a resolved `left`/`right` inside
  a columnized foliate section.** Its containing block is the expanded iframe,
  not the visible column, and `expand()` measures a Range over body contents —
  so any box outside the text extent invents blank pages.
- Repro probe: for each `renderer.shadowRoot #container` child, compare
  `elW` against `(rootRect.right - bodyRange.right) + bodyRange.width`. Equal
  for every view = something is pinning the measurement to the iframe.

Related: [[footnote-popup-content-size-5887]], [[resize-anchor-drift-5808]].
