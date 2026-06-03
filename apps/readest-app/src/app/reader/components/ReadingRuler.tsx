import clsx from 'clsx';
import React, { useCallback, useRef, useState, useEffect } from 'react';
import { Insets } from '@/types/misc';
import { BookFormat, FIXED_LAYOUT_FORMATS, ViewSettings } from '@/types/book';
import { FoliateView } from '@/types/view';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { saveViewSettings } from '@/helpers/settings';
import { READING_RULER_COLORS } from '@/services/constants';
import { throttle } from '@/utils/throttle';
import { eventDispatcher } from '@/utils/event';
import { useTouchInterceptor } from '../hooks/useTouchInterceptor';
import {
  buildLineBoxes,
  buildReadingRulerColumns,
  calculateReadingRulerPadding,
  calculateReadingRulerSize,
  clampReadingRulerPosition,
  filterVisibleLineBoxes,
  ReadingRulerColumn,
  ReadingRulerLineBox,
  snapReadingRulerColumns,
  snapReadingRulerToLines,
  stepReadingRulerPosition,
} from '../utils/readingRuler';

type OverlayRect = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
};

// Map a range's client rects (iframe-content coordinates) to overlay-relative
// coordinates, accounting for the iframe's offset within the top document
// (paginated multi-column pages shift the iframe far off-screen horizontally).
const mapRangeRectsToOverlay = (range: Range, containerRect: DOMRect): OverlayRect[] => {
  const doc = range.startContainer?.ownerDocument;
  const frame = doc?.defaultView?.frameElement?.getBoundingClientRect();
  const fx = frame?.left ?? 0;
  const fy = frame?.top ?? 0;
  return Array.from(range.getClientRects()).map((r) => ({
    top: r.top + fy - containerRect.top,
    bottom: r.bottom + fy - containerRect.top,
    left: r.left + fx - containerRect.left,
    right: r.right + fx - containerRect.left,
    width: r.width,
    height: r.height,
  }));
};

// Visible line boxes for the single-column / vertical path. Rects are mapped to
// overlay coordinates via the iframe frame offset (the section iframe is offset
// by the page/scroll position along the flow axis, for both horizontal columns
// and vertical writing mode). For vertical-rl the boxes are distance-from-right
// so the snap advances right-to-left in reading order.
const buildVisibleLineBoxes = (
  range: Range,
  containerRect: DOMRect,
  isVertical: boolean,
  rtl: boolean,
): ReadingRulerLineBox[] => {
  const dimension = isVertical ? containerRect.width : containerRect.height;
  const mapped = mapRangeRectsToOverlay(range, containerRect);
  const boxes = buildLineBoxes(mapped, isVertical, rtl, {
    top: 0,
    left: 0,
    right: containerRect.width,
  });
  return filterVisibleLineBoxes(boxes, dimension);
};

// In scrolled mode the relocate range covers only part of the viewport, so build
// line boxes from the visible section(s) directly: walk each on-screen content
// doc and map its lines via the frame offset. Lines just outside the viewport are
// kept (not filtered) so the snap can find the next/previous block to scroll to.
// Works for both horizontal flow (sections stack vertically, scroll axis = y) and
// vertical writing mode (sections stack horizontally, scroll axis = x).
const buildScrolledLineBoxes = (
  view: FoliateView | null,
  containerRect: DOMRect,
  isVertical: boolean,
  rtl: boolean,
): ReadingRulerLineBox[] => {
  if (!view) return [];
  const boxes: ReadingRulerLineBox[] = [];
  for (const content of view.renderer.getContents()) {
    const doc = content.doc;
    const frame = doc?.defaultView?.frameElement?.getBoundingClientRect();
    if (!frame) continue;
    // Skip sections fully outside the viewport along the scroll axis.
    const offscreen = isVertical
      ? frame.right <= containerRect.left || frame.left >= containerRect.right
      : frame.bottom <= containerRect.top || frame.top >= containerRect.bottom;
    if (offscreen) continue;
    const range = doc.createRange();
    range.selectNodeContents(doc.body);
    const mapped = mapRangeRectsToOverlay(range, containerRect);
    boxes.push(
      ...buildLineBoxes(mapped, isVertical, rtl, { top: 0, left: 0, right: containerRect.width }),
    );
  }
  boxes.sort((a, b) => a.start - b.start || a.end - b.end);
  return boxes;
};

// Confine each column's lines to those at least half visible within the viewport.
const filterVisibleColumns = (
  columns: ReadingRulerColumn[],
  dimension: number,
): ReadingRulerColumn[] =>
  columns
    .map((c) => ({
      left: c.left,
      right: c.right,
      lines: filterVisibleLineBoxes(c.lines, dimension),
    }))
    .filter((c) => c.lines.length > 0);

