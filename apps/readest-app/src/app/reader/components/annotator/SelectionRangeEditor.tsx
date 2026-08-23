import React, { useCallback, useEffect, useRef, useState } from 'react';

import { HighlightColor } from '@/types/book';
import { Point, TextSelection } from '@/utils/sel';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { getHandlePositionsFromRange, getHighlightColorHex } from '../../utils/annotatorUtil';
import { SectionAnchor, SelectionBounds } from '../../utils/crossDocSelection';
import MagnifierLoupe from './MagnifierLoupe';
import { Handle } from './AnnotationRangeEditor';

interface SelectionRangeEditorProps {
  bookKey: string;
  isVertical: boolean;
  selection: TextSelection;
  handleColor: HighlightColor;
  // Rebuild the selection between the fixed `anchor` and the dragged `point`
  // (window coords), committing it when the drag ends; resolves to the
  // selection's new outer bounds.
  onDragTo: (
    anchor: SectionAnchor,
    point: Point,
    commit: boolean,
  ) => Promise<SelectionBounds | null>;
  onStartDrag: () => void;
  noteAutoTurnPoint: (point: Point | null) => void;
  cancelAutoTurn: () => void;
  onAutoTurn: (cb: () => void) => () => void;
}

// The outer ends of a (possibly cross-page, #5809) selection as DOM-anchored
// section positions, so a handle drag keeps the far end in place.
const boundsOfSelection = (selection: TextSelection): SelectionBounds | null => {
  const first = selection.segments?.[0] ?? selection;
  const last = selection.segments?.at(-1) ?? selection;
  const startDoc = first.range.startContainer.ownerDocument;
  const endDoc = last.range.endContainer.ownerDocument;
  if (!startDoc || !endDoc) return null;
  return {
    start: {
      doc: startDoc,
      index: first.index,
      pos: { node: first.range.startContainer, offset: first.range.startOffset },
    },
    end: {
      doc: endDoc,
      index: last.index,
      pos: { node: last.range.endContainer, offset: last.range.endOffset },
    },
  };
};

