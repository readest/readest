# Line-Aware Reading Ruler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the reading ruler snap to the next group of *actual* rendered text lines on each tap/page-change so lines stay centered in the band, eliminating the drift caused by the current arithmetic step.

**Architecture:** Two new pure functions in `src/app/reader/utils/readingRuler.ts` derive line boxes from `progress.range.getClientRects()` and compute a snapped band center. `ReadingRuler.tsx` caches the line boxes per page and calls the snap function from both the tap handler and the page-change auto-move, falling back to the existing arithmetic step when line geometry is unavailable (scrolled mode, fixed-layout, missing range).

**Tech Stack:** TypeScript, React, Vitest, foliate-js paginator (`progress.range`).

**Design spec:** `docs/superpowers/specs/2026-05-29-line-aware-reading-ruler-design.md`

---

## File Structure

- `src/app/reader/utils/readingRuler.ts` (modify) — add `ReadingRulerLineBox` type, `READING_RULER_LINE_PADDING_PX`, `buildLineBoxes`, `snapReadingRulerToLines`. Pure, no DOM.
- `src/__tests__/utils/readingRuler.test.ts` (modify) — unit tests for the two new functions.
- `src/app/reader/components/ReadingRuler.tsx` (modify) — glue: padded band size, per-page line-box cache, snap in tap handler + page-change auto-move, fallbacks.

---

## Task 1: `ReadingRulerLineBox` type, padding constant, and `buildLineBoxes`

**Files:**
- Modify: `src/app/reader/utils/readingRuler.ts`
- Test: `src/__tests__/utils/readingRuler.test.ts`

`buildLineBoxes` converts per-fragment client rects (from `range.getClientRects()`) into sorted visual-line spans along the ruler axis, in container coordinates. It clusters fragments that belong to the same visual line (high overlap on the ruler axis) and maps coordinates exactly as the existing auto-move does:
- horizontal: span = `[rect.top - containerRect.top, rect.bottom - containerRect.top]`
- vertical-rl (`rtl=true`): span = `[containerRect.right - rect.right, containerRect.right - rect.left]`
- vertical-lr (`rtl=false`): span = `[rect.left - containerRect.left, rect.right - containerRect.left]`

- [ ] **Step 1: Write the failing tests**

Add these imports and tests to `src/__tests__/utils/readingRuler.test.ts`. Update the existing top import block to also import the new symbols:

```typescript
import {
  buildLineBoxes,
  calculateReadingRulerSize,
  clampReadingRulerPosition,
  FIXED_LAYOUT_READING_RULER_LINE_HEIGHT,
  getReadingRulerMoveDirection,
  READING_RULER_LINE_PADDING_PX,
  snapReadingRulerToLines,
  stepReadingRulerPosition,
} from '@/app/reader/utils/readingRuler';
```

Then add a new `describe` block at the end of the file:

```typescript
type RectLike = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
};

const rect = (top: number, left: number, height: number, width: number): RectLike => ({
  top,
  left,
  bottom: top + height,
  right: left + width,
  height,
  width,
});

const container = { top: 0, left: 0, right: 300, bottom: 400 };

describe('buildLineBoxes', () => {
  it('clusters horizontal fragments into one box per visual line', () => {
    const rects = [
      rect(0, 10, 16, 50), // line 1, fragment A
      rect(0, 60, 16, 40), // line 1, fragment B (same vertical band)
      rect(20, 10, 16, 80), // line 2
    ];
    expect(buildLineBoxes(rects, false, false, container)).toEqual([
      { start: 0, end: 16 },
      { start: 20, end: 36 },
    ]);
  });

  it('ignores zero-size rects', () => {
    const rects = [rect(0, 10, 16, 50), rect(20, 0, 0, 0), rect(40, 10, 16, 50)];
    expect(buildLineBoxes(rects, false, false, container)).toEqual([
      { start: 0, end: 16 },
      { start: 40, end: 56 },
    ]);
  });

  it('returns sorted boxes even when rects are out of order', () => {
    const rects = [rect(40, 10, 16, 50), rect(0, 10, 16, 50), rect(20, 10, 16, 50)];
    expect(buildLineBoxes(rects, false, false, container).map((b) => b.start)).toEqual([0, 20, 40]);
  });

  it('maps vertical-rl columns as distance from the right edge', () => {
    // container.right = 300; a column at left=260,right=276 -> [300-276, 300-260] = [24, 40]
    const rects = [rect(0, 260, 200, 16)];
    expect(buildLineBoxes(rects, true, true, container)).toEqual([{ start: 24, end: 40 }]);
  });

  it('maps vertical-lr columns as distance from the left edge', () => {
    const rects = [rect(0, 24, 200, 16)];
    expect(buildLineBoxes(rects, true, false, container)).toEqual([{ start: 24, end: 40 }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/__tests__/utils/readingRuler.test.ts`
