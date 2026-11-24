---
name: pdf-text-layer-br-stacking-7563
description: "Chrome stacks pdf.js text-layer <br>s down the page's left edge; margin drags and popup/handle placement went wrong. Fixed by wrapping each <br> at its line end (foliate#167, readest #7563 MERGED)"
metadata:
  node_type: memory
  type: project
  originSessionId: 5cd95af0-5f4f-42e3-88fe-04e4beb6ff0f
  modified: 2026-11-16T13:55:22.539Z
---

pdf.js ends every printed line with a `<br>`. Blink ignores `position` on `<br>`, so in the text layer (all spans absolute) the `<br>`s are the only in-flow content: they stack down the layer's left edge, 16px apart, whichever line they end. A mouse press in the left margin resolves to one of them (unrelated DOM spot), and any multi-line range gets a zero-width rect at x=0 that `getPosition`/`getHandlePositionsFromRange` anchor the popup and handles to (both use the first rect).

Fix (2026-11-16): foliate-js `placeLineBreaks` wraps each `<br>` in an absolute `span.endOfLine` at the line end after render (readest/foliate-js#167). Readest `splitRows` (pdfText.ts) reads the `<br>` inside the wrapper. Do NOT hide the `<br>`s: `display:none` drops the newlines from `Selection.toString()`.

**Why:** found while reviewing #7505; on main too. #7505 had maintainer edits off, so it was closed and recreated as #7563 (contributor commits kept) and merged as ca575bb68.

**How to apply:**
- Headless Chromium can't reproduce the margin press: blank presses resolve to the page start before and after the fix, and CDP drags from blank page area never extend. Test the rects instead (`pdf-selection-hit-test.browser.test.ts`) and check the press live on dev-web.
- PDF page iframes have `transform: none` at rest (onZoom path); only fixed-layout EPUB pages and a live pinch are CSS-scaled.
- Pinned foliate commit e8fde46 sits on foliate#153's head (branch `fix/pdf-line-break-position`, keep it); move the pin to foliate main once #153 merges.
- CodeRabbit kept finding siblings: fix every clear path / every coordinate site at once, not just the one named. See [[feedback-pr-watch-fix-conflicts]].
