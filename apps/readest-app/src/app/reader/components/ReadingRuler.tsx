import clsx from 'clsx';
import React, { useCallback, useRef, useState, useEffect } from 'react';
import { Insets } from '@/types/misc';
import { BookFormat, FIXED_LAYOUT_FORMATS, ViewSettings } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { saveViewSettings } from '@/helpers/settings';
import { READING_RULER_COLORS } from '@/services/constants';
import { throttle } from '@/utils/throttle';

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

const FIXED_LAYOUT_LINE_HEIGHT = 28;

const calculateRulerSize = (
  lines: number,
  viewSettings: ViewSettings,
  bookFormat: BookFormat,
): number => {
  if (FIXED_LAYOUT_FORMATS.has(bookFormat)) {
    return lines * FIXED_LAYOUT_LINE_HEIGHT;
  }
  const fontSize = viewSettings.defaultFontSize || 16;
  const lineHeight = viewSettings.lineHeight || 1.5;
  return Math.round(lines * fontSize * lineHeight);
};

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
  const { getProgress } = useReaderStore();
  const progress = getProgress(bookKey);
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentPosition, setCurrentPosition] = useState(position);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // State for visibility animation (fade in)
  const [isVisible, setIsVisible] = useState(false);

  // State for smooth auto-position animation
  const [shouldAnimate, setShouldAnimate] = useState(false);

  const isDragging = useRef(false);
  const lastPageRef = useRef<number | null>(null);
  const animationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentPositionRef = useRef(position);

  const rulerSize = calculateRulerSize(lines, viewSettings, bookFormat);
  const baseColor = READING_RULER_COLORS[color] || READING_RULER_COLORS['yellow'];

  const clampPosition = useCallback(
    (pos: number, dimension: number) => {
      if (dimension <= 0) return Math.max(0, Math.min(100, pos));
      const halfPct = (rulerSize / 2 / dimension) * 100;
      if (halfPct >= 50) return 50;
      const min = halfPct;
      const max = 100 - halfPct;
      return Math.max(min, Math.min(max, pos));
    },
    [rulerSize],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const throttledSave = useCallback(
    throttle((pos: number) => {
      saveViewSettings(envConfig, bookKey, 'readingRulerPosition', pos, false, false);
    }, 10000),
    [envConfig, bookKey],
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

    const performAutoMove = (range: Range | null) => {
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return;

      const containerDimension = isVertical ? containerRect.width : containerRect.height;
      if (containerDimension <= 0) return;

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

      // Clear any existing animation timeout
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
      }

      // Enable animation, update position, then disable animation after transition
      setShouldAnimate(true);
      setCurrentPosition(targetPosition);
      currentPositionRef.current = targetPosition;
      throttledSave(targetPosition);
      animationTimeoutRef.current = setTimeout(() => setShouldAnimate(false), 650);
    };

    const currentPage = progress.pageinfo.current;
    const range = progress.range;

    // Only auto-move if page actually changed (not on initial load)
    if (lastPageRef.current !== null && lastPageRef.current !== currentPage) {
      requestAnimationFrame(() => performAutoMove(range));
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
    rulerSize,
    throttledSave,
  ]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging.current = true;
    // Disable animation during manual drag for immediate feedback
    setShouldAnimate(false);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      e.preventDefault();
      e.stopPropagation();

      const rect = containerRef.current.getBoundingClientRect();
      let newPosition: number;

      if (isVertical) {
        const relativeX = e.clientX - rect.left;
        newPosition = clampPosition((relativeX / rect.width) * 100, rect.width);
      } else {
        const relativeY = e.clientY - rect.top;
        newPosition = clampPosition((relativeY / rect.height) * 100, rect.height);
      }
      setCurrentPosition(newPosition);
      currentPositionRef.current = newPosition;
    },
    [isVertical, clampPosition],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return;
      isDragging.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
      throttledSave(currentPosition);
    },
    [currentPosition, throttledSave],
  );

  useEffect(() => {
    const dimension = isVertical ? containerSize.width : containerSize.height;
    if (!dimension || isDragging.current) return;
    const clamped = clampPosition(currentPositionRef.current, dimension);
    if (clamped !== currentPositionRef.current) {
      setCurrentPosition(clamped);
      currentPositionRef.current = clamped;
      throttledSave(clamped);
    }
  }, [containerSize.width, containerSize.height, isVertical, clampPosition, throttledSave]);

  const fadeOpacity = Math.min(0.9, opacity);

  // Calculate dimensions based on orientation
  const containerDimension = isVertical ? containerSize.width : containerSize.height;
  const rulerCenterPx = (currentPosition / 100) * containerDimension;
  const rulerStartPx = Math.max(0, rulerCenterPx - rulerSize / 2);
  const rulerEndPx = Math.min(containerDimension, rulerCenterPx + rulerSize / 2);

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
  const getTransitionStyle = (property: 'left' | 'top') =>
    shouldAnimate ? `${property} 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94)` : 'none';

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
          }}
        />

        {/* Right overlay */}
        <div
          className='bg-base-100 pointer-events-none absolute bottom-0 right-0 top-0'
          style={{
            width: `${containerSize.width - rulerEndPx}px`,
            opacity: fadeOpacity,
          }}
        />

        {/* Vertical ruler */}
        <div
          className={clsx(
            'ruler pointer-events-auto absolute bottom-0 top-0 my-2 cursor-col-resize touch-none rounded-2xl',
            color === 'transparent' ? 'border-base-content/55 border' : '',
          )}
          style={{
            left: `${currentPosition}%`,
            width: `${rulerSize}px`,
            transform: 'translateX(-50%)',
            transition: getTransitionStyle('left'),
            ...(color === 'transparent'
              ? {
                  backgroundColor: baseColor,
                }
              : backdropFilterStyle),
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {/* extended touch area */}
          <div className='absolute inset-y-0 -left-2 -right-2 touch-none' />
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
        }}
      />

      {/* Bottom overlay */}
      <div
        className='bg-base-100 pointer-events-none absolute bottom-0 left-0 right-0'
        style={{
          height: `${containerSize.height - rulerEndPx}px`,
          opacity: fadeOpacity,
        }}
      />

      {/* Horizontal ruler */}
      <div
        className={clsx(
          'ruler pointer-events-auto absolute left-0 right-0 mx-2 cursor-row-resize touch-none rounded-2xl',
          color === 'transparent' ? 'border-base-content/55 border' : '',
        )}
        style={{
          top: `${currentPosition}%`,
          height: `${rulerSize}px`,
          transform: 'translateY(-50%)',
          transition: getTransitionStyle('top'),
          ...(color === 'transparent'
            ? {
                backgroundColor: baseColor,
              }
            : backdropFilterStyle),
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* Extended touch area */}
        <div className='absolute inset-x-0 -bottom-2 -top-2 touch-none' />
      </div>
    </div>
  );
};

export default ReadingRuler;
