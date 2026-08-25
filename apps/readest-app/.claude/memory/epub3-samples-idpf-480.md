---
name: epub3-samples-idpf-480
description: "Issue #480 EPUB3 support - IDPF sample sweep on Chrome, 4 rendering fixes (inline MathML wrapper, math pre-wrap, epub:switch, bitmap spine viewport, SVG-spine font crash), calibre side-by-side, recipes"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5a2d4907-997f-4b75-9789-3616e81a93ab
  modified: 2026-08-25T15:14:44.044Z
---

Issue #480 (FR: Essential EPUB3 support) asks that the 42 IDPF EPUB 3 samples
(https://idpf.github.io/epub3-samples/30/samples.html, release 20230704) render
correctly. Swept all 42 in Chrome dev-web on 2026-08-25. PR readest/readest#5872 MERGED
2026-08-25 (07371ccce; worktree removed) + foliate PR readest/foliate-js#84 MERGED
as 7919107 (submodule pinned to it). CodeRabbit review: the epub:switch fast path
now accepts any XML-name prefix (`<epub-3:switch>`), not just `\w`. Reporter verify
pending (issue #480 was closed by the PR).

**Defects found and fixed (all Chrome-verified on the fixed build):**
- linear-algebra (MathML): every inline `<span><math/></span>` formula broke onto its
  own indented line. TWO causes: (1) `isDisplayMath` in `src/utils/scrollable.ts`
  (from #4400) treated a sole-child math as a display equation even inside an inline
  span and wrapped it in a block `div.scroll-wrapper`; now walks sole-child inline
  wrappers and only wraps when the chain fills a block container. (2)
  `pre, code, math { white-space: pre-wrap !important }` in `src/utils/style.ts`
  rendered the newlines/indentation of pretty-printed MathML as breaks/spaces and
  stacked `mtable` cells vertically; `math` dropped from that rule.
- hefty-water (`epub:switch`): DOMPurify's namespace check treats an HTML-namespace
  `switch` as an SVG-only tag and force-removes it WITH its subtree, so the XHTML
  `<default>` fallback vanished. New `epubSwitchTransformer`
  (`src/services/transformers/epubSwitch.ts`, name `epubSwitch`, listed FIRST in
  FoliateViewer's transformer array) resolves the first `case` whose
  `required-namespace` is XHTML/SVG/MathML, else `default`; XML-parse guarded by a
  `/<(?:\w+:)?switch[\s>]/` regex and a parsererror check; keeps the `<?xml?>` prolog.
- haruko-jpeg / page-blanche-bitmaps-in-spine (JPEG spine items): rendered as a
  300x150 stub. foliate `fixed-layout.js getViewport` took the browser image
  document's synthetic `<meta name=viewport content="width=device-width, minimum-scale=0.1">`
  at face value; now only a numeric width+height meta counts, else falls through to
  the image's natural size. `getViewport` is exported; test
  `src/__tests__/foliate-fxl-image-spine-viewport.test.ts`.
- sous-le-vent_svg-in-spine / svg-in-spine: `mountCustomFont`/`mountAdditionalFonts`
  threw `Cannot read properties of null (reading 'appendChild')` (SVG docs have no
  `<head>`); both now return early.

**Samples that already rendered fine** (no change): all wasteland variants incl.
obfuscated OTF/WOFF fonts, moby-dick(+mo), kusamakura (vertical-rl + ruby + bouten),
mymedia_lite, israelsailing + regime-anticancer-arabic (RTL, UI mirrors), mahabharata,
jlreq, georgia(-cfi: CFI page-list works, `13 / 758`), indexing (roman page list),
childrens-literature (span TOC headings), childrens-media-query, internallinks,
epub30-spec, accessible_epub_3, WCAG (multi-rendition: first rootfile), figure-gallery
/ quiz bindings (`<object>` fallback shows), cole-voyage-of-life(+tol) mixed FXL,
svg-in-spine, sous-le-vent, page-blanche, haruko-html-jpeg/ahl (p01 is
`page-spread-left`, so left-half placement is correct), trees (canvas empty with
scripting off = expected; nav letter-spacing is the book's own CSS), cc-shared-culture.
Known non-issues: `haruko-ahl` and `haruko-html-jpeg` share a partialMD5 (identical
sampled bytes) so only one can be in a library at a time.

**Calibre side-by-side (ebook-viewer 2026-08):** calibre CANNOT open haruko-jpeg,
page-blanche-bitmaps-in-spine, sous-le-vent_svg-in-spine (`tag_map` null) or
kusamakura at all, and does not implement epub:switch (shows CML text AND the
fallback). Where both render (linear-algebra IVLT, arabic, georgia, wasteland,
voyage-of-life) layouts match; calibre uses MathJax fonts vs Chromium native MathML.

**Recipes:** samples cached in the session scratchpad only (re-download via the
release URL pattern `https://github.com/IDPF/epub3-samples/releases/download/20230704/<name>.epub`).
Serve them with a tiny CORS python http.server and drop into dev-web via
fetch -> DataTransfer -> `DragEvent('drop')` on `.library-page`; book hash =
partialMD5 (python port: 1 KiB at offsets 1024<<(2i) with JS int32 shift semantics),
then open `/reader?ids=<hash>` directly. Jump inside a book with
`foliate-view.goTo(<spineIndex>)` (find the element through shadow roots; `goTo({index})`
is NOT a valid target). calibre: `/Applications/calibre.app/Contents/MacOS/ebook-viewer
--full-screen --open-at="toc:<label>" file.epub` + `screencapture -x` (computer-use MCP was
locked by another session); `search:` only opens the search panel. A full-screen
calibre window OCCLUDES Chrome, which then throttles the page and every chrome MCP call
times out ("script injection timed out") until calibre is killed.
