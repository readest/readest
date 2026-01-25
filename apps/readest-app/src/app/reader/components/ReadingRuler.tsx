import React, { useCallback, useRef, useState, useEffect } from 'react';
import { Insets } from '@/types/misc';
import { BookFormat, FIXED_LAYOUT_FORMATS, ViewSettings } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { saveViewSettings } from '@/helpers/settings';
import { READING_RULER_COLORS } from '@/services/constants';

interface ReadingRulerProps {
  bookKey: string;
  lines: number;
  position: number;
  opacity: number;
  color: keyof typeof READING_RULER_COLORS;
  bookFormat: BookFormat;
  viewSettings: ViewSettings;
  gridInsets: Insets;
}

const FIXED_LAYOUT_LINE_HEIGHT = 28;

const calculateRulerHeight = (
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
  const isDragging = useRef(false);

  const height = calculateRulerHeight(lines, viewSettings, bookFormat);
  const baseColor = READING_RULER_COLORS[color] || READING_RULER_COLORS['yellow'];

  useEffect(() => {
    setCurrentPosition(position);
  }, [position]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current || !containerRef.current) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = containerRef.current.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;
    const newPosition = Math.max(0, Math.min(100, (relativeY / rect.height) * 100));
    setCurrentPosition(newPosition);
  }, []);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return;
      isDragging.current = false;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      saveViewSettings(envConfig, bookKey, 'readingRulerPosition', currentPosition, false, false);
    },
    [envConfig, bookKey, currentPosition],
  );

  const topOffset = gridInsets.top;
  const bottomOffset = gridInsets.bottom;

  return (
    <div
      ref={containerRef}
      className='pointer-events-none absolute inset-0 z-[5]'
      style={{
        top: `${topOffset}px`,
        bottom: `${bottomOffset}px`,
      }}
    >
      <div
        className='pointer-events-auto absolute left-0 right-0 cursor-row-resize transition-shadow active:shadow-lg'
        style={{
          top: `${currentPosition}%`,
          height: `${height}px`,
          backgroundColor: baseColor,
          opacity: opacity,
          transform: 'translateY(-50%)',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* extended touch area */}
        <div className='absolute inset-x-0 -bottom-2 -top-2' />
      </div>
    </div>
  );
};

export default ReadingRuler;