Expected: FAIL — `buildLineBoxes`, `READING_RULER_LINE_PADDING_PX`, `snapReadingRulerToLines` are not exported (also a build/type error on the import).

- [ ] **Step 3: Implement the type, constant, and `buildLineBoxes`**

In `src/app/reader/utils/readingRuler.ts`, add below the existing `FIXED_LAYOUT_READING_RULER_LINE_HEIGHT` constant (line 3):

```typescript
// Extra band height (px) added so the centered lines clear the band edges.
export const READING_RULER_LINE_PADDING_PX = 6;

export interface ReadingRulerLineBox {
  start: number;
  end: number;
}

type RulerRect = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
};

type RulerContainerRect = { top: number; left: number; right: number };

/**
 * Convert per-fragment client rects into sorted visual-line spans along the
 * ruler axis, in container coordinates. Fragments that overlap by more than
 * half of the smaller fragment on the ruler axis are treated as one line.
 */
export const buildLineBoxes = (
  rects: RulerRect[],
  isVertical: boolean,
  rtl: boolean,
  containerRect: RulerContainerRect,
): ReadingRulerLineBox[] => {
  const spans: ReadingRulerLineBox[] = [];
  for (const r of rects) {
    if (!r || r.width <= 0 || r.height <= 0) continue;
    let start: number;
    let end: number;
    if (isVertical) {
      if (rtl) {
        start = containerRect.right - r.right;
        end = containerRect.right - r.left;
      } else {
        start = r.left - containerRect.left;
        end = r.right - containerRect.left;
      }
    } else {
      start = r.top - containerRect.top;
      end = r.bottom - containerRect.top;
    }
    if (end < start) [start, end] = [end, start];
    spans.push({ start, end });
  }

  spans.sort((a, b) => a.start - b.start || a.end - b.end);

  const lines: ReadingRulerLineBox[] = [];
  for (const span of spans) {
    const current = lines[lines.length - 1];
    if (current) {
      const overlap = Math.min(current.end, span.end) - Math.max(current.start, span.start);
      const minHeight = Math.min(current.end - current.start, span.end - span.start);
      if (overlap > 0.5 * minHeight) {
        current.start = Math.min(current.start, span.start);
        current.end = Math.max(current.end, span.end);
        continue;
      }
    }
    lines.push({ start: span.start, end: span.end });
  }

  return lines;
};
```

- [ ] **Step 4: Run tests to verify the `buildLineBoxes` tests pass**

