import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { BookNote, HighlightColor } from '@/types/book';
import { Point, TextSelection } from '@/utils/sel';
import { useThemeStore } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useAnnotationEditor } from '../../hooks/useAnnotationEditor';
import { getHighlightColorHex } from '../../utils/annotatorUtil';

interface HandleProps {
  position: Point;
  isVertical: boolean;
  type: 'start' | 'end';
  color: string;
  onDragStart: () => void;
  onDrag: (point: Point) => void;
  onDragEnd: () => void;
}

const Handle: React.FC<HandleProps> = ({
  position,
  isVertical,
  type,
  color,
  onDragStart,
  onDrag,
  onDragEnd,
}) => {
  const isDragging = useRef(false);
  const size = useResponsiveSize(24);
  const circleRadius = useResponsiveSize(8);
  const stemHeight = useResponsiveSize(12);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      isDragging.current = true;
      onDragStart();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [onDragStart],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return;
      e.preventDefault();
      e.stopPropagation();
      onDrag({ x: e.clientX, y: e.clientY });
    },
    [onDrag],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return;
      e.preventDefault();
      e.stopPropagation();
      isDragging.current = false;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      onDragEnd();
    },
    [onDragEnd],
  );

  return (
    <div
      className='pointer-events-auto absolute z-50 cursor-grab touch-none active:cursor-grabbing'
      style={{
        left: isVertical
          ? type === 'start'
            ? position.x - size / 2 + stemHeight / 4
            : position.x - size / 2
          : position.x - size / 2,
        top: isVertical
          ? type === 'start'
            ? position.y - size + stemHeight / 2
            : position.y - size / 2 - stemHeight / 2
          : type === 'start'
            ? position.y - size
            : position.y - size / 2 - stemHeight / 8,
        width: size,
        height: size + stemHeight,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <svg
        width={size}
        height={size + stemHeight}
        viewBox={`0 0 ${size} ${size + stemHeight}`}
        className={clsx(type === 'start' && 'rotate-180')}
        style={{
          transform: isVertical
            ? type === 'start'
              ? 'rotate(270deg)'
              : 'rotate(90deg)'
            : type === 'start'
              ? 'rotate(180deg)'
              : undefined,
        }}
      >
        {/* Stem/line */}
        <line
          x1={size / 2}
          y1={0}
          x2={size / 2}
          y2={stemHeight}
          stroke={color}
          strokeWidth={2}
          strokeLinecap='round'
        />
        {/* Circle handle */}
        <circle cx={size / 2} cy={stemHeight + circleRadius} r={circleRadius} fill={color} />
      </svg>
    </div>
  );
};

interface AnnotationRangeEditorProps {
  bookKey: string;
  isVertical: boolean;
  annotation: BookNote;
  selection: TextSelection;
  handleColor: HighlightColor;
  getAnnotationText: (range: Range) => Promise<string>;
  setSelection: React.Dispatch<React.SetStateAction<TextSelection | null>>;
  onStartEdit: () => void;
}

const AnnotationRangeEditor: React.FC<AnnotationRangeEditorProps> = ({
  bookKey,
  isVertical,
  annotation,
  selection,
  handleColor,
  getAnnotationText,
  setSelection,
  onStartEdit,
}) => {
  const { settings } = useSettingsStore();
  const { isDarkMode } = useThemeStore();
  const isEink = settings.globalViewSettings.isEink;
  const einkFgColor = isDarkMode ? '#ffffff' : '#000000';
  const { handlePositions, getHandlePositionsFromRange, handleAnnotationRangeChange } =
    useAnnotationEditor({ bookKey, annotation, getAnnotationText, setSelection });

  const initializedRef = useRef(false);
  const handleColorHex = getHighlightColorHex(settings, handleColor) ?? '#FFFF00';
  const draggingRef = useRef<'start' | 'end' | null>(null);
  const startRef = useRef<Point>({ x: 0, y: 0 });
  const endRef = useRef<Point>({ x: 0, y: 0 });
  const [currentStart, setCurrentStart] = useState<Point>({ x: 0, y: 0 });
  const [currentEnd, setCurrentEnd] = useState<Point>({ x: 0, y: 0 });

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const range = selection.range;
    const positions = getHandlePositionsFromRange(range, isVertical);
    if (positions) {
      setTimeout(() => {
        setCurrentStart(positions.start);
        setCurrentEnd(positions.end);
      }, 0);
      startRef.current = positions.start;
      endRef.current = positions.end;
    }
  }, [annotation, selection, isVertical, getHandlePositionsFromRange]);

  useEffect(() => {
    if (!handlePositions || draggingRef.current) return;
    setTimeout(() => {
      setCurrentStart(handlePositions.start);
      setCurrentEnd(handlePositions.end);
    }, 0);
    startRef.current = handlePositions.start;
    endRef.current = handlePositions.end;
  }, [handlePositions]);

  const handleStartDragStart = useCallback(() => {
    draggingRef.current = 'start';
    onStartEdit();
  }, [onStartEdit]);

  const handleEndDragStart = useCallback(() => {
    draggingRef.current = 'end';
    onStartEdit();
  }, [onStartEdit]);

  const handleStartDrag = useCallback(
    (point: Point) => {
      setCurrentStart(point);
      startRef.current = point;
      handleAnnotationRangeChange(point, endRef.current, isVertical, true);
    },
    [isVertical, handleAnnotationRangeChange],
  );

  const handleEndDrag = useCallback(
    (point: Point) => {
      setCurrentEnd(point);
      endRef.current = point;
      handleAnnotationRangeChange(startRef.current, point, isVertical, true);
    },
    [isVertical, handleAnnotationRangeChange],
  );

  const handleDragEnd = useCallback(() => {
    draggingRef.current = null;
    handleAnnotationRangeChange(startRef.current, endRef.current, isVertical, false);
  }, [isVertical, handleAnnotationRangeChange]);

  if (currentStart.x === 0 && currentStart.y === 0) {
    return null;
  }

  return (
    <div className='pointer-events-none fixed inset-0 z-50'>
      <Handle
        position={currentStart}
        isVertical={isVertical}
        type='start'
        color={isEink ? einkFgColor : handleColorHex}
        onDragStart={handleStartDragStart}
        onDrag={handleStartDrag}
        onDragEnd={handleDragEnd}
      />
      <Handle
        position={currentEnd}
        isVertical={isVertical}
        type='end'
        color={isEink ? einkFgColor : handleColorHex}
        onDragStart={handleEndDragStart}
        onDrag={handleEndDrag}
        onDragEnd={handleDragEnd}
      />
    </div>
  );
};

export default AnnotationRangeEditor;
