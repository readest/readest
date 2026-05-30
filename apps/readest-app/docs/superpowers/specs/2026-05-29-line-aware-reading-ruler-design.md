# Line-Aware Reading Ruler — Design

**Date:** 2026-05-29
**Status:** Approved (pending spec review)

## Problem

The reading ruler is a band overlay that helps the user track lines while reading.
Tapping the screen advances the band forward/backward by exactly one ruler height
(`stepReadingRulerPosition` in `src/app/reader/utils/readingRuler.ts`), where the
ruler height is computed arithmetically as `lines × fontSize × lineHeight`.

That arithmetic height rarely matches the *actual* rendered line-to-line distance:
fonts, inline images, headings, ruby text, and CSS overrides all shift real line
positions. The error accumulates across taps, so text drifts out of the band's
center and the user must manually drag the ruler to recenter it — which makes the
feature tedious and undercuts its purpose.

The on-page-change auto-move (`ReadingRuler.tsx`, the `getFirstVisibleTextPosition`
effect) already aligns to the first visible line using real geometry, but
within-page taps do not.

## Goal

Make tap-advance **line-aware**: snap the band to the next group of `lines` *actual*
rendered lines, centered on that block, so text stays centered in the band without
manual adjustment. Drift is eliminated because every step is computed from real
line geometry rather than an accumulating arithmetic offset.

## Decisions (locked)

- **Sizing model:** Fixed band size — keep the configured band height; snap *position*
  to real lines rather than dynamically resizing per tap. A small constant padding is
  added to the rendered band so the centered lines are fully contained with breathing
  room.
- **Scope:** Reflowable horizontal **and** vertical writing mode. Fixed-layout
  (PDF/CBZ) and scrolled mode keep the current arithmetic stepping as fallback.
- **Geometry source:** Reuse `progress.range` (Approach A). `progress.range` already
  spans the entire first-to-last *visible* text (foliate `#getVisibleRange`,
  `packages/foliate-js/paginator.js`), and the existing auto-move already reads
  `progress.range.getClientRects()` mapped to container coords. Since a paginated page
  does not scroll, those rects are stable for every tap on that page.

## Snapping rule

The band advances by exactly `lines` *real* lines per tap and is centered on that
block's midpoint:

- **Forward:** find the first line whose start is at/after the current band's far edge
  (within a small epsilon). Take that line plus the next `lines − 1` lines to form a
  block `[blockStart, blockEnd]`. The new band center is `(blockStart + blockEnd) / 2`,
  clamped to the viewport.
- **Backward:** symmetric — find the `lines` lines ending just before the current
  band's near edge and center on their block midpoint.
- **No next group** (already at the last/first line group, or no line geometry):
  return `null`. The caller falls back to today's behavior — page flip on tap, or
  `stepReadingRulerPosition` where appropriate.

"Center on the block midpoint" guarantees that, regardless of how the configured band
height compares to the real line block, the lines sit centered with equal clipping on
either side in the worst case.

## Architecture

### Pure logic — `src/app/reader/utils/readingRuler.ts`

Two new pure functions (no DOM), unit-tested before implementation:

- `buildLineBoxes(rects, isVertical, rtl, containerRect): LineBox[]`
  - Input: plain rect-like objects (from `range.getClientRects()`), orientation flags,
    and the container rect for coordinate mapping.
  - Clusters per-fragment rects into visual lines by overlap on the cross axis
    (horizontal: cluster by vertical overlap → line tops/bottoms; vertical: cluster by
    horizontal overlap → column spans). Maps to the ruler axis in container coordinates,
    matching the existing auto-move mapping (`rect.top − containerRect.top` for
    horizontal; distance-from-edge for vertical-rl/lr).
  - Returns a sorted array of `{ start, end }` spans along the ruler axis.

