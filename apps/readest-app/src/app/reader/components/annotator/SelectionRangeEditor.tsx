import React, { useCallback, useEffect, useRef, useState } from 'react';

import { HighlightColor } from '@/types/book';
import { Point, TextSelection } from '@/utils/sel';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import {
  buildRangeFromPoints,
  getHandlePositionsFromRange,
  getHighlightColorHex,
} from '../../utils/annotatorUtil';
import MagnifierLoupe from './MagnifierLoupe';
import { Handle } from './AnnotationRangeEditor';

interface SelectionRangeEditorProps {
  bookKey: string;
  isVertical: boolean;
  selection: TextSelection;
  handleColor: HighlightColor;
  onRangeChange: (range: Range, index: number, commit: boolean) => void;
  onStartDrag: () => void;
}

// Drag handles for a plain (not yet annotated) text selection. Used on
// Android when the native selection handles had to be suppressed because of
// the Blink hyphen selection-bounds bug (issue #1553): the DOM selection
// stays as the visible highlight while these handles replace the native
// ones for adjusting the range.
const SelectionRangeEditor: React.FC<SelectionRangeEditorProps> = ({
  bookKey,
  isVertical,
  selection,
  handleColor,
  onRangeChange,
  onStartDrag,
}) => {
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const { isDarkMode } = useThemeStore();
  const { getView, getViewSettings } = useReaderStore();
  const view = getView(bookKey);
  const viewSettings = getViewSettings(bookKey);
  const isEink = settings.globalViewSettings.isEink;
  const einkFgColor = isDarkMode ? '#ffffff' : '#000000';
  const handleColorHex = getHighlightColorHex(settings, handleColor) ?? '#FFFF00';

  const draggingRef = useRef<'start' | 'end' | null>(null);
  const startRef = useRef<Point>({ x: 0, y: 0 });
  const endRef = useRef<Point>({ x: 0, y: 0 });
  const lastBuiltRef = useRef<{ range: Range; index: number } | null>(null);
  const [draggingHandle, setDraggingHandle] = useState<'start' | 'end' | null>(null);
  const [currentStart, setCurrentStart] = useState<Point>({ x: 0, y: 0 });
  const [currentEnd, setCurrentEnd] = useState<Point>({ x: 0, y: 0 });
  const [loupePoint, setLoupePoint] = useState<Point | null>(null);

  useEffect(() => {
    if (draggingRef.current) return;
    const positions = getHandlePositionsFromRange(bookKey, selection.range, isVertical);
    if (positions) {
      setCurrentStart(positions.start);
      setCurrentEnd(positions.end);
      startRef.current = positions.start;
      endRef.current = positions.end;
      lastBuiltRef.current = { range: selection.range, index: selection.index };
    }
  }, [bookKey, selection, isVertical]);

  const updateFromPoints = useCallback(
    (startPoint: Point, endPoint: Point) => {
      const built = buildRangeFromPoints(view, startPoint, endPoint);
      if (!built) return;
      lastBuiltRef.current = { range: built.range, index: built.index };
      onRangeChange(built.range, built.index, false);
    },
    [view, onRangeChange],
  );

  const handleStartDragStart = useCallback(() => {
    draggingRef.current = 'start';
    setDraggingHandle('start');
    setLoupePoint({ ...startRef.current });
    onStartDrag();
  }, [onStartDrag]);

  const handleEndDragStart = useCallback(() => {
    draggingRef.current = 'end';
    setDraggingHandle('end');
    setLoupePoint({ ...endRef.current });
    onStartDrag();
  }, [onStartDrag]);

  const handleStartDrag = useCallback(
    (point: Point) => {
      setCurrentStart(point);
      setLoupePoint(point);
      startRef.current = point;
      updateFromPoints(point, endRef.current);
    },
    [updateFromPoints],
  );

  const handleEndDrag = useCallback(
    (point: Point) => {
      setCurrentEnd(point);
      setLoupePoint(point);
      endRef.current = point;
      updateFromPoints(startRef.current, point);
    },
    [updateFromPoints],
  );

  const handleDragEnd = useCallback(() => {
    draggingRef.current = null;
    setDraggingHandle(null);
    setLoupePoint(null);
    const last = lastBuiltRef.current;
    if (last) {
      onRangeChange(last.range, last.index, true);
    }
  }, [onRangeChange]);

  if (currentStart.x === 0 && currentStart.y === 0) {
    return null;
  }

  const showLoupe = appService?.isMobile && !viewSettings?.isEink && !viewSettings?.vertical;

  return (
    <div className='pointer-events-none fixed inset-0 z-50'>
      <Handle
        hidden={draggingHandle === 'end'}
        position={currentStart}
        isVertical={isVertical}
        type='start'
        color={isEink ? einkFgColor : handleColorHex}
        onDragStart={handleStartDragStart}
        onDrag={handleStartDrag}
        onDragEnd={handleDragEnd}
      />
      <Handle
        hidden={draggingHandle === 'start'}
        position={currentEnd}
        isVertical={isVertical}
        type='end'
        color={isEink ? einkFgColor : handleColorHex}
        onDragStart={handleEndDragStart}
        onDrag={handleEndDrag}
        onDragEnd={handleDragEnd}
      />
      {showLoupe && loupePoint && (
        <MagnifierLoupe
          bookKey={bookKey}
          dragPoint={loupePoint}
          isVertical={isVertical}
          color={handleColorHex}
        />
      )}
    </div>
  );
};

export default SelectionRangeEditor;