Run: `pnpm test src/__tests__/utils/readingRuler.test.ts`
Expected: the `buildLineBoxes` describe block PASSES. (The `snapReadingRulerToLines` import still makes the file fail to compile — that's fixed in Task 2. If the runner refuses to run due to the missing export, temporarily comment out the `snapReadingRulerToLines` import line to confirm, then restore it.)

- [ ] **Step 5: Commit**

```bash
git add apps/readest-app/src/app/reader/utils/readingRuler.ts apps/readest-app/src/__tests__/utils/readingRuler.test.ts
git commit -m "feat(ruler): add buildLineBoxes for line-aware ruler geometry"
```

---

## Task 2: `snapReadingRulerToLines`

**Files:**
- Modify: `src/app/reader/utils/readingRuler.ts`
- Test: `src/__tests__/utils/readingRuler.test.ts`

Given the current band center, viewport dimension, padded band size, line count, direction, and the line boxes, return the next band center (px) centered on the next `lines`-line block — or `null` when there is no next group (caller falls back to a page flip).

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/utils/readingRuler.test.ts`:

```typescript
describe('snapReadingRulerToLines', () => {
  // 10 lines, each 16px tall, 20px apart, starting at 0.
  const evenBoxes = [0, 20, 40, 60, 80, 100, 120, 140, 160, 180].map((s) => ({
    start: s,
    end: s + 16,
  }));

  it('returns null when there are no line boxes', () => {
    expect(snapReadingRulerToLines(100, 400, 40, 2, 'forward', [])).toBeNull();
  });

  it('advances forward to the next block of N lines, centered on the block', () => {
    // band center 20 -> band [0,40]; next group starts at line index 2 (start 40),
    // block = lines[2..3] => [40, 76], center = 58.
    expect(snapReadingRulerToLines(20, 400, 40, 2, 'forward', evenBoxes)).toBe(58);
  });

  it('moves backward to the previous block of N lines, centered on the block', () => {
    const boxes = [40, 60, 80, 100, 120, 140, 160, 180, 200, 220].map((s) => ({
      start: s,
      end: s + 16,
    }));
    // band center 200 -> band [180,220]; last line fully above is index 6 (end 176),
    // block = lines[5..6] => [140, 176], center = 158.
    expect(snapReadingRulerToLines(200, 400, 40, 2, 'backward', boxes)).toBe(158);
  });

  it('returns null at the bottom boundary so the page can flip', () => {
    const boxes = [
      { start: 0, end: 16 },
      { start: 20, end: 36 },
    ];
    // band center 100 -> band [80,120]; no line starts below -> null.
    expect(snapReadingRulerToLines(100, 200, 40, 2, 'forward', boxes)).toBeNull();
  });

  it('returns null at the top boundary so the page can flip', () => {
    const boxes = [
      { start: 80, end: 96 },
      { start: 100, end: 116 },
    ];
    // band center 100 -> band [80,120]; no line ends above -> null.
    expect(snapReadingRulerToLines(100, 200, 40, 2, 'backward', boxes)).toBeNull();
  });

  it('clamps the snapped center so the band stays inside the viewport', () => {
    const boxes = [{ start: 180, end: 196 }];
    // forward target block center = 188, but dimension 200 / size 40 clamps to 180.
    expect(snapReadingRulerToLines(100, 200, 40, 2, 'forward', boxes)).toBe(180);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/__tests__/utils/readingRuler.test.ts`
Expected: FAIL — `snapReadingRulerToLines is not a function` (export missing).

- [ ] **Step 3: Implement `snapReadingRulerToLines`**

In `src/app/reader/utils/readingRuler.ts`, add after `stepReadingRulerPosition`:

```typescript
const clampCenterPx = (center: number, dimension: number, rulerSize: number): number => {
  const half = rulerSize / 2;
  if (half * 2 >= dimension) return dimension / 2;
  return Math.max(half, Math.min(dimension - half, center));
};

/**
 * Snap the ruler band to the next/previous block of `lines` real text lines,
 * centered on that block. Returns the new band center in px, or null when there
 * is no next group in the given direction (the caller then flips the page).
 */
export const snapReadingRulerToLines = (
  currentCenterPx: number,
  dimension: number,
  rulerSize: number,
  lines: number,
  direction: 'backward' | 'forward',
  lineBoxes: ReadingRulerLineBox[],
): number | null => {
  if (lineBoxes.length === 0 || dimension <= 0) return null;

  const count = Math.max(1, Math.floor(lines));
  const heights = lineBoxes
    .map((b) => b.end - b.start)
    .filter((h) => h > 0)
    .sort((a, b) => a - b);
  const medianHeight = heights.length ? heights[Math.floor(heights.length / 2)] : 0;
  const eps = medianHeight * 0.3;

  const half = rulerSize / 2;
  const bandStart = currentCenterPx - half;
  const bandEnd = currentCenterPx + half;

  if (direction === 'forward') {
    const startIdx = lineBoxes.findIndex((b) => b.start >= bandEnd - eps);
    if (startIdx === -1) return null;
    const endIdx = Math.min(startIdx + count - 1, lineBoxes.length - 1);
    const center = (lineBoxes[startIdx].start + lineBoxes[endIdx].end) / 2;
    return clampCenterPx(center, dimension, rulerSize);
  }

  let endIdx = -1;
  for (let i = lineBoxes.length - 1; i >= 0; i--) {
    if (lineBoxes[i].end <= bandStart + eps) {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return null;
  const startIdx = Math.max(endIdx - count + 1, 0);
  const center = (lineBoxes[startIdx].start + lineBoxes[endIdx].end) / 2;
  return clampCenterPx(center, dimension, rulerSize);
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/__tests__/utils/readingRuler.test.ts`
Expected: PASS (all describe blocks, including the original ones).

- [ ] **Step 5: Commit**

```bash
git add apps/readest-app/src/app/reader/utils/readingRuler.ts apps/readest-app/src/__tests__/utils/readingRuler.test.ts
git commit -m "feat(ruler): add snapReadingRulerToLines for line-aware stepping"
```

---

## Task 3: Wire line-aware snapping into `ReadingRuler.tsx`

**Files:**
- Modify: `src/app/reader/components/ReadingRuler.tsx`

Glue the pure functions in: padded band size for snap-capable books, a per-page line-box cache, and snapping in both the tap handler and the page-change auto-move, with the existing arithmetic path as fallback.

This task is verified by `pnpm lint` + `pnpm test` (the pure logic is fully covered by Tasks 1–2) and a manual check in the reader, since the behavior depends on live DOM range geometry that unit tests cannot reproduce.

- [ ] **Step 1: Update imports**

In `src/app/reader/components/ReadingRuler.tsx`, change the `@/types/book` import (line 4) from:

```typescript
import { BookFormat, ViewSettings } from '@/types/book';
```

to:

```typescript
import { BookFormat, FIXED_LAYOUT_FORMATS, ViewSettings } from '@/types/book';
```

And change the `../utils/readingRuler` import (lines 12-16) from:

```typescript
import {
  calculateReadingRulerSize,
  clampReadingRulerPosition,
  stepReadingRulerPosition,
} from '../utils/readingRuler';
```

to:

```typescript
import {
  buildLineBoxes,
  calculateReadingRulerSize,
  clampReadingRulerPosition,
  READING_RULER_LINE_PADDING_PX,
  ReadingRulerLineBox,
  snapReadingRulerToLines,
  stepReadingRulerPosition,
} from '../utils/readingRuler';
```

- [ ] **Step 2: Compute `supportsLineSnap` and padded `rulerSize`**

Replace line 61:

```typescript
  const rulerSize = calculateReadingRulerSize(lines, viewSettings, bookFormat);
```

with:

```typescript
  const supportsLineSnap = !viewSettings.scrolled && !FIXED_LAYOUT_FORMATS.has(bookFormat);
  const baseRulerSize = calculateReadingRulerSize(lines, viewSettings, bookFormat);
  const rulerSize = baseRulerSize + (supportsLineSnap ? READING_RULER_LINE_PADDING_PX : 0);
```

- [ ] **Step 3: Add the line-box cache ref**

After the `currentPositionRef` declaration (line 59), add:

```typescript
  const lineBoxesRef = useRef<ReadingRulerLineBox[]>([]);
```

- [ ] **Step 4: Keep the line-box cache in sync per page**

Immediately after the container-size effect (the `useEffect` that ends at line 118, returning `() => resizeObserver.disconnect()`), add a new effect:

```typescript
  // Cache the visible line boxes for the current page so taps can snap to real lines.
  useEffect(() => {
    if (!supportsLineSnap) {
      lineBoxesRef.current = [];
      return;
    }
    const range = progress?.range ?? null;
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!range || !containerRect) {
      lineBoxesRef.current = [];
      return;
    }
    try {
      const rects = Array.from(range.getClientRects());
      lineBoxesRef.current = buildLineBoxes(rects, isVertical, rtl, containerRect);
    } catch {
      lineBoxesRef.current = [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    progress?.range,
    progress?.pageinfo?.current,
    containerSize.width,
    containerSize.height,
    isVertical,
    rtl,
    supportsLineSnap,
  ]);
```

- [ ] **Step 5: Snap on page-change auto-move**

Replace the `performAutoMove` function body (lines 193-215) with the version below. It tries the line snap first and keeps the existing first-visible-text offset as a fallback:

```typescript
    const performAutoMove = (range: Range | null) => {
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return;

      const containerDimension = isVertical ? containerRect.width : containerRect.height;
      if (containerDimension <= 0) return;

      if (supportsLineSnap && range) {
        try {
          const rects = Array.from(range.getClientRects());
          const boxes = buildLineBoxes(rects, isVertical, rtl, containerRect);
          lineBoxesRef.current = boxes;
          // Align to the first line group from the top of the page.
          const snapped = snapReadingRulerToLines(
            -rulerSize,
            containerDimension,
            rulerSize,
            lines,
            'forward',
            boxes,
          );
          if (snapped != null) {
            setRulerPosition((snapped / containerDimension) * 100, true);
            return;
          }
        } catch {
          /* fall through to default offset */
        }
      }

      const textPosition = getFirstVisibleTextPosition(range);
      // For vertical mode: use marginRight for vertical-rl, marginLeft for vertical-lr
      const defaultOffset = isVertical
        ? rtl
          ? (viewSettings.marginRightPx ?? 44)
          : (viewSettings.marginLeftPx ?? 44)
        : (viewSettings.marginTopPx ?? 44);

      const offset = textPosition ?? defaultOffset;
      const targetPosition = clampPosition(
        ((offset + rulerSize / 2) / containerDimension) * 100,
        containerDimension,
      );

      setRulerPosition(targetPosition, true);
    };
```

Then add `lines` and `supportsLineSnap` to the auto-move effect's dependency array (the array currently ending at lines 232-242). It should read:

```typescript
  }, [
    progress?.pageinfo?.current,
    viewSettings.scrolled,
    isVertical,
    rtl,
    viewSettings.marginTopPx,
    viewSettings.marginLeftPx,
    viewSettings.marginRightPx,
    rulerSize,
    lines,
    supportsLineSnap,
    setRulerPosition,
  ]);
```

- [ ] **Step 6: Snap in the tap/key move handler**

In the `reading-ruler-move` effect, replace the body from the `const nextPosition = stepReadingRulerPosition(...)` block through the `return true;` (lines 400-412) with:

```typescript
      let nextPosition: number;
      if (supportsLineSnap && lineBoxesRef.current.length > 0) {
        const currentCenterPx = (currentPositionRef.current / 100) * dimension;
        const snapped = snapReadingRulerToLines(
          currentCenterPx,
          dimension,
          rulerSize,
          lines,
          detail.direction,
          lineBoxesRef.current,
        );
        // No next line group in this direction: let the page flip instead.
        if (snapped == null) return false;
        nextPosition = (snapped / dimension) * 100;
      } else {
        nextPosition = stepReadingRulerPosition(
          currentPositionRef.current,
          dimension,
          rulerSize,
          detail.direction,
        );
      }

      if (Math.abs(nextPosition - currentPositionRef.current) < 0.001) {
        return false;
      }

      setRulerPosition(nextPosition, true);
      return true;
```

Then add `lines` and `supportsLineSnap` to that effect's dependency array (currently line 419) so it reads:

```typescript
  }, [
    bookKey,
    containerSize.height,
    containerSize.width,
    isVertical,
    lines,
    rulerSize,
    supportsLineSnap,
    setRulerPosition,
  ]);
```

- [ ] **Step 7: Type-check and lint**

Run: `pnpm lint`
Expected: PASS (no Biome errors, no tsgo type errors). If tsgo complains that `ReadingRulerLineBox` is unused, confirm Step 3 added the `lineBoxesRef` typed with it.

- [ ] **Step 8: Run the full unit suite**

Run: `pnpm test`
Expected: PASS — no regressions.

- [ ] **Step 9: Manual verification in the reader**

Start the web dev server (`pnpm dev-web`), open a reflowable EPUB, enable the reading ruler (Settings → Color/Layout → Reading Ruler), and confirm:
- Tapping the page advances the band so the next lines sit centered in it, with no manual adjustment needed across many taps.
- At the bottom of a page, a forward tap flips the page and the band lands centered on the first lines of the new page.
- Backward taps and (if available) a vertical-writing-mode book behave symmetrically.
- A fixed-layout PDF still uses the old fixed-step behavior (no errors).

- [ ] **Step 10: Commit**

```bash
git add apps/readest-app/src/app/reader/components/ReadingRuler.tsx
git commit -m "feat(ruler): snap reading ruler to real text lines on tap and page change"
```

---

## Self-Review Notes

- **Spec coverage:** snapping rule (Tasks 1–2), fixed-size + padding (`READING_RULER_LINE_PADDING_PX`, Task 3 Step 2), reflowable + vertical scope (`buildLineBoxes` mapping + `supportsLineSnap`), fallback matrix (scrolled/fixed-layout/missing range/boundary all route to `stepReadingRulerPosition` or page flip), per-page caching (Task 3 Step 4). All covered.
- **Type consistency:** `ReadingRulerLineBox { start; end }`, `buildLineBoxes(rects, isVertical, rtl, containerRect)`, and `snapReadingRulerToLines(currentCenterPx, dimension, rulerSize, lines, direction, lineBoxes)` are used identically in tests and glue.
- **No placeholders:** every code step contains complete code and exact run commands.
