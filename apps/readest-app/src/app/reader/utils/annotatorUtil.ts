import { HIGHLIGHT_COLOR_HEX } from '@/services/constants';
import { BookNote, DEFAULT_HIGHLIGHT_COLORS, HighlightColor, HighlightStyle } from '@/types/book';
import { uniqueId } from '@/utils/misc';
import { SystemSettings } from '@/types/settings';
import { FoliateView, NOTE_PREFIX } from '@/types/view';
import { Point, snapRangeToWords } from '@/utils/sel';

export const isDefaultHighlightColor = (
  color: HighlightColor,
): color is (typeof DEFAULT_HIGHLIGHT_COLORS)[number] => {
  return (DEFAULT_HIGHLIGHT_COLORS as readonly string[]).includes(color);
};

export const getHighlightColorHex = (
  settings: SystemSettings,
  color?: HighlightColor,
): string | undefined => {
  if (!color) return undefined;
  if (color.startsWith('#')) return color;
  const customColors = settings.globalReadSettings.customHighlightColors;
  return customColors?.[color] ?? HIGHLIGHT_COLOR_HEX[color];
};

/**
 * Returns a user-defined label for the given color, or `undefined` when none is set.
 * Callers that want to fall back to a translated default name should handle that in
 * the component layer (where `useTranslation` is available).
 */
export const getHighlightColorLabel = (
  settings: SystemSettings,
  color: HighlightColor,
): string | undefined => {
  const { defaultHighlightLabels, userHighlightColors } = settings.globalReadSettings;
  if (color.startsWith('#')) {
    const hex = color.trim().toLowerCase();
    const entry = userHighlightColors?.find((c) => c.hex === hex);
    return entry?.label?.trim() || undefined;
  }
  if (isDefaultHighlightColor(color)) {
    return defaultHighlightLabels?.[color]?.trim() || undefined;
  }
  return undefined;
};

export function getExternalDragHandle(
  currentStart: Point,
  currentEnd: Point,
  externalDragPoint?: Point | null,
): 'start' | 'end' | null {
  if (!externalDragPoint) return null;
  const distToStart = Math.hypot(
    externalDragPoint.x - currentStart.x,
    externalDragPoint.y - currentStart.y,
  );
  const distToEnd = Math.hypot(
    externalDragPoint.x - currentEnd.x,
    externalDragPoint.y - currentEnd.y,
  );
  return distToStart < distToEnd ? 'start' : 'end';
}

export function toParentViewportPoint(doc: Document, x: number, y: number): Point {
  const frameElement = doc.defaultView?.frameElement;
  const frameRect = frameElement?.getBoundingClientRect() ?? { top: 0, left: 0 };
  return { x: x + frameRect.left, y: y + frameRect.top };
}

export interface HandlePositions {
  start: Point;
  end: Point;
}

/**
 * Window-coordinate positions for a pair of range-edit drag handles: the
 * start handle anchors at the leading edge of the range's first line rect,
 * the end handle at the trailing edge of its last one.
 */
export function getHandlePositionsFromRange(
  bookKey: string,
  range: Range,
  isVertical: boolean,
): HandlePositions | null {
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
}

/**
 * Build a word-snapped Range between two window-coordinate points by
 * hit-testing every rendered section document. Returns the document and
 * section index the range landed in, or `null` when neither point maps
 * into the same document.
 */
export function buildRangeFromPoints(
  view: FoliateView | null,
  startPoint: Point,
  endPoint: Point,
): { range: Range; index: number; doc: Document } | null {
  const contents = view?.renderer.getContents();
  if (!contents || contents.length === 0) return null;

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

  for (const content of contents) {
    const { doc, index } = content;
    if (!doc) continue;

    const startPos = findPositionAtPoint(doc, startPoint.x, startPoint.y);
    const endPos = findPositionAtPoint(doc, endPoint.x, endPoint.y);
    if (!startPos || !endPos) continue;

    const range = doc.createRange();
    try {
      const positionComparison = startPos.node.compareDocumentPosition(endPos.node);
      const needsSwap =
        positionComparison & Node.DOCUMENT_POSITION_PRECEDING ||
        (startPos.node === endPos.node && startPos.offset > endPos.offset);

      if (needsSwap) {
        range.setStart(endPos.node, endPos.offset);
        range.setEnd(startPos.node, startPos.offset);
      } else {
        range.setStart(startPos.node, startPos.offset);
        range.setEnd(endPos.node, endPos.offset);
      }

      if (range.collapsed) {
        return null;
      }

      snapRangeToWords(range);
    } catch (e) {
      console.warn('Failed to create range:', e);
      return null;
    }
    return { range, index: index ?? 0, doc };
  }
  return null;
}

/**
 * Remove any overlays drawn for a BookNote from the given view.
 *
 * A single BookNote can have up to two overlays attached:
 *   - a highlight/underline/squiggly overlay (keyed by the raw CFI)
 *   - a note bubble overlay (keyed by `${NOTE_PREFIX}${cfi}`)
 *
 * The set of overlays drawn is defined by the progress-sync effect in
 * Annotator.tsx, and this helper mirrors those filters so that deleting
 * an annotation from the sidebar clears every overlay that was drawn
 * for it, not just the note bubble.
 */
export function removeBookNoteOverlays(view: FoliateView | null, note: BookNote): void {
  if (!view) return;
  if (note.type !== 'annotation') return;
  if (note.style) {
    view.addAnnotation({ ...note, value: note.cfi }, true);
  }
  if (note.note && note.note.trim().length > 0) {
    view.addAnnotation({ ...note, value: `${NOTE_PREFIX}${note.cfi}` }, true);
  }
}

/**
 * Build a persistent highlight BookNote for a TTS-spoken sentence, or return
 * `null` when one already exists at the same CFI (idempotent — pressing the
 * hotkey twice on the same sentence must not create a duplicate).
 *
 * `now` is injected so the result is deterministic for tests. A soft-deleted
 * note (`deletedAt`) or a non-annotation note (e.g. a bookmark) at the same CFI
 * does not block creation — it mirrors the live-annotation predicate used by
 * the selection-based highlight path in Annotator.tsx.
 */
export function buildTTSSentenceHighlight(
  annotations: BookNote[],
  params: {
    cfi: string;
    text: string;
    style: HighlightStyle;
    color: HighlightColor;
    page?: number;
  },
  now: number,
): BookNote | null {
  const exists = annotations.some(
    (a) => a.cfi === params.cfi && a.type === 'annotation' && a.style && !a.deletedAt,
  );
  if (exists) return null;
  return {
    id: uniqueId(),
    type: 'annotation',
    note: '',
    createdAt: now,
    updatedAt: now,
    ...params,
  };
}
