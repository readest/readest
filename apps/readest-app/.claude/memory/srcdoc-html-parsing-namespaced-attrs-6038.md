---
name: srcdoc-html-parsing-namespaced-attrs-6038
description: "#6038 The Swans image missing - sections load via iframe.srcdoc so every XHTML doc is HTML-parsed and epub:type loses its namespace, killing [epub|type] CSS selectors; fix = applyNamespacedAttributes"
metadata: 
  node_type: memory
  type: project
  originSessionId: 359f9861-6d54-442c-b0cb-cee9d38f3fa8
  modified: 2026-09-03T03:41:44.020Z
---

Issue #6038 (IDPF `childrens-media-query.epub`, "The Swans"): the swans
illustration, the flowers strip and the cream page colour never render. The
book paints all three from `div[epub|type="chapter"]` under
`@namespace epub "http://www.idpf.org/2007/ops"`.

**Root cause (verified in Chrome, not inferred):** `packages/foliate-js`
`paginator.js` `View.load` does `iframe.srcdoc = data` whenever
`section.loadContent()` returns content — a Readest fork change
(foliate-js `0561d06`, "More accessible iframes to improve compatibility with
browser extensions"; extensions cannot inject into `blob:` iframes). **`srcdoc`
is ALWAYS parsed as `text/html`.** Measured in the live reader:
`iframe.contentDocument.contentType === 'text/html'` and the chapter div's
`epub:type` attribute has `namespaceURI === null`. An HTML parser has no
namespaces outside foreign content, so `epub:type` stays one literal
null-namespace attribute name and EVERY CSS namespace selector silently
matches nothing.

Consequences, all of them pre-existing and mostly unnoticed:
- book CSS `div[epub|type="chapter"]`, `[epub|type="footnote"]` etc. are dead
- Readest's own `aside[epub|type~="endnote"|"footnote"|"note"|"rearnote"]`
  rules in `getPageLayoutStyles`/`getFixedlayoutStyles` were dead too; the
  live workaround is `footnoteTransformer` rewriting
  `<aside epub:type="footnote">` -> `class="epubtype-footnote"` (exact
  single-value, attribute-first regex only)
- the #4438 "keep `@namespace` leading the sheet" fix was therefore NOT what
  made those footnote rules work — the class did

**Fix MERGED as readest#6040 (squash 36d0fa2dd), 2026-09-03:** new
`applyNamespacedAttributes(doc)` in `src/utils/style.ts`, called FIRST inside
`docLoadHandler`'s `if (detail.doc)` in `FoliateViewer.tsx`. It reads the
`xmlns:*` declarations (which survive HTML parsing as ordinary attributes),
then for every `prefix:local` attribute whose prefix is declared adds a
`setAttributeNS(uri, name, value)` twin. The original attribute is kept and the
twin has the same qualified name, so `getAttribute('epub:type')` callers are
untouched. `docLoadHandler` runs from foliate's `afterLoad`, i.e. BEFORE
`getBackground(doc)` and before `render()`, so no re-layout or flash.
Tests: `src/__tests__/utils/style-dom.test.ts` `describe('applyNamespacedAttributes')`.

**Do NOT "fix" this by reverting srcdoc to `iframe.src = blobUrl`** — that
re-breaks browser-extension access, which the fork deliberately bought.

Verify recipe: serve the sample over a CORS `python3 http.server`, drop it into
`pnpm dev-web` via `fetch -> DataTransfer -> DragEvent('drop')` on
`.library-page`, then read the iframe through the OPEN shadow roots
(`foliate-view` -> `foliate-paginator`) and check
`getComputedStyle(chapterDiv).backgroundImage`. Note Chrome here routes
`127.0.0.1:8899` through a proxy that answers `ok`, yet the drop still worked.

**Second defect this uncovered — the layout never stabilizes on resize.**
Once the book's `div[epub|type="chapter"]` rules went live, resizing the window
put the reader in a permanent ping-pong: the iframe flipped 975 <-> 487 px every
~65 ms forever, and in scroll mode it froze the renderer outright (CDP
`Runtime.evaluate` timeouts). Mechanism, measured: `View.expand()` sizes the
iframe to the WHOLE multi-column strip (`pageCount * columnSize`), so
`@media (orientation: ...)` inside a section describes the strip, not a page —
487x632 reads portrait (`column-count: auto`, tall content, 2 pages) and 975x632
reads landscape (`column-count: 2`, short content, 1 page). The strip is derived
from the content and the content from the strip: no fixed point.
NOT caused by the namespace fix — PROVEN by removing the OPS attribute twin and
re-expressing the same rule as a plain `.probe-plain` class: identical loop, 43
flips in 3 s.

FAILED approach (do not retry): an oscillation damper in `View.expand()` that
locks onto the largest value of an A->B->A cycle. Even after only clearing the
lock when `render()`'s `layout` object actually changed, the renderer still
froze at a container width of 600px. The loop reaches `render()` by more paths
than the guard can see.

FIX THAT WORKS: resolve the feature at the source, in `transformStylesheet`
(`src/utils/style.ts`), exactly as the existing vw/vh rewrite does —
`(orientation: landscape|portrait)` becomes `(min-width: 0px)` when it matches
the reader's own viewport (`vw > vh`) and `(min-width: 999999px)` when it does
not. The content then no longer depends on the strip and the cycle cannot form.
VERIFIED stable at container widths 820/760/700/640/600/560/520/480/440 (600 and
760 froze the renderer before) and across repeated OS window resizes.
Width-based media queries were NOT theoretical after all: this sample's own
`@media (max-width: 480px)` block moves the content height through
`h1 { margin: 50% auto 0 0 }` and froze the renderer at narrow widths, so
`min/max-width` and `min/max-height` are resolved the same way (px only; other
units keep the authored feature). Both rewrites are confined to the media
prelude, and quoted values are parked first so an at-rule inside a declaration
value is never read as a prelude.

Related: [[epub3-samples-idpf-480]] (the sweep that marked this sample "fine"
— it compared text layout, never the background), [[annotator-overlay-z-layers]].
