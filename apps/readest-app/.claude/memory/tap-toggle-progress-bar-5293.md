---
name: tap-toggle-progress-bar-5293
description: "#5293 tap-to-toggle footer restored as optionless ephemeral toggle, MERGED #5466; React onClick verify needs trusted clicks, not extension-dispatched MouseEvents"
metadata: 
  node_type: memory
  type: project
  originSessionId: add34f3b-a05d-4745-a0ea-a4ad715f67a0
  modified: 2026-08-03T13:42:45.781Z
---

#5293 (tap-to-toggle footer removed in 0.11.20 by #5029) fixed, MERGED #5466 (2026-08-03).

Design per maintainer: NO setting; active whenever showFooter is on. Tap hides/shows the ProgressBar info via local `useState` + `opacity-0` on `.progress-strip` — opacity keeps hit-testing, so the same spot restores it while invisible. Band reservation and `showFooter` are untouched (no reflow, never persisted, resets on book open/remount).

Tap-target split: the strip is `pointer-events-auto` only where it sits on reserved margin space (paginated band, sticky-bar band, vertical side column). Scrolled mode keeps the strip `pointer-events-none` and makes the floating pills the targets (`pointer-events-auto` in pillClass), preserving the #5029 fix that the strip never blocks taps/selection over bottom text.

**Why desktop clicks don't reach it:** FooterBar's 52px hover trigger strip (z-10, pointer-events-auto on ≥640px non-mobile) covers the band and reveals the toolbar on hover — the toggle is a touch-first feature by design. Android quirk: hidden PageNavigationButtons keep invisible 16px corner targets above the strip (pre-existing).

**Verification gotcha (React 19 + Chrome extension):** a `dispatchEvent(new MouseEvent('click', {bubbles:true}))` from the extension's isolated world bubbles all the way to `#document` but React's delegated onClick NEVER fires (0 invocations — verified by wrapping `__reactProps$` onClick). Calling the `__reactProps$*.onClick` directly works, and a real trusted click (computer tool `left_click`) works. Only trusted clicks exercise React handlers end-to-end; don't conclude a handler is broken from isolated-world synthetic dispatch.

Related: [[footer-pill-vs-blend-5342]], [[header-notch-negative-margin-5303]]
