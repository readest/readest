import { useCallback, useRef } from 'react';
import { BookNote } from '@/types/book';
import { Point, TextSelection } from '@/utils/sel';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { uniqueId } from '@/utils/misc';

interface UseInstantAnnotationProps {
  bookKey: string;
  getAnnotationText: (range: Range) => Promise<string>;
  setSelection: React.Dispatch<React.SetStateAction<TextSelection | null>>;
}

export const useInstantAnnotation = ({ bookKey, getAnnotationText }: UseInstantAnnotationProps) => {
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const { getConfig, saveConfig, updateBooknotes } = useBookDataStore();
  const { getView, getViewsById, getViewSettings } = useReaderStore();

  const startPointRef = useRef<Point | null>(null);
  const startDocRef = useRef<Document | null>(null);
  const startIndexRef = useRef<number>(0);
  const previewAnnotationRef = useRef<BookNote | null>(null);
  const annotationIdRef = useRef<string>(uniqueId());

  const isInstantAnnotationEnabled = useCallback(() => {
    const viewSettings = getViewSettings(bookKey);
    return (
      viewSettings?.enableAnnotationQuickActions &&
      viewSettings?.annotationQuickAction === 'highlight'
    );
  }, [bookKey, getViewSettings]);

  const clearPreviewAnnotation = useCallback(() => {
    if (previewAnnotationRef.current) {
      const views = getViewsById(bookKey.split('-')[0]!);
      views.forEach((v) => v?.addAnnotation(previewAnnotationRef.current!, true));
      previewAnnotationRef.current = null;
    }
  }, [bookKey, getViewsById]);

  const findPositionAtPoint = useCallback((doc: Document, x: number, y: number) => {
    if (doc.caretPositionFromPoint) {
      const pos = doc.caretPositionFromPoint(x, y);
      if (pos) return { node: pos.offsetNode, offset: pos.offset };
    }
    if (doc.caretRangeFromPoint) {
      const range = doc.caretRangeFromPoint(x, y);
      if (range) return { node: range.startContainer, offset: range.startOffset };
    }
    return null;
  }, []);

  const isSelectableContent = useCallback(
    (doc: Document, x: number, y: number): boolean => {
      const pos = findPositionAtPoint(doc, x, y);
      if (!pos) return false;

      // Must be a text node
      if (pos.node.nodeType !== Node.TEXT_NODE) return false;

      const textNode = pos.node as Text;
      const textLength = textNode.length;
      if (textLength === 0) return false;

      // Create a range around the caret position to get the character bounds
      const range = doc.createRange();
      try {
        // Get bounds of character at or after the caret position
        const startOffset = Math.min(pos.offset, textLength - 1);
        const endOffset = Math.min(pos.offset + 1, textLength);
        range.setStart(textNode, startOffset);
        range.setEnd(textNode, endOffset);

        const rects = range.getClientRects();
        for (const rect of rects) {
          const tolerance = 20;
          if (
            x >= rect.left - tolerance &&
            x <= rect.right + tolerance &&
            y >= rect.top - tolerance &&
            y <= rect.bottom + tolerance
          ) {
            return true;
          }
        }
      } catch {
        return false;
      }

      return false;
    },
    [findPositionAtPoint],
  );

  const createRangeFromPoints = useCallback(
    (doc: Document, startPoint: Point, endPoint: Point) => {
      const startPos = findPositionAtPoint(doc, startPoint.x, startPoint.y);
      const endPos = findPositionAtPoint(doc, endPoint.x, endPoint.y);

      if (!startPos || !endPos) return null;

      const newRange = doc.createRange();
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
          return null;
        }
        return newRange;
      } catch (e) {
        console.warn('Failed to create range:', e);
        return null;
      }
    },
    [findPositionAtPoint],
  );

  const createAnnotation = useCallback((cfi: string, text?: string) => {
    const style = settings.globalReadSettings.highlightStyle;
    const color = settings.globalReadSettings.highlightStyles[style];
    const annotation: BookNote = {
      id: annotationIdRef.current,
      type: 'annotation',
      cfi,
      style,
      color,
      text: text ?? '',
      note: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    return annotation;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInstantAnnotationPointerDown = useCallback(
    (doc: Document, index: number, ev: PointerEvent) => {
      if (!isInstantAnnotationEnabled()) return false;

      // Only handle primary button (left click / touch / stylus)
      if (ev.button !== 0) return false;

      if (!isSelectableContent(doc, ev.clientX, ev.clientY)) return false;

      startPointRef.current = { x: ev.clientX, y: ev.clientY };
      startDocRef.current = doc;
      startIndexRef.current = index;
      previewAnnotationRef.current = null;
      annotationIdRef.current = uniqueId();
      return true;
    },
    [isInstantAnnotationEnabled, isSelectableContent],
  );

  const handleInstantAnnotationPointerMove = useCallback(
    (doc: Document, index: number, ev: PointerEvent) => {
      if (!isInstantAnnotationEnabled()) return false;

      const view = getView(bookKey);
      if (!startPointRef.current || !startDocRef.current || !view) {
        return false;
      }

      const endPoint: Point = { x: ev.clientX, y: ev.clientY };
      const startPoint = startPointRef.current;

      const deltaX = Math.abs(endPoint.x - startPoint.x);
      const deltaY = Math.abs(endPoint.y - startPoint.y);
      const distance = Math.sqrt(Math.pow(deltaX, 2) + Math.pow(deltaY, 2));
      // need a longer horizontal or vertical drag to avoid accidental selections
      if (distance < 20 || (deltaX / deltaY < 5 && deltaY / deltaX < 5 && distance < 30)) {
        return false;
      }

      const newRange = createRangeFromPoints(doc, startPoint, endPoint);
      if (!newRange) return false;

      const cfi = view.getCFI(index, newRange);
      if (!cfi) return false;

      clearPreviewAnnotation();
      const annotation = createAnnotation(cfi);
      const views = getViewsById(bookKey.split('-')[0]!);
      views.forEach((v) => v?.addAnnotation(annotation));
      previewAnnotationRef.current = annotation;

      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isInstantAnnotationEnabled, createRangeFromPoints],
  );

  const handleInstantAnnotationPointerCancel = useCallback(() => {
    if (!isInstantAnnotationEnabled()) return false;

    startPointRef.current = null;
    startDocRef.current = null;
    clearPreviewAnnotation();
    return true;
  }, [isInstantAnnotationEnabled, clearPreviewAnnotation]);

  const handleInstantAnnotationPointerUp = useCallback(
    async (doc: Document, index: number, ev: PointerEvent) => {
      if (!isInstantAnnotationEnabled()) return false;

      const view = getView(bookKey);
      if (!startPointRef.current || !view) {
        startPointRef.current = null;
        startDocRef.current = null;
        clearPreviewAnnotation();
        return false;
      }

      const endPoint: Point = { x: ev.clientX, y: ev.clientY };
      const startPoint = startPointRef.current;

      startPointRef.current = null;
      startDocRef.current = null;

      const distance = Math.sqrt(
        Math.pow(endPoint.x - startPoint.x, 2) + Math.pow(endPoint.y - startPoint.y, 2),
      );
      if (distance < 10) {
        clearPreviewAnnotation();
        return false;
      }

      const newRange = createRangeFromPoints(doc, startPoint, endPoint);
      if (!newRange) {
        clearPreviewAnnotation();
        return false;
      }

      const text = await getAnnotationText(newRange);
      const cfi = view.getCFI(index, newRange);

      if (!text || !cfi || text.trim().length === 0) {
        clearPreviewAnnotation();
        return false;
      }

      clearPreviewAnnotation();
      const annotation = createAnnotation(cfi, text);
      const views = getViewsById(bookKey.split('-')[0]!);
      views.forEach((v) => v?.addAnnotation(annotation));

      const config = getConfig(bookKey)!;
      const { booknotes: annotations = [] } = config;
      const existingIndex = annotations.findIndex(
        (a) => a.cfi === cfi && a.type === 'annotation' && a.style && !a.deletedAt,
      );

      if (existingIndex !== -1) {
        annotations[existingIndex] = {
          ...annotations[existingIndex]!,
          ...annotation,
          id: annotations[existingIndex]!.id,
        };
      } else {
        annotations.push(annotation);
      }

      const updatedConfig = updateBooknotes(bookKey, annotations);
      if (updatedConfig) {
        saveConfig(envConfig, bookKey, updatedConfig, settings);
      }

      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isInstantAnnotationEnabled, createRangeFromPoints, getAnnotationText, clearPreviewAnnotation],
  );

  const cancelInstantAnnotation = useCallback(() => {
    startPointRef.current = null;
    startDocRef.current = null;
    clearPreviewAnnotation();
  }, [clearPreviewAnnotation]);

  return {
    isInstantAnnotationEnabled,
    handleInstantAnnotationPointerDown,
    handleInstantAnnotationPointerMove,
    handleInstantAnnotationPointerCancel,
    handleInstantAnnotationPointerUp,
    cancelInstantAnnotation,
  };
};
