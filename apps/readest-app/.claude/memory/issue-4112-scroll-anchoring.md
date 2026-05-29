---
name: issue-4112-scroll-anchoring
description: "Root cause for readest#4112 scrolled-mode backward-nav bugs — scroll-anchoring suppressed at scrollTop 0 when prepending a section"
metadata: 
  node_type: memory
  type: project
  originSessionId: e0b11058-53ee-4554-a518-134f788823ee
---

readest/readest#4112 — two scrolled-mode bugs, ONE root cause.

**Root cause:** Browser scroll-anchoring (`overflow-anchor: auto`, paginator.js container) is **suppressed when scrollTop === 0**. The multiview paginator preloads the *previous* section by inserting its View element **above** the current one (`#loadAdjacentSection`, sorted insertion in `#createView`). When that prepend happens while `scrollTop === 0`, the inserted section pushes the current content down with no scroll compensation, so the viewport ends up showing the previous section.

**Bug 1 (TOC backward jump → lands on n-1):** Reproduce by navigating *one section back* (target N-1 is an already-loaded adjacent view → `#goTo` "view already loaded" branch, NOT `#display`). `scrollToAnchor(0)` lands at scrollTop 0 with target as topmost view; ~250ms later the **debounced** backward-preload (paginator.js ~line 977) inserts N-2... wait, inserts the section before the target, at scrollTop 0 → suppression → viewport drifts to target-1. Intermittent (~1/3–2/3) because it races `#fillVisibleArea`'s reanchor. `primaryIndex` stays = target but the *visible* top section = target-1.

**Bug 2 (can't scroll up / jumps to beginning of prev section):** same suppression — prev section inserted above at scrollTop≈0 shifts viewport to the *beginning* of prev instead of staying put. Backward-preload is debounced-only (forward preload is eager/immediate) → asymmetry adds lag.

**FIX (landed on foliate-js branch `fix/scrolled-prev-prepend-anchor`, 2 changes in `#loadAdjacentSection` + `#goTo`):**
1. Manual scroll compensation at the single prepend choke point `#loadAdjacentSection`: when prepending in scrolled mode (`index < sortedViews[0]`), after `await view.load()`, set `#renderedStart` to `startBefore + addedSize`. `containerPosition += (#vertical ? -1 : 1) * correction`; no-op (correction≈0) when the browser already anchored at scrollTop>0. Fixes drift (Bug 1) + scroll-up-shows-beginning (Bug 2b).
2. The already-loaded `#goTo` branch only preloaded prev for *short* sections (`contentPages < columnCount`); changed to `needsPrev || this.scrolled` (+ `#isSameDirection` guard), mirroring `#display`. Fixes can't-scroll-up (Bug 2a) — the debounced backward-preload bails while `#stabilizing` after nav, so nav must preload prev itself.

**UX follow-ups (same branch, same file):**
3. **No blank flash on adjacent nav**: the already-loaded `#goTo` branch faded the container `opacity 0→1`; in continuous scrolled mode that flashed (worse after change 2 put the prev-load inside the blank window). Now `blank = !this.scrolled || this.noContinuousScroll` — continuous scrolled scrolls straight to the (already-rendered) target. `loadPrev` helper: paginated loads prev BEFORE the scroll (fill leading columns), scrolled loads it AFTER (instant transition; compensation keeps position).
4. **Eager backward preload**: removed the debounced, one-viewport-gated backward preload; added an eager one in the immediate scroll listener mirroring forward (`pagesBehind < minPages`, scrolled-gated). Fixes "scroll up dead-ends at top until you nudge down". Safe now because change 1 compensation handles position stability (the old "debounced to avoid cascade" reason is obsolete).

**Verified live + tests.** Scrolled regression tests live in `paginator-scrolled.browser.test.ts` (split out of the old `paginator-multiview.browser.test.ts`, which was renamed to `paginator-paginated.browser.test.ts` for the default/paginated + CFI tests). The 4 #4112 tests: drift / prev-preload-after-nav / no-blank / eager-backward-within-a-few-viewports (+ the moved 'columnCount=1 in scrolled mode' and the #3987 toggle-off test). `pnpm test` (4921) + `pnpm lint` + `pnpm format:check` + 57 paginator browser tests green (4 files: scrolled, paginated, expand, stabilization).

**GOTCHA for live verification:** programmatic `el.scrollTop = N` does NOT fire 'scroll' events in the claude-in-chrome context (real wheel/touch does). To test scroll-driven preloading via the JS console, set scrollTop AND `el.dispatchEvent(new Event('scroll'))`. Also: the Next.js 16 dev server bundles foliate-js (transpilePackages); editing paginator.js hot-reloads, but verify the served chunk has your edit (fetch `_next/static/chunks/packages_foliate-js_paginator_*.js` and grep) — recompile can lag.

readest-app test change is uncommitted on `dev`; foliate-js fix on branch `fix/scrolled-prev-prepend-anchor` (uncommitted) → needs a PR to readest/foliate-js then a submodule bump.

**Verification harness:** localhost:3000/reader/<id> book "凡人修仙传" (2470 sections). Expose `__pg`/`__fv`, tag view elements with section index via `iframe.contentDocument` identity, measure `visibleTopSec()` vs target after settle. jsdom CANNOT reproduce (no real layout); use Chrome.

Key file: `packages/foliate-js/paginator.js` (submodule, fork readest/foliate-js).
