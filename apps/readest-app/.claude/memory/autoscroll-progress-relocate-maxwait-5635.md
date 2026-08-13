---
name: autoscroll-progress-relocate-maxwait-5635
description: "#5635 Auto Scroll progress frozen: scrolled-mode relocate is a 250ms trailing debounce that continuous scrolling starves forever; fix = 1s max-wait periodic relocate in paginator (foliate#72) + overlay value moved above the track (PR #5676)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 1aec6c50-37ee-4676-808b-53f90e8d0bd6
  modified: 2026-08-13T10:17:03.215Z
---

Issue #5635 (Auto Scroll bugs), items 2 and 3. Both MERGED 2026-08-13: foliate#72 (squash fd91451, tree identical to my 4c8bf79) and app PR readest#5676 (merge 124655e3a, submodule at fd91451). Worktree removed, shared submodule config re-inited.

**Root cause (item 2, progress frozen while auto-scrolling):** in `packages/foliate-js/paginator.js`, the scrolled-mode `relocate` (source of percentage/time-remaining via `#afterScroll('scroll')`) fires only from a 250ms trailing `debounce`. Auto Scroll (`PacedScroller`) steps `containerPosition` every frame, so the timer resets forever and progress only updates on pause.

**Fix shape:** track the unbroken run of scroll events in the container scroll listener (`scrollBurstStart` closure var); force `scrolledScrollRelocate()` at most once per `SCROLL_RELOCATE_MAX_WAIT` (1s) while the run lasts; the trailing debounce still reports the final position and resets the run. Guards mirror the debounced path (`#isAnimating`, `#stabilizing`, `#justAnchored`) and it skips `#touchScrolled` finger drags for the same frame-drop reason preloading does (readest#4785) — a long drag still reports on release only. Regression test: `paginator-scrolled.browser.test.ts` drives a 2.5s synthetic scroll burst and asserts >=2 mid-burst 'scroll' relocates (was 0). The `#justAnchored`-consumption nudge pattern (isolated scrolls with 350ms waits) is required before counting.

**Item 3:** `AutoScrollSpeedOverlay.tsx` and `BrightnessOverlay.tsx` capsules now render value label on TOP, track middle, icon at BOTTOM (finger covers anything under the slider). DOM-order test in `slider-overlays.test.tsx`.

**Coordination:** foliate#72 was squash-merged, so the app PR's submodule pointer was bumped from the PR-branch SHA to the squash SHA fd91451 (same dance as [[loaddocument-xhtml-parsererror-5625]]).

**Still open in #5635:** item 1, jittery/uneven scrolling feel vs Bookfusion — not addressed; needs the streamable videos + device profiling.

Related: [[worktree-submodule-origin-is-local-gitdir]] (push submodule via explicit `git@github.com:readest/foliate-js.git` URL from a worktree).