// Drag handles for a plain (not yet annotated) text selection. Used on
// Android when the native selection handles had to be suppressed because of
// the Blink hyphen selection-bounds bug (issue #1553), and for fixed-layout
// pages in scroll mode, where a native handle can't leave its page iframe but
// these can continue the selection onto the next page (#5809): the DOM
// selection stays as the visible highlight while these handles replace the
// native ones for adjusting the range.
const SelectionRangeEditor: React.FC<SelectionRangeEditorProps> = ({
  bookKey,
  isVertical,
  selection,
  handleColor,
  onDragTo,
  onStartDrag,
  noteAutoTurnPoint,
  cancelAutoTurn,
  onAutoTurn,
}) => {
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const { isDarkMode } = useThemeStore();
  const { getViewSettings } = useReaderStore();
  const viewSettings = getViewSettings(bookKey);
  const isEink = settings.globalViewSettings.isEink;
  const einkFgColor = isDarkMode ? '#ffffff' : '#000000';
  const handleColorHex = getHighlightColorHex(settings, handleColor) ?? '#FFFF00';

  const draggingRef = useRef<'start' | 'end' | null>(null);
  const startRef = useRef<Point>({ x: 0, y: 0 });
  const endRef = useRef<Point>({ x: 0, y: 0 });
  const boundsRef = useRef<SelectionBounds | null>(null);
  // Unsubscribe for the after-turn re-emit while a handle is being dragged.
  const autoTurnUnsubRef = useRef<(() => void) | null>(null);
  const [draggingHandle, setDraggingHandle] = useState<'start' | 'end' | null>(null);
  const [currentStart, setCurrentStart] = useState<Point>({ x: 0, y: 0 });
  const [currentEnd, setCurrentEnd] = useState<Point>({ x: 0, y: 0 });
  const [loupePoint, setLoupePoint] = useState<Point | null>(null);

  useEffect(() => {
    if (draggingRef.current) return;
    // A cross-page selection's ends live on different pages: the start handle
    // on the first part, the end handle on the last.
    const first = selection.segments?.[0]?.range ?? selection.range;
    const last = selection.segments?.at(-1)?.range ?? selection.range;
    const start = getHandlePositionsFromRange(bookKey, first, isVertical)?.start;
    const end = getHandlePositionsFromRange(bookKey, last, isVertical)?.end;
    if (start && end) {
      setCurrentStart(start);
      setCurrentEnd(end);
      startRef.current = start;
      endRef.current = end;
      boundsRef.current = boundsOfSelection(selection);
    }
  }, [bookKey, selection, isVertical]);

  // The non-dragged end is anchored as a DOM position captured at drag start.
  // Anchoring it to its window coordinate instead would silently re-target it
  // whenever the content shifts underneath — e.g. the corner-dwell auto page
  // turn (#1354) mid-drag — losing the previous page's part of the selection.
  const fixedAnchorRef = useRef<SectionAnchor | null>(null);

  const updateFromDraggedPoint = useCallback(
    (point: Point, commit = false) => {
      const anchor = fixedAnchorRef.current;
      if (!anchor) return;
      void onDragTo(anchor, point, commit).then((bounds) => {
        if (bounds) boundsRef.current = bounds;
      });
      // Drag the handle into the corner to turn the page; the anchored end keeps
      // the previous page's part of the selection across the turn.
      if (!commit) noteAutoTurnPoint(viewSettings?.scrolled ? null : point);
    },
    [onDragTo, noteAutoTurnPoint, viewSettings?.scrolled],
  );

  // Rebuild the range from the held handle position after an auto page-turn, so
  // the selection extends onto the new page without waiting for the next move.
  const subscribeAutoTurnReemit = useCallback(() => {
    autoTurnUnsubRef.current?.();
    autoTurnUnsubRef.current = onAutoTurn(() => {
      const point = draggingRef.current === 'start' ? startRef.current : endRef.current;
      updateFromDraggedPoint(point);
    });
  }, [onAutoTurn, updateFromDraggedPoint]);

  const handleStartDragStart = useCallback(() => {
    fixedAnchorRef.current = (boundsRef.current ?? boundsOfSelection(selection))?.end ?? null;
    draggingRef.current = 'start';
    setDraggingHandle('start');
    setLoupePoint({ ...startRef.current });
    subscribeAutoTurnReemit();
    onStartDrag();
  }, [selection, onStartDrag, subscribeAutoTurnReemit]);

  const handleEndDragStart = useCallback(() => {
    fixedAnchorRef.current = (boundsRef.current ?? boundsOfSelection(selection))?.start ?? null;
    draggingRef.current = 'end';
    setDraggingHandle('end');
    setLoupePoint({ ...endRef.current });
    subscribeAutoTurnReemit();
    onStartDrag();
  }, [selection, onStartDrag, subscribeAutoTurnReemit]);

  const handleStartDrag = useCallback(
    (point: Point) => {
      setCurrentStart(point);
      setLoupePoint(point);
      startRef.current = point;
      updateFromDraggedPoint(point);
    },
    [updateFromDraggedPoint],
  );

  const handleEndDrag = useCallback(
    (point: Point) => {
      setCurrentEnd(point);
      setLoupePoint(point);
      endRef.current = point;
      updateFromDraggedPoint(point);
    },
    [updateFromDraggedPoint],
  );

  const handleDragEnd = useCallback(() => {
    const point = draggingRef.current === 'start' ? startRef.current : endRef.current;
    draggingRef.current = null;
    setDraggingHandle(null);
    setLoupePoint(null);
    cancelAutoTurn();
    autoTurnUnsubRef.current?.();
    autoTurnUnsubRef.current = null;
    updateFromDraggedPoint(point, true);
  }, [updateFromDraggedPoint, cancelAutoTurn]);

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
