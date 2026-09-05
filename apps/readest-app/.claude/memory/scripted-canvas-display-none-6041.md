---
name: scripted-canvas-display-none-6041
description: "#6041 IDPF trees sample - section scripts run while the paginator iframe is display:none so anything the book measures reads 0 (canvas 0x0, draws nothing); canvas also missing from setImageSize's clamp list"
metadata: 
  node_type: memory
  type: project
  originSessionId: 359f9861-6d54-442c-b0cb-cee9d38f3fa8
  modified: 2026-09-03T07:00:01.982Z
---

Issue #6041 (same reporter as #6038): the IDPF `trees` sample renders wrong on
every platform. Three complaints, two root causes, both in
`packages/foliate-js/paginator.js`.

**Cause 1 - section scripts measure a zero-sized document.** `View`'s iframe was
created with `display: none` and only flipped to `display: block` inside the
iframe's own `load` handler. A section's scripts run DURING the document load,
long before that handler, so they run against a `display:none` subtree, which
has no boxes at all. `trees` sizes its canvas backing store from the element:
`$canvas.attr("width", $canvas.width())`. Measured in the running reader:
canvas CSS box `256x128`, `canvas.width x canvas.height` = **`0x0`**. The book
then animated into a zero-sized bitmap, so nothing was ever drawn. This is NOT
canvas-specific - it hits any book that measures layout on DOM-ready.
FIX: hide with `visibility: hidden` instead (unpainted, but laid out). All three
later toggles move to visibility; the window in which the unpaginated document
is briefly visible (between reading direction/background and `render`) is
unchanged, because the old code already used `display: block` across that same
`await`.

**Cause 2 - oversized canvas paints over the next column.** `setImageSize`
clamps `img, svg, video` to the page box but NOT `canvas`. `trees` declares
`#canvas { width: 16em; height: 8em; border: 1px solid black }`, far wider than
a column, so the canvas and its border spilled over the column rule onto the
next column's text. FIX: add `canvas` to that selector -- but that alone was
NOT enough. The fill value is `max-width: 100%`, which caps the BORDER box, and
the element's own margins sit outside it. Measured at a 156px column: border box
clamped to 156, plus `margin: 1em` either side = a 188px margin box, i.e.
exactly 2em of overhang, which is what painted over the next column. The fill
value now subtracts the element's own inline margins (block margins in the
vertical-writing branch) so the MARGIN box is what fits. Not canvas-specific:
any `img` with margins sized to the column overhung too.

TRAP when measuring this: `getBoundingClientRect()` on an element fragmented
across columns returns the UNION box, so a `<p>` inside a 2-column `.mcol` reads
as the full strip width (328) rather than the real column (156). Take the column
from `getComputedStyle(documentElement).columnWidth` or from the clamped element
itself, never from a fragmented paragraph.

Both MERGED as readest/foliate-js#90 (squash f71a084, content byte-identical to
the tested tip 72430dd), pin bumped and MERGED as readest#6042 (squash
26a4bcaf0), submodule-only.

Chrome-verified at a 422px reader viewport: chapter canvas draws and no longer
overlaps the adjacent column; `titlepage.xhtml` canvas draws; Moby-Dick
paginates unchanged. Windows / Android / iOS NOT verified (no device here) -
the reporter's split (iOS chapter works, iOS titlepage does not, Windows and
Android neither) is consistent with cause 1 plus per-engine layout timing, but
that split was not reproduced.

Recipe note: `allowScript` is per book, under Settings -> 行为/Behavior ->
Security -> "Allow JavaScript", and the section must be RELOADED after
toggling it. Fastest route in a cramped viewport: `read_page` for refs, click
the "查看选项" button, then the "A" (font/layout) button, then 更多设置, then use
the settings search for "JavaScript" (searching the localized "脚本" finds
nothing - the label is `_('Allow JavaScript')`).

Related: [[srcdoc-html-parsing-namespaced-attrs-6038]], [[epub3-samples-idpf-480]]
(the 2026-08 sweep filed this sample as "canvas empty with scripting off =
expected" - it never re-checked with scripting ON, which is how cause 1 hid).
