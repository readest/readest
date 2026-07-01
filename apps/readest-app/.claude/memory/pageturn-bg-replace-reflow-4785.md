---
name: pageturn-bg-replace-reflow-4785
description: "Page-turn frame drops at chapter boundaries (#4785) — per-frame"
metadata: 
  node_type: memory
  type: project
  originSessionId: e42ea03e-cda7-4e59-b398-1a28f589b37e
---

Issue #4785: swipe page-turn animation drops frames, worst crossing .xhtml
section boundaries, "first open" (Android/Xiaomi). Repro book is a Taiwan light
novel with custom fonts + `.bg`/`background-attachment:fixed` front-matter.

Root cause (in `packages/foliate-js/paginator.js`, a submodule):
`#replaceBackground()` rebuilt its whole paint context **every frame** of both
swipe phases — `getComputedStyle(<html>)` + `this.size` + one
`getBoundingClientRect()` **per rendered view** + a per-view background-reset
write loop + full `#background` DOM rebuild. Those forced reads scale with the
number of loaded views, which **peaks at a chapter boundary** because adjacent
sections are preloaded there — hence "worst at boundaries". Two callers ran it
per-frame: the snap `syncBackground` rAF loop (`#scrollTo`) and the drag-phase
container `scroll` listener (`#onTouchMove`→`scrollBy`→scroll event).

Everything `#replaceBackground` reads is **invariant for one gesture** (theme/
texture, bg+container geometry, each view size+bg) — only scroll offset changes.

Fix:
- Split into `#readBackgroundStyle` / `#computePaginatedBgContext` (the reads) +
  `#paintPaginatedBackground(ctx, atPosition)` (writes only; calls the unchanged
  pure `computeBackgroundSegments`).
- `#bgAnimContext` field snapshots context once: set in `#onTouchStart` (drag)
  and at the start of the animated branch in `#scrollTo` (snap); cleared in
  `#onTouchEnd` and both animation `.then()`s. `#replaceBackground` uses
  `this.#bgAnimContext ?? this.#computePaginatedBgContext()`.
- Also deferred the heavy mid-drag forward preload: added `&& !this.#touchScrolled`
  to the scroll-listener `#loadAdjacentSection` gate (columnize/expand on the main
  thread janked the drag). The scroll that settles the gesture re-fires the gate
  with the finger up, so the buffer still tops up.

Tests: `src/__tests__/document/paginator-background-anim-perf.browser.test.ts`
(real Chromium) drives `next()` (snap) and a synthetic touch drag, spying on the
primary iframe `<html>` getComputedStyle. Pre-fix: 39 reads (snap) / 7 (drag);
post-fix ≤3 / ≤1. Existing `paginator-background-segments.test.ts` (pure
`computeBackgroundSegments`) stays green — visual output unchanged.

Scrolled-mode branch kept inline in `#replaceBackground` (never the per-frame hot
path). Behavior preserved: scrolled set every view bg so the old reset loop was
redundant; `containerSize = containerRect[sideProp]` == old `this.size`.

NOT the cause (ruled out): `computeBookNav`/`nav.json` is awaited before the view
renders, so first/second-open in-memory state is identical — it can't explain
reading-time swipe jank. See [[booknote-view-autoscroll-4352]] neighbors in
Paginator & Scroll. Related: [[paginator-swipe-bg-flash]],
[[global-annotation-pageturn-perf-4575]], [[paginated-texture-occlusion-4399]].
