import clsx from 'clsx';
import React, { useCallback, useRef, useState, useEffect } from 'react';
import { Insets } from '@/types/misc';
import { BookFormat, FIXED_LAYOUT_FORMATS, ViewSettings } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { saveViewSettings } from '@/helpers/settings';
import { READING_RULER_COLORS } from '@/services/constants';

interface ReadingRulerProps {
  bookKey: string;
  isVertical: boolean;
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
  lines,
  position,
  opacity,
  color,
  bookFormat,
  viewSettings,
  gridInsets,
}) => {
  const { envConfig } = useEnv();
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentPosition, setCurrentPosition] = useState(position);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const isDragging = useRef(false);

  const rulerSize = calculateRulerSize(lines, viewSettings, bookFormat);
  const baseColor = READING_RULER_COLORS[color] || READING_RULER_COLORS['yellow'];

  useEffect(() => {
    setCurrentPosition(position);
  }, [position]);

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

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
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
        newPosition = Math.max(0, Math.min(100, (relativeX / rect.width) * 100));
      } else {
        const relativeY = e.clientY - rect.top;
        newPosition = Math.max(0, Math.min(100, (relativeY / rect.height) * 100));
      }
      setCurrentPosition(newPosition);
    },
    [isVertical],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return;
      isDragging.current = false;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      saveViewSettings(envConfig, bookKey, 'readingRulerPosition', currentPosition, false, false);
    },
    [envConfig, bookKey, currentPosition],
  );

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

  // Insets based on orientation
  const containerStyle = isVertical
    ? { left: `${gridInsets.left}px`, right: `${gridInsets.right}px` }
    : { top: `${gridInsets.top}px`, bottom: `${gridInsets.bottom}px` };

  const backdropFilterStyle = {
    backdropFilter: cssFilter,
    WebkitBackdropFilter: cssFilter,
  };

  if (isVertical) {
    // Vertical ruler (for vertical writing mode - moves left/right)
    return (
      <div
        ref={containerRef}
        className='pointer-events-none absolute inset-0 z-[5]'
        style={containerStyle}
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
            'ruler pointer-events-auto absolute bottom-0 top-0 my-2 cursor-col-resize rounded-2xl',
            color === 'transparent' ? 'border-base-content/55 border' : '',
          )}
          style={{
            left: `${currentPosition}%`,
            width: `${rulerSize}px`,
            transform: 'translateX(-50%)',
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
          <div className='absolute inset-y-0 -left-2 -right-2' />
        </div>
      </div>
    );
  }

  // Horizontal ruler (default - moves up/down)
  return (
    <div
      ref={containerRef}
      className='pointer-events-none absolute inset-0 z-[5]'
      style={containerStyle}
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
          'ruler pointer-events-auto absolute left-0 right-0 mx-2 cursor-row-resize rounded-2xl',
          color === 'transparent' ? 'border-base-content/55 border' : '',
        )}
        style={{
          top: `${currentPosition}%`,
          height: `${rulerSize}px`,
          transform: 'translateY(-50%)',
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
        <div className='absolute inset-x-0 -bottom-2 -top-2' />
      </div>
    </div>
  );
};

export default ReadingRuler;
