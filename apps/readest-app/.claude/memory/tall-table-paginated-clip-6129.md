---
name: tall-table-paginated-clip-6129
description: "#6129 tables taller than a page were clipped in paginated mode; table max-height is a MINIMUM in Chromium/WebKit, clamp the scroll-wrapper instead (paginated only)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 4dc3c457-27eb-404b-bd8e-604359df5219
  modified: 2026-09-07T18:19:23.682Z
---

#6129 (Android 0.12.6, any platform): a table wider than the column AND taller
than a page showed only its first-page rows in paginated mode. Horizontal swipe
worked, the rest of the rows were unreachable; scrolled mode showed everything.

**Root cause.** #4415 wraps every `<table>` in `.scroll-wrapper { overflow:auto }`
and clamped height with `table { max-height: var(--available-height) }`. Both
Chromium (TablesNG) and WebKit (`RenderTable::layout`) treat a table's
`height`/`max-height` as a MINIMUM: the row total always wins. So the clamp was
dead, the wrapper grew to the full table height, and because a scroll container
is MONOLITHIC in CSS fragmentation it could not break across columns. It
overflowed the column and `documentElement { overflow:hidden }` clipped it.
Measured in the regression test: 1501px scroll box on a 604px page.

**Fix** (`src/utils/style.ts`, `getPageLayoutStyles`): move the clamp onto the
wrapper, gated to paginated mode via the body class `applyScrollModeClass`
already sets on every section load and flow toggle:
`body.paginated-mode .scroll-wrapper:not(.scroll-wrapper-fit) { max-height: calc(var(--available-height) * 1px) }`.
The wrapper becomes a page-sized 2D scroll box; `applyTableTouchScroll` already
consumes vertical swipes when `canScrollY`. A `-fit` wrapper stays
`overflow:visible`, so a tall table that FITS horizontally paginates row by row
(Chromium fragments table rows across columns; verified). Scrolled mode is
untouched (the var is set there too, hence the class gate, not `flow`).

**Why not paginate the wide+tall case?** CSS cannot do `overflow-x:auto` with
`overflow-y:visible` (visible coerces to auto), and per-axis overflow was
already ruled out in [[toc-table-heading-clip-4439]].

Test: `src/__tests__/document/paginator-tall-table.browser.test.ts` + fixture
`repro-6129-tall-table.epub` (wide+tall scrolls in place, narrow+tall paginates,
scrolled mode shows all). Also verified against the reporter's real book at
360x740 and 900x700 with a throwaway test (book is copyrighted, not committed).

**Chrome-verified in the real app** (dev-web on port 3010, reporter's book,
ch. 2 / spine idx 10). Live A/B on the same page by toggling the wrapper's
`max-height`: OFF -> wrapper 898px on a 688px page, `root.scrollHeight` 942 so
the section overflowed and `documentElement{overflow:hidden}` clipped it, and
`scrollHeight-clientHeight` was **0** so the lost rows were UNREACHABLE - the
report verbatim. ON -> wrapper 600px, no section overflow, 298px scrollable, and
scrolling the box brought the "Trust building" / "Decision rights" rows into view
while the page counter STAYED at 72/629. Wheel routing: both axes consumed by
the box, page does not turn (before the fix `canScrollY` was 0, which is exactly
why the reporter saw horizontal work and vertical do nothing). Gate matrix
confirmed live: non-fit+paginated `600px`, fit+paginated `none`, non-fit+
scroll-mode `none`. Swept 11 chapters / 41 wrappers: none taller than the page,
none with unreachable rows. Scrolled mode toggled through the real menu
round-trips correctly.

NOT device-verified on Android. Related: [[inline-block-column-overflow]] (same
monolithic-box clipping, different cause).
