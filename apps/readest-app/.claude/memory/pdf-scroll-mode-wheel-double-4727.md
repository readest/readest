---
name: pdf-scroll-mode-wheel-double-4727
description: Fixed-layout/PDF scrolled mode scrolls 2x (instant lurch) when wheeling over the page vs smooth over the margin
metadata: 
  node_type: memory
  type: project
  originSessionId: 063f5588-52bf-4042-92f9-babcf492e378
---

# PDF scrolled-mode wheel double-scroll (#4727)

**Symptom:** In fixed-layout/PDF **scrolled** mode, a mouse-wheel notch scrolls ~2× as far and feels instant when the pointer is **over the page** (the iframe), but a single smooth scroll when over the **page margin**. Reproduces on BOTH web and tauri (reporter saw it only in the WebView2 app, but maintainer reproduced on web too). Paginated mode unaffected.

**Root cause:** `fixed-layout.js` scroll mode (`#loadScrollPage`) attaches a `{ passive: true }` wheel listener to each page iframe's doc that called `this.scrollBy({ top: e.deltaY, behavior: 'instant' })`. The iframe is `scrolling="no"` + `overflow:hidden`, so the browser **already chains** the wheel to the host scroller natively (smooth). The manual `scrollBy` **stacks on top of** that native scroll → 2× distance, the instant jump = the `behavior:'instant'` part, the glide = the native chain. Margin-hover hits the host directly → only the single native scroll → no doubling.

The iframe is interactive (`pointer-events:auto`) only during a 150ms idle window after scrolling settles (`#handleScrollEvent` disables it during active scroll, re-enables 150ms after). A notched wheel slower than ~6/sec puts EVERY notch in that idle window → every notch lands on the iframe → every notch doubles (explains the steady "twice as fast", not just the first tick).

**Fix:** Delete the manual `this.scrollBy(...)`; keep `this.#setScrollIframeInteraction(false)` so the iframe stops intercepting and the rest of the gesture also scrolls the host natively. Native scroll-chaining is the single smooth scroll that matches the margin. The old "forward wheel to host" code wrongly assumed the tick was lost without it.

**Why not preventDefault+manual:** would make page-hover an *instant* scroll, not matching the smooth native margin scroll the user wants. Letting native handle it is the only way to match the margin feel.

**Reproduction / test technique (jsdom can't — needs real layout + real wheel):**
- Standalone Playwright proof: scroll container + `scrolling="no"` srcdoc iframe + the buggy handler, `page.mouse.wheel(0,120)` over the iframe → scrollTop 240 vs 120 over margin; remove `scrollBy` → 120 == 120. (real `mouse.wheel` triggers native chaining; synthetic dispatch does NOT.)
- Committed regression test `src/__tests__/document/fixed-layout-scroll-wheel.browser.test.ts` (browser lane, `pnpm test:browser`): mounts the REAL `<foliate-fxl>` in scrolled mode (minimal fake book: `rendition.viewport`, sections whose `load()` returns `{ src:'srcdoc', data: tallHtml }` — `src` must be truthy or `#createScrollFrame` returns blank; `data` → srcdoc keeps iframe same-origin so contentDocument is reachable), dispatches a **synthetic** `WheelEvent` on the page iframe doc (synthetic wheel doesn't chain natively, so any movement is the JS handler = must be 0). Fails `120` against the bug, passes fixed.

**CI flake + hardening (2026-07-07):** original assertion set `scrollTop=0`, dispatched, `await setTimeout(60)`, then `expect(scrollTop).toBe(0)` — flaked on slow CI runners with **`expected 4 to be +0`**. Root cause: as sibling scroll pages finish loading, `#loadScrollPage` runs `#restoreScrollModeAnchor` **asynchronously**, which at scrollTop=0/index-0 (fraction 0) snaps `scrollTop` to page 0's `offsetTop` = the **4px `--scroll-page-gap`** margin. The 60ms post-dispatch delay raced that re-anchoring → observed 4. NOT the bug (bug = 120px). **Fix:** the buggy `scrollBy({behavior:'instant'})` is *synchronous* (lands before `dispatchEvent()` returns), so measure `before=scrollTop` / dispatch / `after=scrollTop` with **NO await between** and assert `after===before`. Synchronous read isolates the handler's own effect; immune to the async anchor-restore. Verified: reintroducing the buggy scrollBy → `before=4, after=124` (delta 120, still caught); reverted → stable across repeated runs.

Fix lives in the `packages/foliate-js` submodule (separate repo/commit). Relates to [[fixed-layout-paginated-scroll-reset-4683]], [[webtoon-mode-3647]].
