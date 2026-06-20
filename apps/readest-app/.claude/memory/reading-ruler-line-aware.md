---
name: reading-ruler-line-aware
description: "Line-aware/column-aware reading ruler — geometry pipeline, key files, and the Range.getClientRects block-box gotcha"
metadata: 
  node_type: memory
  type: project
  originSessionId: f55c9971-c85f-44af-82c3-822e3bbd1129
---

Reading ruler (`src/app/reader/components/ReadingRuler.tsx`, pure logic in
`src/app/reader/utils/readingRuler.ts`) snaps to real rendered text lines instead of
stepping by a fixed arithmetic height. MERGED to main via PR #4358 (squash); the
`feat/line-aware-reading-ruler` branch + worktree are gone. Spec/plan under
`apps/readest-app/docs/superpowers/`.

Geometry pipeline:
- Line geometry comes from `progress.range.getClientRects()` (the foliate relocate range
  spans first-to-last visible text). Single column + vertical mode → `buildLineBoxes` +
  `snapReadingRulerToLines` (full-width band). Multi-column horizontal → `buildReadingRulerColumns`
  + `snapReadingRulerColumns`, band spans one column, dims the rest incl. the other column.
- The snap functions return the real line-block extent `{start,end}`; the band is sized
  dynamically to that block + symmetric padding (`calculateReadingRulerPadding` =
  `round(fontSize*lineHeight*0.4)`) so padding is equal all around. `currentPosition` stays
  the band center % (drag/persistence); `bandSize` state holds the dynamic thickness, falling
  back to `baseRulerSize + 2*padding` for scrolled/fixed-layout/drag/unmeasured.
- Multi-column detection: `view.renderer.columnCount` (already on the `Renderer` type).
- Snapping works in scrolled mode too (`supportsLineSnap` no longer excludes scrolled).
  Single-column geometry goes through `buildVisibleLineBoxes` → frame-offset mapping, which
  is REQUIRED in scrolled mode (the visible section iframe is offset vertically by the scroll;
  there are several stacked section iframes, frame tops far negative). Auto-move stays disabled
  in scrolled mode (no jump on scroll); the band derives from the saved position on mount.
- GOTCHA: in scrolled mode `progress.range` (the relocate range) covers only PART of the
  viewport, so using it would make the band hit a false end mid-view and scroll early (skipping
  lines). Scrolled mode instead builds boxes from the visible section(s) directly
  (`buildScrolledLineBoxes`: walk `view.renderer.getContents()`, `selectNodeContents(body)`,
  frame-offset map, filter to viewport). At a view edge a tap sets `pendingScrollAlignRef`; the
  view scrolls and the next relocate realigns the band to the first (forward) / last (backward)
  group. `filterVisibleLineBoxes` (≥0.5 visible) keeps the mount/realign placement on-screen.
- GOTCHA: do NOT call `renderer.scrollBy()` yourself to advance the band in scrolled mode — a
  manual scroll that crosses a section boundary fires the relocate MID-relayout, so
  `getContents()` frame offsets are stale and `buildScrolledLineBoxes` returns garbage (huge
  blocks spanning gaps) → the band loops in place. Instead, when the next block can't be
  centered, return false so foliate page-scrolls (its relocate fires AFTER layout settles) and
  realign via `pendingScrollAlignRef`. Band is always centered on its block (no center clamp).
- Band height is capped at `calculateReadingRulerSize(lines + 1, …)` so a tall element (e.g. a
  full-page image) inside the snapped block can't expand the band to cover the whole image.
- **Coordinate mapping**: paginated multi-column pages shift the iframe far off-screen
  horizontally (`frameRect.left` was -4773 in testing); map iframe-content rects to overlay
  coords with the iframe `frameElement` offset (`mapRangeRectsToOverlay`), not just
  `rect.top - containerRect.top`.

**GOTCHA (caused a paragraph-skip bug):** `Range.getClientRects()` aggregates the border
boxes of every *fully-enclosed element*, so multi-line `<p>`/container blocks return rects
far taller than a text line (e.g. h=410 spanning a whole paragraph) alongside the line
rects. An overlap-based line merge chains those into one giant "line", making the snap skip
an entire paragraph — worse with more paragraphs per column. Fix: `dropBlockRects()` discards
rects whose cross-axis thickness > 1.8× the median line thickness before clustering.

**Vertical key mapping**: in vertical writing mode only Up/Down arrows move the ruler;
Left/Right turn pages (`isReadingRulerMoveKey(side, isVertical)` in `readingRuler.ts`, gating
`moveReadingRuler` in `useBookShortcuts.ts`). Taps always move the ruler regardless of the
tapped side (the restriction is keyboard-only; the tap path in `usePagination.ts` is untouched).

**Scrolled vertical-rl gotcha**: scrolled vertical scrolls HORIZONTALLY (section iframes stack
along x; all share top/bottom). `progress.range` covers only the left ~30% of the visible width,
so building boxes from it makes the edge realign land mid-view. `buildScrolledLineBoxes` is now
vertical-aware (horizontal frame-visibility filter `frame.right<=cont.left || frame.left>=cont.right`,
`buildLineBoxes(mapped, isVertical, …)`) and the scrolled edge-scroll path (`buildScrolledLineBoxes`
choice, centerable check) no longer excludes vertical (`scrolled = !!viewSettings.scrolled`, was
`&& !isVertical`). At the last column, advancing scrolls the view forward and snaps the band to the
first (rightmost) column; backward snaps to the last (leftmost). PAGINATED vertical already paged at
the boundary (snap returns null → handler returns false → keyboard `viewPagination` → `view.next()`;
auto-move effect places the band on the new page's first column).

Verified live with Chrome MCP by reconstructing the column pipeline in-page and dispatching
ArrowRight/ArrowLeft. Note: rapid synthetic key events in a tight loop get coalesced/throttled
by the reader's nav handling — drive one press per tool call with real time between. To inspect
logged objects (read_console_messages shows "Object"), monkey-patch console.log in-page to push
JSON.stringify'd args into a window array, then read that array.