- `snapReadingRulerToLines(currentCenterPx, dimension, lines, direction, lineBoxes): number | null`
  - Implements the snapping rule above. Returns the next band center in px, or `null`
    when there is no next group to advance to.

Existing `clampReadingRulerPosition`, `stepReadingRulerPosition`,
`getReadingRulerMoveDirection`, and `calculateReadingRulerSize` are unchanged and remain
the fallback path.

### Glue — `src/app/reader/components/ReadingRuler.tsx`

- Memoize line boxes per page: rebuild from `progress.range.getClientRects()` when the
  page (`progress.pageinfo.current`) / range changes or the container size changes.
- The page-change auto-move effect and the `reading-ruler-move` tap handler both:
  1. Compute the snap target via `snapReadingRulerToLines`.
  2. If it returns a value, animate the band to it (existing `setRulerPosition(_, true)`).
  3. If it returns `null`, fall back to the current logic
     (`stepReadingRulerPosition` / no-op so the page flip proceeds).
- Render the band at `rulerSize + READING_RULER_LINE_PADDING_PX` so centered lines are
  fully contained. The padding affects only the rendered band and its overlay/clamp
  math, not the line-advance computation.

### Fallback matrix

| Condition                              | Behavior                          |
| -------------------------------------- | --------------------------------- |
| Reflowable/vertical, line boxes found  | Line-aware snap                   |
| `progress.range` missing / no rects    | `stepReadingRulerPosition` (arith)|
| Scrolled mode                          | Existing behavior (unchanged)     |
| Fixed-layout (PDF/CBZ)                  | `stepReadingRulerPosition` (arith)|
| Snap returns `null` (at boundary)      | Page flip / no movement (as today)|

## Testing

Test-first, per project rule. Pure-function unit tests added to the existing
`src/__tests__/utils/readingRuler.test.ts`:

- `buildLineBoxes`: clusters multi-fragment rects into correct line spans; horizontal vs
  vertical-rl vs vertical-lr mapping; ignores zero-size rects; sorted output.
- `snapReadingRulerToLines`: forward/backward advance by exactly `lines`; centers on
  block midpoint; returns `null` at boundaries; respects clamping; degenerate inputs
  (empty `lineBoxes`, `lines` larger than available).

Then implement and verify with `pnpm test` and `pnpm lint`.

## Multi-column layouts (column-aware band)

In paginated layouts that render more than one column (`view.renderer.columnCount > 1`),
clustering visible lines by vertical position alone tangles the two columns once their
line grids drift apart (headings/images), causing the band to jump erratically.

For multi-column horizontal layouts the ruler is **column-aware and spans one column at
a time**:

- `buildReadingRulerColumns(rects, columnCount, overlayWidth, rtl)` groups the
  overlay-relative rects into columns by x (bucketed by `overlayWidth / columnCount`),
  then into line boxes within each column, returned in reading order.
- Rects are mapped to overlay coordinates with the iframe's frame offset
  (`frameRect.left/top`), because paginated multi-column pages shift the iframe far
  off-screen horizontally; vertical-only mapping is insufficient here.
- `snapReadingRulerColumns(columnIndex, centerPx, …, columns)` advances within the
  active column; at the column's end it moves to the first/last group of the
  next/previous column; past the last/first column it returns `null` → page flip.
- The band renders over the active column's horizontal extent; the rest of the page —
  **including the inactive column** — is dimmed (top/bottom/left/right dim rects).
- Single column collapses to the full-width band (one column spanning the viewport);
  vertical writing mode keeps the flat `buildLineBoxes`/`snapReadingRulerToLines` path.

## Non-goals / YAGNI

- No dynamic per-tap band resizing.
- No new foliate-js APIs or TreeWalker enumeration (Approach B) — reuse `progress.range`.
- No `caretPositionFromPoint` probing (Approach C).
- No changes to scrolled mode or fixed-layout ruler behavior beyond keeping them on the
  existing fallback path.
- No new user-facing settings.
