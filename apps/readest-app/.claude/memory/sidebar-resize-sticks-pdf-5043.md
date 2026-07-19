---
name: sidebar-resize-sticks-pdf-5043
description: "#5043 sidebar resize handle sticks to cursor over PDF; fixed-layout iframe pointer-events:auto defeats body pointer-events:none drag trick; fix = shield overlay in useDrag"
metadata: 
  node_type: memory
  type: project
  originSessionId: 552e8d48-49e4-4eb9-a8e2-89b5042bb9cf
---

#5043 (MERGED #5198): dragging the reader side panel's resize handle "sticks to the cursor" / "resizes only to the left side" and never stops until the book is closed. Reproduces with **PDF (fixed-layout) in auto spread / scrolled mode**, NOT with reflowable EPUB.

**Root cause:** `src/hooks/useDrag.ts` (used by `usePanelResize` → SideBar `.drag-bar`) attached `mousemove`/`mouseup` to `window` and relied on `document.body.style.pointerEvents = 'none'` so a `mouseup` released over the book iframe would pass through to `window`. But foliate-js `packages/foliate-js/fixed-layout.js` sets inline `pointer-events: auto` on visible PDF page frames/iframes (lines ~661 wrapper, ~791/933 scroll iframe). Inline `auto` overrides the *inherited* `none` from body, so a `mouseup` over a PDF page lands inside the iframe's own document and never reaches the window listener → `handleEnd` never runs → `isDragging` stays true, listeners never removed, `body.pointerEvents` stuck `'none'`. Reflowable `paginator.js` iframes have no inline override → they inherit `none` → work fine.

**Fix:** in `handleDragStart`, drop the body-pointer-events trick and instead append a transparent top-most **shield** div (`position:fixed; inset:0; z-index:2147483647; pointer-events:auto; cursor`) to `document.body`; remove it in `handleEnd`. The shield sits above every iframe, so all pointer events hit it and bubble to `window`, ending the drag reliably. Touch already worked (implicit touch capture keeps events on the handle) so this is really a mouse-only fix; shield is harmless for touch.

**Verified live in Chrome** (dev-web + real PDF auto spread): the iframes live inside `<foliate-view>` nested shadow DOM (`document.querySelectorAll('iframe')` finds 0 at top level — pierce shadow roots). `document.elementFromPoint` over a PDF page returns the shadow host; use a shadow-piercing deep hit-test. Proof: over a PDF point, `body{pointer-events:none}` STILL hit-tests to `IFRAME[computedPE=auto]` (old trick fails), while the shield hit-tests to the shield DIV and a mouseup on it reaches window. Behavioral repro with a real drag: buggy build → `mouseup@680` never logged on window + a no-button hover then still resized the panel (`stuck_changedWithNoButton:true`); fixed build → `mouseup@680` reached window, shield removed, post-release hover did not resize.

Chrome coord gotcha: screenshot px ≠ CSS px. Window was innerWidth 1280 / DPR 2 but screenshot 1511 wide → computer-use coords are screenshot-space, mapped to CSS by ~0.847; convert (CSS = screenshot*0.847) or the mousedown misses the ~8px-wide `.drag-bar`.

Test: `src/__tests__/hooks/useDrag.test.tsx` asserts the shield is created during drag (fails without fix) and removed on release. Related: [[foliate-touch-listener-capture-phase]] [[iframe-cross-realm-instanceof]] [[pdf-swipe-pan-toggles-menu-5142]] [[pdf-scroll-mode-wheel-double-4727]] (same fixed-layout iframe pointer-events toggling).