interface ReadingRulerProps {
  bookKey: string;
  isVertical: boolean;
  rtl: boolean;
  lines: number;
  position: number;
  opacity: number;
  color: keyof typeof READING_RULER_COLORS;
  bookFormat: BookFormat;
  viewSettings: ViewSettings;
  gridInsets: Insets;
}

const ReadingRuler: React.FC<ReadingRulerProps> = ({
  bookKey,
  isVertical,
  rtl,
  lines,
  position,
  opacity,
  color,
  bookFormat,
  viewSettings,
}) => {
  const { envConfig } = useEnv();
  const { getProgress, getView } = useReaderStore();
  const progress = getProgress(bookKey);
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentPosition, setCurrentPosition] = useState(position);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  // Active column extent (px, overlay-relative) for multi-column layouts; null = full width.
  const [activeColumnRect, setActiveColumnRect] = useState<{ left: number; right: number } | null>(
    null,
  );
  // Band thickness along the ruler axis (px); 0 until first measured, then the
  // real text-block size + symmetric padding. Falls back to a fixed size.
  const [bandSize, setBandSize] = useState(0);

  // State for visibility animation (fade in)
  const [isVisible, setIsVisible] = useState(false);

  // State for smooth auto-position animation
  const [shouldAnimate, setShouldAnimate] = useState(false);

  const isDragging = useRef(false);
  const dragPointerOffsetRef = useRef(0);
  const lastPageRef = useRef<number | null>(null);
  const animationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentPositionRef = useRef(position);
  const lineBoxesRef = useRef<ReadingRulerLineBox[]>([]);
  const columnsRef = useRef<ReadingRulerColumn[]>([]);
  const activeColumnIndexRef = useRef(0);
  const bandSizeRef = useRef(0);
  const cachePageRef = useRef<number | null>(null);
  // In scrolled mode, set when a tap advances past the view edge and scrolls the
  // view; the next relocate realigns the band to the start/end of the new view.
  const pendingScrollAlignRef = useRef<'forward' | 'backward' | null>(null);
  // In scrolled mode the band is fixed to the screen: it is snapped into place on
  // the initial mount (and after a viewport-dimension change), but never re-snapped
  // on a plain scroll relocate — that made it creep down the page (issue #4386).
  // Snapping while scrolled is driven by clicks (the reading-ruler-move handler).
  const scrolledPlacedRef = useRef(false);
  const scrolledPlacedDimensionRef = useRef(0);

  const supportsLineSnap = !FIXED_LAYOUT_FORMATS.has(bookFormat);
  const columnCount = getView(bookKey)?.renderer?.columnCount ?? 1;
  const isMultiColumn = supportsLineSnap && !isVertical && columnCount > 1;
  const baseRulerSize = calculateReadingRulerSize(lines, viewSettings, bookFormat);
  // Symmetric breathing room on each side of the text block.
  const padding = supportsLineSnap ? calculateReadingRulerPadding(viewSettings, bookFormat) : 0;
  // Fixed band size used until lines are measured and for non-snap fallbacks.
  const fallbackRulerSize = baseRulerSize + 2 * padding;
  // Cap the dynamic band at (lines + 1) line heights so a tall element (e.g. a
  // full-page image) inside the block doesn't expand the band to cover all of it.
  const maxBandSize = calculateReadingRulerSize(lines + 1, viewSettings, bookFormat);
  const baseColor = READING_RULER_COLORS[color] || READING_RULER_COLORS['yellow'];

  const clampPosition = useCallback(
    (pos: number, dimension: number) =>
      clampReadingRulerPosition(pos, dimension, bandSizeRef.current || fallbackRulerSize),
    [fallbackRulerSize],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const throttledSave = useCallback(
    throttle((pos: number) => {
      saveViewSettings(envConfig, bookKey, 'readingRulerPosition', pos, false, false);
    }, 10000),
    [envConfig, bookKey],
  );

  const setRulerPosition = useCallback(
    (nextPosition: number, animate = false) => {
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
        animationTimeoutRef.current = null;
      }

      setShouldAnimate(animate);
      setCurrentPosition(nextPosition);
      currentPositionRef.current = nextPosition;
      throttledSave(nextPosition);

      if (animate) {
        animationTimeoutRef.current = setTimeout(() => {
          setShouldAnimate(false);
          animationTimeoutRef.current = null;
        }, 650);
      }
    },
    [throttledSave],
  );

  // Size the band to the real text block plus symmetric padding, centered on
  // the block so the breathing room is equal on both sides.
  const applyBlock = useCallback(
    (start: number, end: number, dimension: number, animate: boolean) => {
      // Band = text block + symmetric padding, capped at (lines + 1) line heights
      // so a tall element in the block can't blow the band up to cover all of it.
      const size = Math.min(end - start + 2 * padding, maxBandSize);
      bandSizeRef.current = size;
      setBandSize(size);
      // Always center the band on the text block (equal padding all around). The
      // caller scrolls the view when a block can't be centered within it, so the
      // center never needs clamping here.
      const centerPct =
        dimension > 0 ? ((start + end) / 2 / dimension) * 100 : currentPositionRef.current;
      setRulerPosition(centerPct, animate);
    },
    [padding, maxBandSize, setRulerPosition],
  );

  // Track container size for overlay calculations
  useEffect(() => {
    if (!containerRef.current) return;

    const updateSize = () => {
      if (containerRef.current) {
        setContainerSize({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    updateSize();

    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(containerRef.current);

    return () => resizeObserver.disconnect();
  }, []);

  // Cache the visible line geometry for the current page so taps can snap to
  // real lines: columns for multi-column layouts, otherwise a flat line list.
  useEffect(() => {
    const range = progress?.range ?? null;
    const containerRect = containerRef.current?.getBoundingClientRect();
    const page = progress?.pageinfo?.current ?? null;
    // Page changes are handled by the auto-move effect; here we only (re)derive
    // the band on initial mount and on resize/relayout.
    const pageChanged = cachePageRef.current !== null && cachePageRef.current !== page;
    cachePageRef.current = page;

    if (!supportsLineSnap || !range || !containerRect) {
      lineBoxesRef.current = [];
      columnsRef.current = [];
      setActiveColumnRect(null);
      return;
    }
    try {
      const dimension = isVertical ? containerRect.width : containerRect.height;
      const center = dimension > 0 ? (currentPositionRef.current / 100) * dimension : 0;
      // Re-snap anchor: the band's leading edge (block start), not its center.
      // Snapping 'forward' from the center skips the line the center sits inside,
      // which would advance the band by one line on every relayout/relocate (e.g.
      // the settle relocate right after a page turn skipped the new page's line 1).
      const halfBlock = Math.max(0, (bandSizeRef.current || fallbackRulerSize) / 2 - padding);
      const anchor = center - halfBlock;
      if (isMultiColumn) {
        const mapped = mapRangeRectsToOverlay(range, containerRect);
        const cols = filterVisibleColumns(
          buildReadingRulerColumns(mapped, columnCount, containerRect.width, rtl),
          dimension,
        );
        columnsRef.current = cols;
        lineBoxesRef.current = [];
        const idx = Math.max(0, Math.min(activeColumnIndexRef.current, cols.length - 1));
        const col = cols[idx];
        setActiveColumnRect(col ? { left: col.left, right: col.right } : null);
        if (!pageChanged) {
          const block = snapReadingRulerColumns(idx, anchor, anchor, lines, 'forward', cols);
          if (block) {
            activeColumnIndexRef.current = block.columnIndex;
            const target = cols[block.columnIndex];
            if (target) setActiveColumnRect({ left: target.left, right: target.right });
            applyBlock(block.start, block.end, dimension, false);
          }
        }
      } else {
        const scrolled = !!viewSettings.scrolled;
        lineBoxesRef.current = scrolled
          ? buildScrolledLineBoxes(getView(bookKey), containerRect, isVertical, rtl)
          : buildVisibleLineBoxes(range, containerRect, isVertical, rtl);
        columnsRef.current = [];
        setActiveColumnRect(null);
        // Position the band against the on-screen lines only, so it lands in view
        // (the handler uses the unfiltered set to scroll toward off-screen lines).
        const derivBoxes = scrolled
          ? filterVisibleLineBoxes(lineBoxesRef.current, dimension)
          : lineBoxesRef.current;
        const pending = pendingScrollAlignRef.current;
        if (pending) {
          // The view just scrolled because a tap advanced past its edge: put the
          // band at the start (forward) or end (backward) of the new view.
          pendingScrollAlignRef.current = null;
          const block =
            pending === 'forward'
              ? snapReadingRulerToLines(-Infinity, -Infinity, lines, 'forward', derivBoxes)
              : snapReadingRulerToLines(Infinity, Infinity, lines, 'backward', derivBoxes);
          if (block) {
            applyBlock(block.start, block.end, dimension, true);
            scrolledPlacedRef.current = true;
            scrolledPlacedDimensionRef.current = dimension;
          }
        } else if (!pageChanged) {
          // In scrolled mode, only snap the band on the initial mount or after the
          // viewport dimension changes (resize/relayout). A plain scroll fires a
          // relocate without changing the dimension; re-snapping then would walk
          // the band down the page as the reader scrolls (issue #4386).
          const alreadyPlaced =
            scrolled &&
            scrolledPlacedRef.current &&
            scrolledPlacedDimensionRef.current === dimension;
          if (!alreadyPlaced) {
            const block =
              snapReadingRulerToLines(anchor, anchor, lines, 'forward', derivBoxes) ??
              snapReadingRulerToLines(Infinity, Infinity, lines, 'backward', derivBoxes);
            if (block) {
              applyBlock(block.start, block.end, dimension, false);
              if (scrolled) {
                scrolledPlacedRef.current = true;
                scrolledPlacedDimensionRef.current = dimension;
              }
            }
          }
        }
      }
    } catch {
      lineBoxesRef.current = [];
      columnsRef.current = [];
      setActiveColumnRect(null);
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
    isMultiColumn,
    columnCount,
    lines,
    viewSettings.scrolled,
    bookKey,
    getView,
    applyBlock,
  ]);

  // Fade in on mount (delayed to prevent flash before content loads)
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 30);
    return () => clearTimeout(timer);
  }, []);

  // Auto-move ruler to first visible text on page change
  useEffect(() => {
    if (!progress?.pageinfo || viewSettings.scrolled) return;

    /**
     * Get the position of the first visible text element.
     * For horizontal mode: returns top offset (same for both LTR and RTL)
     * For vertical-rl mode (Japanese/Chinese): returns distance from right edge
     * For vertical-lr mode (Mongolian): returns distance from left edge
     */
    const getFirstVisibleTextPosition = (range: Range | null): number | null => {
      if (!range) return null;
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return null;

      try {
        const rects = range.getClientRects();
        if (rects.length === 0) return null;

        if (isVertical) {
          // Vertical writing mode: text flows top-to-bottom
          // For vertical-rl (rtl=true): columns flow right-to-left, first column is on right
          // For vertical-lr (rtl=false): columns flow left-to-right, first column is on left
          const viewportMidY = containerRect.top + containerRect.height / 2;
          for (let i = 0; i < rects.length; i++) {
            const rect = rects.item(i);
            if (!rect || rect.height <= 0 || rect.width <= 0) continue;
            // Check if this rect is in the upper half of the viewport (first visible line)
            if (rect.top + rect.height / 2 < viewportMidY) {
              if (rtl) {
                // vertical-rl: return distance from right edge
                return containerRect.right - rect.right;
              } else {
                // vertical-lr: return distance from left edge
                return rect.left - containerRect.left;
              }
            }
          }
          const firstRect = rects.item(0);
          if (firstRect && firstRect.width > 0) {
            if (rtl) {
              return containerRect.right - firstRect.right;
            } else {
              return firstRect.left - containerRect.left;
            }
          }
        } else {
          // Horizontal writing mode: find first line's top position
          const viewportMidX = containerRect.left + containerRect.width / 2;
          for (let i = 0; i < rects.length; i++) {
            const rect = rects.item(i);
            if (!rect || rect.height <= 0 || rect.width <= 0) continue;
            if (rect.left + rect.width / 2 < viewportMidX) {
              return rect.top - containerRect.top;
            }
          }
          const firstRect = rects.item(0);
          if (firstRect && firstRect.height > 0) {
            return firstRect.top - containerRect.top;
          }
        }
      } catch {
        /* ignore errors from invalid ranges */
      }
      return null;
    };

    const performAutoMove = (range: Range | null, direction: 'forward' | 'backward') => {
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return;

      const containerDimension = isVertical ? containerRect.width : containerRect.height;
      if (containerDimension <= 0) return;

      // Paging forward lands on the first line of the new page; paging backward
      // lands on the last line (so reading continues from where it left off).
      const forward = direction === 'forward';

      if (isMultiColumn && range) {
        try {
          const mapped = mapRangeRectsToOverlay(range, containerRect);
          const columns = filterVisibleColumns(
            buildReadingRulerColumns(mapped, columnCount, containerRect.width, rtl),
            containerDimension,
          );
          columnsRef.current = columns;
          // Forward: first line group of the first column. Backward: last line
          // group of the last column.
          const block = forward
            ? snapReadingRulerColumns(0, -Infinity, -Infinity, lines, 'forward', columns)
            : snapReadingRulerColumns(
                columns.length - 1,
                Infinity,
                Infinity,
                lines,
                'backward',
                columns,
              );
          if (block) {
            activeColumnIndexRef.current = block.columnIndex;
            const col = columns[block.columnIndex];
            if (col) setActiveColumnRect({ left: col.left, right: col.right });
            applyBlock(block.start, block.end, containerDimension, true);
            return;
          }
        } catch {
          /* fall through to default offset */
        }
      }

      if (supportsLineSnap && !isMultiColumn && range) {
        try {
          const boxes = buildVisibleLineBoxes(range, containerRect, isVertical, rtl);
          lineBoxesRef.current = boxes;
          // Forward: first line group from the top. Backward: last line group.
          const block = forward
            ? snapReadingRulerToLines(-Infinity, -Infinity, lines, 'forward', boxes)
            : snapReadingRulerToLines(Infinity, Infinity, lines, 'backward', boxes);
          if (block) {
            applyBlock(block.start, block.end, containerDimension, true);
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
      bandSizeRef.current = fallbackRulerSize;
      setBandSize(fallbackRulerSize);
      const targetPosition = clampPosition(
        ((offset + fallbackRulerSize / 2) / containerDimension) * 100,
        containerDimension,
      );

      setRulerPosition(targetPosition, true);
    };

    const currentPage = progress.pageinfo.current;
    const range = progress.range;

    // Only auto-move if page actually changed (not on initial load)
    if (lastPageRef.current !== null && lastPageRef.current !== currentPage) {
      const direction = currentPage > lastPageRef.current ? 'forward' : 'backward';
      requestAnimationFrame(() => performAutoMove(range, direction));
    }
    lastPageRef.current = currentPage;

    return () => {
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    progress?.pageinfo?.current,
    viewSettings.scrolled,
    isVertical,
    rtl,
    viewSettings.marginTopPx,
    viewSettings.marginLeftPx,
    viewSettings.marginRightPx,
    fallbackRulerSize,
    lines,
    supportsLineSnap,
    isMultiColumn,
    columnCount,
    applyBlock,
    clampPosition,
    setRulerPosition,
  ]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      isDragging.current = true;

      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const dimension = isVertical ? rect.width : rect.height;
        const fromStart = isVertical ? e.clientX - rect.left : e.clientY - rect.top;
        // Position along the ruler axis: distance-from-right for vertical-rl so it
        // matches the stored position; distance-from-left/top otherwise.
        const pointerPosition = isVertical && rtl ? rect.width - fromStart : fromStart;
        const rulerCenter = (currentPositionRef.current / 100) * dimension;
        dragPointerOffsetRef.current = pointerPosition - rulerCenter;
      } else {
        dragPointerOffsetRef.current = 0;
      }

      // Disable animation during manual drag for immediate feedback
      setShouldAnimate(false);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [isVertical, rtl],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      e.preventDefault();
      e.stopPropagation();

      const rect = containerRef.current.getBoundingClientRect();
      let newPosition: number;

      if (isVertical) {
        const fromStart = e.clientX - rect.left;
        const pointerPosition = rtl ? rect.width - fromStart : fromStart;
        newPosition = clampPosition(
          ((pointerPosition - dragPointerOffsetRef.current) / rect.width) * 100,
          rect.width,
        );
      } else {
        const relativeY = e.clientY - rect.top - dragPointerOffsetRef.current;
        newPosition = clampPosition((relativeY / rect.height) * 100, rect.height);
      }
      setCurrentPosition(newPosition);
      currentPositionRef.current = newPosition;
    },
    [isVertical, rtl, clampPosition],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return;
      isDragging.current = false;
      dragPointerOffsetRef.current = 0;
      e.currentTarget.releasePointerCapture(e.pointerId);
      throttledSave(currentPositionRef.current);
    },
    [throttledSave],
  );

  useEffect(() => {
    const dimension = isVertical ? containerSize.width : containerSize.height;
    if (!dimension || isDragging.current) return;
    const clamped = clampPosition(currentPositionRef.current, dimension);
    if (clamped !== currentPositionRef.current) {
      setRulerPosition(clamped);
    }
  }, [containerSize.width, containerSize.height, isVertical, clampPosition, setRulerPosition]);

  // Touch interceptor: allows dragging the ruler from anywhere on its body.
  // The ruler body stays pointer-events-none so text selection works through it.
  // Returning true consumes the gesture, preventing swipe/page-flip.
  const isTouchDraggingRef = useRef(false);
  const touchInRulerRef = useRef(false);

  useTouchInterceptor(
    `ruler-drag-${bookKey}`,
    (bk, detail) => {
      if (bk !== bookKey) return false;

      if (detail.phase === 'start') {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return false;
        const vx = detail.touch.screenX - (window.screenX || 0);
        const vy = detail.touch.screenY - (window.screenY || 0);
        const dim = isVertical ? rect.width : rect.height;
        const center = (currentPositionRef.current / 100) * dim;
        const half = (bandSizeRef.current || fallbackRulerSize) / 2;
        const rel = isVertical
          ? rtl
            ? rect.width - (vx - rect.left)
            : vx - rect.left
          : vy - rect.top;
        touchInRulerRef.current = rel >= center - half && rel <= center + half;
        isTouchDraggingRef.current = false;
        return false;
      }

      if (detail.phase === 'move') {
        if (!touchInRulerRef.current) return false;

        if (!isTouchDraggingRef.current) {
          const dx = Math.abs(detail.deltaX);
          const dy = Math.abs(detail.deltaY);
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance >= 10) {
            const isDragGesture = isVertical ? dx >= 3 * dy : dy >= 3 * dx;
            if (isDragGesture) {
              isTouchDraggingRef.current = true;
              isDragging.current = true;
              dragPointerOffsetRef.current = 0;
              setShouldAnimate(false);
            } else {
              touchInRulerRef.current = false;
              return false;
            }
          } else {
            return false;
          }
        }

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return true;
        const vx = detail.touch.screenX - (window.screenX || 0);
        const vy = detail.touch.screenY - (window.screenY || 0);
        const dim = isVertical ? rect.width : rect.height;
        const rel = isVertical
          ? rtl
            ? rect.width - (vx - rect.left)
            : vx - rect.left
          : vy - rect.top;
        const newPos = clampPosition((rel / dim) * 100, dim);
        setCurrentPosition(newPos);
        currentPositionRef.current = newPos;
        return true;
      }

      if (detail.phase === 'end') {
        const wasConsumed = isTouchDraggingRef.current;
        if (wasConsumed) {
          isDragging.current = false;
          throttledSave(currentPositionRef.current);
        }
        touchInRulerRef.current = false;
        isTouchDraggingRef.current = false;
        return wasConsumed;
      }

      return false;
    },
    10, // higher priority than swipe-to-flip (0)
  );

  useEffect(() => {
    const handleMove = (event: CustomEvent) => {
      const detail = (event.detail ?? {}) as {
        bookKey?: string;
        direction?: 'backward' | 'forward';
      };

      if (detail.bookKey !== bookKey || !detail.direction || isDragging.current) return false;

      const dimension = isVertical
        ? (containerRef.current?.clientWidth ?? containerSize.width)
        : (containerRef.current?.clientHeight ?? containerSize.height);

      if (!dimension) return false;

      // The lines currently covered by the band (block extent, without padding).
      const center = (currentPositionRef.current / 100) * dimension;
      const halfBlock = Math.max(0, (bandSizeRef.current || fallbackRulerSize) / 2 - padding);
      const curStart = center - halfBlock;
      const curEnd = center + halfBlock;

      if (isMultiColumn && columnsRef.current.length > 0) {
        const block = snapReadingRulerColumns(
          activeColumnIndexRef.current,
          curStart,
          curEnd,
          lines,
          detail.direction,
          columnsRef.current,
        );
        // No next line group in any column this direction: let the page flip.
        if (!block) return false;
        activeColumnIndexRef.current = block.columnIndex;
        const col = columnsRef.current[block.columnIndex];
        if (col) setActiveColumnRect({ left: col.left, right: col.right });
        applyBlock(block.start, block.end, dimension, true);
        return true;
      }

      if (supportsLineSnap && lineBoxesRef.current.length > 0) {
        const block = snapReadingRulerToLines(
          curStart,
          curEnd,
          lines,
          detail.direction,
          lineBoxesRef.current,
        );
        if (!block) {
          // No next line in the loaded geometry: in scrolled mode let the view
          // scroll, then realign the band on the next relocate.
          if (viewSettings.scrolled) pendingScrollAlignRef.current = detail.direction;
          return false;
        }

        // Scrolled mode: keep the text centered in the band. While the next block
        // can be centered within the view, place it there (the band moves). When
        // it can't, let foliate page-scroll the view (its relocate fires after the
        // layout settles, unlike a manual scrollBy) and realign on that relocate.
        if (viewSettings.scrolled) {
          const bandHalf = (block.end - block.start) / 2 + padding;
          const blockCenter = (block.start + block.end) / 2;
          const centerable = blockCenter - bandHalf >= 0 && blockCenter + bandHalf <= dimension;
          if (!centerable) {
            pendingScrollAlignRef.current = detail.direction;
            return false;
          }
        }

        applyBlock(block.start, block.end, dimension, true);
        return true;
      }

      const nextPosition = stepReadingRulerPosition(
        currentPositionRef.current,
        dimension,
        fallbackRulerSize,
        detail.direction,
      );
      if (Math.abs(nextPosition - currentPositionRef.current) < 0.001) {
        return false;
      }
      bandSizeRef.current = fallbackRulerSize;
      setBandSize(fallbackRulerSize);
      setRulerPosition(nextPosition, true);
      return true;
    };

    eventDispatcher.onSync('reading-ruler-move', handleMove);
    return () => {
      eventDispatcher.offSync('reading-ruler-move', handleMove);
    };
  }, [
    bookKey,
    containerSize.height,
    containerSize.width,
    isVertical,
    lines,
    padding,
    fallbackRulerSize,
    supportsLineSnap,
    isMultiColumn,
    viewSettings.scrolled,
    getView,
    applyBlock,
    setRulerPosition,
  ]);

  const fadeOpacity = Math.min(0.9, opacity);

  // Calculate dimensions based on orientation. The band size is the measured
  // text block + padding once known, otherwise the fixed fallback size.
  const effectiveBandSize = bandSize > 0 ? bandSize : fallbackRulerSize;
  const containerDimension = isVertical ? containerSize.width : containerSize.height;
  // Band position as a percentage from the left/top. For vertical-rl the stored
  // position is distance-from-right, so flip it to position from the left.
  const renderPosPct = isVertical && rtl ? 100 - currentPosition : currentPosition;
  const rulerCenterPx = (renderPosPct / 100) * containerDimension;
  const rulerStartPx = Math.max(0, rulerCenterPx - effectiveBandSize / 2);
  const rulerEndPx = Math.min(containerDimension, rulerCenterPx + effectiveBandSize / 2);

  // Map color names to CSS filter values (compatible with iOS Safari)
  // Uses sepia as base, then hue-rotate to target color
  const colorToFilter: Record<string, string> = {
    yellow: `sepia(${opacity}) saturate(2) hue-rotate(0deg) brightness(1)`,
    green: `sepia(${opacity}) saturate(2) hue-rotate(70deg) brightness(1)`,
    blue: `sepia(${opacity}) saturate(2) hue-rotate(135deg) brightness(1)`,
    rose: `sepia(${opacity}) saturate(2) hue-rotate(225deg) brightness(1)`,
  };

  const cssFilter = colorToFilter[color] || colorToFilter['yellow'];

  const backdropFilterStyle = {
    backdropFilter: cssFilter,
    WebkitBackdropFilter: cssFilter,
  };

  // Animation transition for smooth auto-positioning
  const getTransitionStyle = (property: 'left' | 'top' | 'width' | 'height') =>
    shouldAnimate ? `${property} 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94)` : 'none';

  const dragHandleProps = {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerUp,
  };

  if (isVertical) {
    // Vertical ruler (for vertical writing mode - moves left/right)
    return (
      <div
        ref={containerRef}
        className={clsx(
          'pointer-events-none absolute inset-0 z-[5] transition-opacity duration-150 ease-out',
          isVisible ? 'opacity-100' : 'opacity-0',
        )}
      >
        {/* Left overlay */}
        <div
          className='bg-base-100 pointer-events-none absolute bottom-0 left-0 top-0'
          style={{
            width: `${rulerStartPx}px`,
            opacity: fadeOpacity,
            transition: getTransitionStyle('width'),
          }}
        />

        {/* Right overlay */}
        <div
          className='bg-base-100 pointer-events-none absolute bottom-0 right-0 top-0'
          style={{
            width: `${containerSize.width - rulerEndPx}px`,
            opacity: fadeOpacity,
            transition: getTransitionStyle('width'),
          }}
        />

        {/* Vertical ruler */}
        <div
          className={clsx(
            'ruler pointer-events-none absolute bottom-0 top-0 my-2 rounded-2xl',
            color === 'transparent' ? 'border-base-content/55 border' : '',
          )}
          style={{
            left: `${renderPosPct}%`,
            width: `${effectiveBandSize}px`,
            transform: 'translateX(-50%)',
            transition: getTransitionStyle('left'),
            ...(color === 'transparent'
              ? {
                  backgroundColor: baseColor,
                }
              : backdropFilterStyle),
          }}
        >
          {/* Keep the ruler body pass-through so text inside stays selectable. */}
          <div
            className='pointer-events-auto absolute inset-y-0 -left-2 w-4 cursor-col-resize touch-none'
            {...dragHandleProps}
          />
          <div
            className='pointer-events-auto absolute inset-y-0 -right-2 w-4 cursor-col-resize touch-none'
            {...dragHandleProps}
          />
        </div>
      </div>
    );
  }

  // Column-aware horizontal ruler: the band spans a single column; the rest of
  // the page (including the other column) is dimmed.
  if (activeColumnRect) {
    const W = containerSize.width;
    const H = containerSize.height;
    const centerPx = (currentPosition / 100) * H;
    const bandTop = Math.max(0, centerPx - effectiveBandSize / 2);
    const bandBottom = Math.min(H, centerPx + effectiveBandSize / 2);
    const bandHeight = Math.max(0, bandBottom - bandTop);
    // Same breathing room horizontally as vertically, so padding is equal all around.
    const bandLeft = Math.max(0, activeColumnRect.left - padding);
    const bandRight = Math.min(W, activeColumnRect.right + padding);
    const bandWidth = Math.max(0, bandRight - bandLeft);
    const ease = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
    const bandTransition = shouldAnimate
      ? `top 0.6s ${ease}, left 0.6s ${ease}, width 0.6s ${ease}, height 0.6s ${ease}`
      : 'none';
    const dimTransition = shouldAnimate ? `top 0.6s ${ease}, height 0.6s ${ease}` : 'none';

    return (
      <div
        ref={containerRef}
        className={clsx(
          'pointer-events-none absolute inset-0 z-[5] transition-opacity duration-150 ease-out',
          isVisible ? 'opacity-100' : 'opacity-0',
        )}
      >
        {/* Top dim */}
        <div
          className='bg-base-100 pointer-events-none absolute left-0 right-0 top-0'
          style={{ height: `${bandTop}px`, opacity: fadeOpacity, transition: dimTransition }}
        />
        {/* Bottom dim */}
        <div
          className='bg-base-100 pointer-events-none absolute bottom-0 left-0 right-0'
          style={{ height: `${H - bandBottom}px`, opacity: fadeOpacity, transition: dimTransition }}
        />
        {/* Left dim (covers the inactive column to the left of the band) */}
        <div
          className='bg-base-100 pointer-events-none absolute left-0'
          style={{
            top: `${bandTop}px`,
            height: `${bandHeight}px`,
            width: `${bandLeft}px`,
            opacity: fadeOpacity,
            transition: bandTransition,
          }}
        />
        {/* Right dim (covers the inactive column to the right of the band) */}
        <div
          className='bg-base-100 pointer-events-none absolute right-0'
          style={{
            top: `${bandTop}px`,
            height: `${bandHeight}px`,
            width: `${Math.max(0, W - bandRight)}px`,
            opacity: fadeOpacity,
            transition: bandTransition,
          }}
        />

        {/* Column band */}
        <div
          className={clsx(
            'ruler pointer-events-none absolute rounded-2xl',
            color === 'transparent' ? 'border-base-content/55 border' : '',
          )}
          style={{
            left: `${bandLeft}px`,
            top: `${bandTop}px`,
            width: `${bandWidth}px`,
            height: `${bandHeight}px`,
            transition: bandTransition,
            ...(color === 'transparent' ? { backgroundColor: baseColor } : backdropFilterStyle),
          }}
        >
          <div
            className='pointer-events-auto absolute inset-x-0 -top-2 h-4 cursor-row-resize touch-none'
            {...dragHandleProps}
          />
          <div
            className='pointer-events-auto absolute inset-x-0 -bottom-2 h-4 cursor-row-resize touch-none'
            {...dragHandleProps}
          />
        </div>
      </div>
    );
  }

  // Horizontal ruler (default - moves up/down)
  return (
    <div
      ref={containerRef}
      className={clsx(
        'pointer-events-none absolute inset-0 z-[5] transition-opacity duration-150 ease-out',
        isVisible ? 'opacity-100' : 'opacity-0',
      )}
    >
      {/* Top overlay */}
      <div
        className='bg-base-100 pointer-events-none absolute left-0 right-0 top-0'
        style={{
          height: `${rulerStartPx}px`,
          opacity: fadeOpacity,
          transition: getTransitionStyle('height'),
        }}
      />

      {/* Bottom overlay */}
      <div
        className='bg-base-100 pointer-events-none absolute bottom-0 left-0 right-0'
        style={{
          height: `${containerSize.height - rulerEndPx}px`,
          opacity: fadeOpacity,
          transition: getTransitionStyle('height'),
        }}
      />

      {/* Horizontal ruler */}
      <div
        className={clsx(
          'ruler pointer-events-none absolute left-0 right-0 mx-2 rounded-2xl',
          color === 'transparent' ? 'border-base-content/55 border' : '',
        )}
        style={{
          top: `${currentPosition}%`,
          height: `${effectiveBandSize}px`,
          transform: 'translateY(-50%)',
          transition: getTransitionStyle('top'),
          ...(color === 'transparent'
            ? {
                backgroundColor: baseColor,
              }
            : backdropFilterStyle),
        }}
      >
        <div
          className='pointer-events-auto absolute inset-x-0 -top-2 h-4 cursor-row-resize touch-none'
          {...dragHandleProps}
        />
        <div
          className='pointer-events-auto absolute inset-x-0 -bottom-2 h-4 cursor-row-resize touch-none'
          {...dragHandleProps}
        />
      </div>
    </div>
  );
};

export default ReadingRuler;
