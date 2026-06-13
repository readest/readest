import type { AnnotationToolType } from '@/types/annotator';

// Canonical order of every annotation tool. Kept in sync with
// `annotationToolButtons` in AnnotationTools.tsx (asserted by a unit test).
export const ALL_ANNOTATION_TOOL_TYPES: AnnotationToolType[] = [
  'copy',
  'highlight',
  'annotate',
  'search',
  'dictionary',
  'translate',
  'tts',
  'proofread',
  'share',
];

// Default toolbar: the eight pre-existing tools in their original order.
// 'share' starts hidden in the Available tray per the #4014 design.
export const DEFAULT_ANNOTATION_TOOLBAR_ITEMS: AnnotationToolType[] = [
  'copy',
  'highlight',
  'annotate',
  'search',
  'dictionary',
  'translate',
  'tts',
  'proofread',
];

// Drop unknown/duplicate entries; fall back to the default when unset (a
// pre-existing per-book config may not carry the field yet).
const sanitize = (items: AnnotationToolType[] | undefined): AnnotationToolType[] => {
  const source = items ?? DEFAULT_ANNOTATION_TOOLBAR_ITEMS;
  const seen = new Set<AnnotationToolType>();
  const out: AnnotationToolType[] = [];
  for (const type of source) {
    if (ALL_ANNOTATION_TOOL_TYPES.includes(type) && !seen.has(type)) {
      seen.add(type);
      out.push(type);
    }
  }
  return out;
};

// Visible tools to render in the live selection toolbar, in order.
export const getToolbarToolTypes = (
  items: AnnotationToolType[] | undefined,
  canShare: boolean,
): AnnotationToolType[] => sanitize(items).filter((type) => canShare || type !== 'share');

// Hidden tools (the "Available" tray), in canonical order.
export const getAvailableToolTypes = (
  items: AnnotationToolType[] | undefined,
  canShare: boolean,
): AnnotationToolType[] => {
  const visible = new Set(sanitize(items));
  return ALL_ANNOTATION_TOOL_TYPES.filter(
    (type) => !visible.has(type) && (canShare || type !== 'share'),
  );
};

// Add `type` to the visible list at `atIndex` (default: end). No-op if present.
export const addToolToToolbar = (
  visible: AnnotationToolType[],
  type: AnnotationToolType,
  atIndex?: number,
): AnnotationToolType[] => {
  if (visible.includes(type)) return visible;
  const next = [...visible];
  next.splice(atIndex ?? next.length, 0, type);
  return next;
};

// Remove `type` from the visible list. No-op if absent.
export const removeToolFromToolbar = (
  visible: AnnotationToolType[],
  type: AnnotationToolType,
): AnnotationToolType[] => visible.filter((type_) => type_ !== type);

// Move `fromType` to where `toType` currently sits within the visible list.
export const reorderToolbar = (
  visible: AnnotationToolType[],
  fromType: AnnotationToolType,
  toType: AnnotationToolType,
): AnnotationToolType[] => {
  const from = visible.indexOf(fromType);
  const to = visible.indexOf(toType);
  if (from < 0 || to < 0 || from === to) return visible;
  const next = [...visible];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
};
