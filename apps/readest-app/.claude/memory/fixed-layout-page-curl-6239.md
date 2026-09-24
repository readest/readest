---
name: fixed-layout-page-curl-6239
description: "#6239 Page Curl/Slide on PDF, CBZ and fixed-layout books — PR #6246 + foliate-js #98; what the gates were, what the pipeline did NOT need, and the pinch-strands-the-overlay bug"
metadata:
  type: project
---

Issue #6239 (FR: curl on PDF/CBR/etc). **MERGED** 2026-09-17: readest #6246 = `91eb09c35`, foliate-js #98 = `9f5736b` (readest main pins it). Worktree and branches removed. **NOT device-verified** — nobody has watched a PDF or CBZ curl on hardware; portrait single page and landscape spread both still want a look.

**Squash re-pin trap:** #98 merged as a *squash* (`9f5736b`), a different hash from my branch commit (`57ac047`), so the PR's pin pointed at a commit that deleting the merged branch would orphan. Always re-pin to the squash on main, never the branch commit, and check `git diff <main's pin> <new pin>` shows only your own change before pushing.

**One renderer covers all four formats.** PDF (`pdf.js`), CBZ/CBR (`comic-book.js`), fixed-layout EPUB (`epub.js`) and fixed-layout MOBI all set `rendition.layout = 'pre-paginated'`, and `view.js` gives every one of them `foliate-fxl` (`fixed-layout.js`). One fix, four formats.

**The pipeline needed nothing renderer-specific.** `CapturedTurnHost` is pure DOM + platform callbacks, and `fixed-layout.js`'s `next()`/`prev()` are *already* the instant, awaitable jump the overlay hides (no `animated` attribute, no `turn-style`, no `no-swipe` — it ignores all three). Only two gates blocked it:
- `getCapturedTurnStyle()` (`useCapturedTurn.ts`) bailed on `isFixedLayout`
- `isLayeredTurnCandidate()` (`useIframeEvents.ts`) did the same

Replaced by one panning guard, `zoomLevel > 100 || zoomMode !== 'fit-page'` — the same predicate as `usePagination`'s `isPanningView`, because there a horizontal drag pans instead of turning. Default `zoomMode` is `fit-page` (`constants.ts:397`), so the curl works out of the box.

**Already anticipated:** the captured-turn touch interceptor sits at priority **5**, commented *"Above the fixed-layout swipe-flip (0), below the reading ruler (10)"*. No priority work needed — it consumes first, `swipe-flip` handles what it declines.

**The bug this exposed:** a fixed-layout book pinch-zooms, so a second finger takes the **pinch branch** in `onTouchStart`, not `latchReflowableMultiTouch` (which hard-returns false for FXL). That branch never dispatched a `cancel` detail, so a captured drag the first finger had claimed sat **frozen over the page** until the next touchstart. Extracted `cancelClaimedSingleTouch()` and called it from both branches. Whenever a new surface joins the touch-interceptor chain, check every early-return in `onTouchStart`/`onTouchMove` for an un-cancelled claim.

**Spreads:** foliate-js#98 adds `computeSpreadColumnCount` + `get columnCount()`. 2 only for a real two-page spread; 1 for centred / portrait / blank-padded / not-yet-laid-out / scroll mode — deliberately the same notion of "spread" as `computeSpreadSpineOverlap`, and a test asserts the two agree. The #6106 leaf hinges at `rect.width/2`, which **is** the real gutter here: `computeSpreadInlineMargins` pushes both pages against the spine and centres the pair. Answers finding #4 in [[two-column-spine-curl-6107]].

**Deliberately out of scope:** web/desktop non-Tauri (the View Transition turns are ~1000 lines inside `paginator.js` only — porting to `fixed-layout.js` is a separate job); fit-width/zoomed PDFs; the leaf's back still shows the incoming page on iOS only. Also: `atEnd`/`atStart` are spread-index based, so the last portrait half-page turn falls back to an un-animated jump.

Tests: `fixed-layout-spread-column-count.test.ts` (new), plus cases in `useCapturedTurn.test.ts` and `useTouchEvent.test.tsx`. `pnpm test` 11128 · `pnpm test:browser` 480 · lint clean. The `dialog-close-frames.browser.test.tsx` failure seen once is **flaky**, unrelated. See [[annotator-overlay-z-layers]], [[pdf-lock-horizontal-pan-5976]].
