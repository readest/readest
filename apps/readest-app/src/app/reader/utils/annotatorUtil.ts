import { HIGHLIGHT_COLOR_HEX } from '@/services/constants';
import {
  BookNote,
  BooknoteGroup,
  DEFAULT_HIGHLIGHT_COLORS,
  HighlightColor,
  HighlightStyle,
} from '@/types/book';
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

const ALL_HIGHLIGHT_STYLES: readonly HighlightStyle[] = ['highlight', 'underline', 'squiggly'];

export interface ExportFilter {
  excludedColors: HighlightColor[];
  excludedStyles: HighlightStyle[];
}

export interface FilteredExportGroups {
  groups: BooknoteGroup[];
  distinctColors: HighlightColor[];
  distinctStyles: HighlightStyle[];
  applyColorFilter: boolean;
  applyStyleFilter: boolean;
}

/**
 * Filter chapter groups for annotation export by highlight color and style (#4801).
 *
 * Exclusions (not inclusions) are stored so an empty filter exports everything and
 * colors/styles introduced later are included by default. A dimension is only
 * filtered when at least two distinct values are present, so a filter row the user
 * cannot see can never silently drop notes. Notes without a color/style (e.g.
 * bookmarks) always pass. Groups left empty by the filter are dropped.
 *
 * `distinctColors` is ordered by the default palette first, then custom colors in
 * first-seen order; `distinctStyles` follows the canonical highlight/underline/
 * squiggly order — both drive the filter UI.
 */
export function filterExportGroups(
  groups: BooknoteGroup[],
  { excludedColors, excludedStyles }: ExportFilter,
): FilteredExportGroups {
  const colorsSeen = new Set<HighlightColor>();
  const stylesSeen = new Set<HighlightStyle>();
  for (const group of groups) {
    for (const note of group.booknotes) {
      if (note.color) colorsSeen.add(note.color);
      if (note.style) stylesSeen.add(note.style);
    }
  }

  const distinctColors = [
    ...DEFAULT_HIGHLIGHT_COLORS.filter((color) => colorsSeen.has(color)),
    ...[...colorsSeen].filter((color) => !isDefaultHighlightColor(color)),
  ];
  const distinctStyles = ALL_HIGHLIGHT_STYLES.filter((style) => stylesSeen.has(style));

  const applyColorFilter = distinctColors.length >= 2;
  const applyStyleFilter = distinctStyles.length >= 2;

  const keep = (note: BookNote) =>
    (!applyColorFilter || !note.color || !excludedColors.includes(note.color)) &&
    (!applyStyleFilter || !note.style || !excludedStyles.includes(note.style));

  const filtered = groups
    .map((group) => ({ ...group, booknotes: group.booknotes.filter(keep) }))
    .filter((group) => group.booknotes.length > 0);

  return { groups: filtered, distinctColors, distinctStyles, applyColorFilter, applyStyleFilter };
}

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
 * The "Annotate" action eagerly creates an empty highlight as the anchor for the
 * note the user is about to type, so the selection stays visible while the editor
 * is open. If the user cancels without saving, that placeholder must be torn down
 * so it doesn't leak into the booknotes list (#4791).
 *
 * Tombstones the live annotation identified by `placeholderId` in `booknotes`
 * (mutating in place, matching the surrounding highlight handlers) and returns it
 * so the caller can remove its overlay. Returns null — leaving `booknotes`
 * untouched — when there's nothing to clean up: no live annotation with that id,
 * or the record already carries note text (the user saved, so it's real now).
 */
export function removeEmptyAnnotationPlaceholder(
  booknotes: BookNote[],
  placeholderId: string,
  now: number,
): BookNote | null {
  const index = booknotes.findIndex(
    (note) =>
      note.id === placeholderId &&
      note.type === 'annotation' &&
      !note.deletedAt &&
      !note.note?.trim(),
  );
  if (index === -1) return null;
  const placeholder = booknotes[index]!;
  booknotes[index] = { ...placeholder, deletedAt: now };
  return placeholder;
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

export type AnnotationDrawKind = 'bubble' | 'highlight' | 'underline' | 'squiggly' | 'none';

/**
 * Decide what an overlay should draw for an annotation. The bubble vs.
 * highlight choice keys off the overlay's `value` prefix — NOT `annotation.note`
 * — so a single unified record draws BOTH its highlight overlay (value = cfi)
 * and its note bubble (value = `${NOTE_PREFIX}${cfi}`).
 */
export function decideAnnotationDraw(
  value: string | undefined,
  style: HighlightStyle | undefined,
): AnnotationDrawKind {
  if (value?.startsWith(NOTE_PREFIX)) return 'bubble';
  if (style === 'highlight') return 'highlight';
  if (style === 'underline' || style === 'squiggly') return style;
  return 'none';
}

/**
 * Index of the live (`!deletedAt`) annotation record at `cfi`, or -1. Used when
 * adding a note so it attaches to the existing highlight instead of creating a
 * second record at the same position.
 */
export function findAnnotationAtCfi(booknotes: BookNote[], cfi: string): number {
  return booknotes.findIndex(
    (note) => note.type === 'annotation' && note.cfi === cfi && !note.deletedAt,
  );
}

/**
 * Merge a freshly-built restyle (`restyled`, carrying the new style/color) onto
 * an `existing` annotation, preserving the parts a restyle must not lose: the
 * record id, its note text, the selected text, the original creation time, and
 * the `global` flag. Without preserving `note`, recoloring a unified annotation
 * would wipe the note.
 */
export function mergeRestyledAnnotation(existing: BookNote, restyled: BookNote): BookNote {
  return {
    ...restyled,
    id: existing.id,
    createdAt: existing.createdAt,
    note: existing.note,
    text: existing.text ?? restyled.text,
    global: existing.global || restyled.global,
  };
}
