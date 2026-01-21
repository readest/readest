import { useCallback, useRef, useState } from 'react';
import { BookNote } from '@/types/book';
import { Point, TextSelection } from '@/utils/sel';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';

interface HandlePositions {
  start: Point;
  end: Point;
}

interface UseAnnotationEditorProps {
  bookKey: string;
  annotation: BookNote;
  getAnnotationText: (range: Range) => Promise<string>;
  setSelection: React.Dispatch<React.SetStateAction<TextSelection | null>>;
}

export const useAnnotationEditor = ({
  bookKey,
  annotation,
  getAnnotationText,
  setSelection,
}: UseAnnotationEditorProps) => {
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const { getConfig, saveConfig, updateBooknotes } = useBookDataStore();
  const { getView, getViewsById } = useReaderStore();

  const view = getView(bookKey);
  const editingAnnotationRef = useRef(annotation);
  const [handlePositions, setHandlePositions] = useState<HandlePositions | null>(null);

  const getHandlePositionsFromRange = useCallback(
    (range: Range, isVertical: boolean): HandlePositions | null => {
      const gridFrame = document.querySelector(`#gridcell-${bookKey}`);
      if (!gridFrame) return null;

      const rects = Array.from(range.getClientRects());
      if (rects.length === 0) return null;

      const firstRect = rects[0]!;
      const lastRect = rects[rects.length - 1]!;
      const frameElement = range.commonAncestorContainer.ownerDocument?.defaultView?.frameElement;
      const frameRect = frameElement?.getBoundingClientRect() ?? { top: 0, left: 0 };

      return {
        start: {
          x: frameRect.left + (isVertical ? firstRect.right : firstRect.left),
          y: frameRect.top + firstRect.top,
        },
        end: {
          x: frameRect.left + (isVertical ? lastRect.left : lastRect.right),
          y: frameRect.top + lastRect.bottom,
        },
      };
    },
    [bookKey],
  );

  const handleAnnotationRangeChange = useCallback(
    async (startPoint: Point, endPoint: Point, isVertical: boolean, isDragging: boolean) => {
      if (!editingAnnotationRef.current || !view) return;

      const contents = view.renderer.getContents();
      if (!contents || contents.length === 0) return;

      // the point is from viewport, need to adjust to each content's coordinate
      const findPositionAtPoint = (doc: Document, x: number, y: number) => {
        const frameElement = doc.defaultView?.frameElement;
        const frameRect = frameElement?.getBoundingClientRect() ?? { top: 0, left: 0 };
        const adjustedX = x - frameRect.left;
        const adjustedY = y - frameRect.top;

        if (doc.caretPositionFromPoint) {
          const pos = doc.caretPositionFromPoint(adjustedX, adjustedY);
          if (pos) return { node: pos.offsetNode, offset: pos.offset };
        }
        if (doc.caretRangeFromPoint) {
          const range = doc.caretRangeFromPoint(adjustedX, adjustedY);
          if (range) return { node: range.startContainer, offset: range.startOffset };
        }
        return null;
      };

      let startPos = null;
      let endPos = null;
      let targetDoc: Document | null = null;
      let targetIndex = 0;

      for (const content of contents) {
        const { doc, index } = content;
        if (!doc) continue;

        const sp = findPositionAtPoint(doc, startPoint.x, startPoint.y);
        const ep = findPositionAtPoint(doc, endPoint.x, endPoint.y);

        if (sp && ep) {
          startPos = sp;
          endPos = ep;
          targetDoc = doc;
          targetIndex = index ?? 0;
          break;
        }
      }

      if (!startPos || !endPos || !targetDoc) return;

      const newRange = targetDoc.createRange();
      try {
        const positionComparison = startPos.node.compareDocumentPosition(endPos.node);
        const needsSwap =
          positionComparison & Node.DOCUMENT_POSITION_PRECEDING ||
          (startPos.node === endPos.node && startPos.offset > endPos.offset);

        if (needsSwap) {
          newRange.setStart(endPos.node, endPos.offset);
          newRange.setEnd(startPos.node, startPos.offset);
        } else {
          newRange.setStart(startPos.node, startPos.offset);
          newRange.setEnd(endPos.node, endPos.offset);
        }

        if (newRange.collapsed) {
          console.warn('Range is collapsed');
          return;
        }
      } catch (e) {
        console.warn('Failed to create range:', e);
        return;
      }

      const newPositions = getHandlePositionsFromRange(newRange, isVertical);
      if (newPositions) {
        setHandlePositions(newPositions);
      }

      const newCfi = view.getCFI(targetIndex, newRange);
      const newText = await getAnnotationText(newRange);

      if (newCfi && newText) {
        const config = getConfig(bookKey)!;
        const { booknotes: annotations = [] } = config;
        const existingIndex = annotations.findIndex(
          (a) => a.id === editingAnnotationRef.current.id && !a.deletedAt,
        );

        if (existingIndex !== -1) {
          const updatedAnnotation: BookNote = {
            ...annotations[existingIndex]!,
            cfi: newCfi,
            text: newText,
            updatedAt: Date.now(),
          };

          const views = getViewsById(bookKey.split('-')[0]!);
          views.forEach((v) => v?.addAnnotation(editingAnnotationRef.current, true));
          views.forEach((v) => v?.addAnnotation(updatedAnnotation));
          editingAnnotationRef.current = updatedAnnotation;

          if (!isDragging) {
            annotations[existingIndex] = updatedAnnotation;
            const updatedConfig = updateBooknotes(bookKey, annotations);
            if (updatedConfig) {
              saveConfig(envConfig, bookKey, updatedConfig, settings);
            }

            setSelection({
              key: bookKey,
              annotated: true,
              text: newText,
              cfi: newCfi,
              range: newRange,
              index: targetIndex,
            });
          }
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookKey, getHandlePositionsFromRange, getAnnotationText, setSelection],
  );

  return {
    handlePositions,
    setHandlePositions,
    getHandlePositionsFromRange,
    handleAnnotationRangeChange,
  };
};
