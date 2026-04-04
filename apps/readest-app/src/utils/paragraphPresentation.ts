import { ViewSettings } from '@/types/book';

export type ParagraphNavAction = 'next' | 'prev';
export type ParagraphNavDirection = 'left' | 'right' | 'up' | 'down';
export type ParagraphNavZone = 'left' | 'right' | 'top' | 'bottom';

export interface ParagraphPresentation {
  lang?: string;
  dir: 'ltr' | 'rtl';
  writingMode: string;
  textOrientation?: string;
  unicodeBidi?: string;
  textAlign?: string;
  vertical: boolean;
  rtl: boolean;
}

type ParagraphLayoutSource =
  | Pick<ViewSettings, 'vertical' | 'rtl' | 'writingMode'>
  | Partial<ParagraphPresentation>
  | null
  | undefined;

const getRangeElement = (range: Range | null | undefined): Element | null => {
  if (!range) return null;

  const { startContainer, commonAncestorContainer } = range;
  if (startContainer.nodeType === Node.ELEMENT_NODE) {
    return startContainer as Element;
  }

  return (
    (startContainer.parentElement ?? null) ||
    (commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (commonAncestorContainer as Element)
      : null)
  );
};

const getClosestAttribute = (element: Element | null, attribute: string): string | undefined => {
  const value = element?.closest?.(`[${attribute}]`)?.getAttribute(attribute) ?? undefined;
  return value?.trim() || undefined;
};

const normalizeDirection = (direction?: string | null): 'ltr' | 'rtl' | undefined => {
  if (direction === 'rtl') return 'rtl';
  if (direction === 'ltr') return 'ltr';
  return undefined;
};

const pickFirst = (...values: Array<string | null | undefined>): string | undefined => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
};

export const getParagraphLayoutContext = (source?: ParagraphLayoutSource) => {
  const writingMode = source?.writingMode || 'horizontal-tb';
  const vertical = source?.vertical || writingMode.includes('vertical') || false;
  const rtl = source?.rtl || writingMode.endsWith('-rl') || false;

  return {
    writingMode,
    vertical,
    rtl,
  };
};

export const getParagraphPresentation = (
  doc: Document | null | undefined,
  range: Range | null | undefined,
  viewSettings?: ParagraphLayoutSource,
): ParagraphPresentation => {
  const fallback = getParagraphLayoutContext(viewSettings);
  const element = getRangeElement(range);
  const body = doc?.body ?? null;
  const root = doc?.documentElement ?? null;
  const view = doc?.defaultView ?? null;
  const elementStyle = element && view ? view.getComputedStyle(element) : null;
  const bodyStyle = body && view ? view.getComputedStyle(body) : null;
  const rootStyle = root && view ? view.getComputedStyle(root) : null;

  const writingMode =
    pickFirst(
      elementStyle?.writingMode,
      bodyStyle?.writingMode,
      rootStyle?.writingMode,
      fallback.writingMode,
    ) || 'horizontal-tb';
  const vertical = writingMode.includes('vertical') || fallback.vertical;
  const dir =
    normalizeDirection(
      pickFirst(
        getClosestAttribute(element, 'dir'),
        body?.dir,
        root?.dir,
        elementStyle?.direction,
        bodyStyle?.direction,
        rootStyle?.direction,
        fallback.rtl ? 'rtl' : 'ltr',
      ),
    ) || 'ltr';
  const rtl = dir === 'rtl' || writingMode.endsWith('-rl') || fallback.rtl;

  return {
    lang: pickFirst(getClosestAttribute(element, 'lang'), root?.lang, body?.lang),
    dir,
    writingMode,
    textOrientation: pickFirst(elementStyle?.textOrientation, bodyStyle?.textOrientation),
    unicodeBidi: pickFirst(elementStyle?.unicodeBidi, bodyStyle?.unicodeBidi),
    textAlign: pickFirst(elementStyle?.textAlign, bodyStyle?.textAlign),
    vertical,
    rtl,
  };
};

export const getParagraphButtonDirections = (
  source?: ParagraphLayoutSource,
): Record<ParagraphNavAction, ParagraphNavDirection> => {
  const layout = getParagraphLayoutContext(source);
  if (layout.vertical) {
    return { prev: 'up', next: 'down' };
  }

  return layout.rtl ? { prev: 'right', next: 'left' } : { prev: 'left', next: 'right' };
};

export const getParagraphActionForZone = (
  zone: ParagraphNavZone,
  source?: ParagraphLayoutSource,
): ParagraphNavAction | null => {
  const layout = getParagraphLayoutContext(source);

  if (layout.vertical) {
    if (zone === 'top') return 'prev';
    if (zone === 'bottom') return 'next';
    return null;
  }

  if (zone === 'left') return layout.rtl ? 'next' : 'prev';
  if (zone === 'right') return layout.rtl ? 'prev' : 'next';
  return null;
};

export const getParagraphActionForKey = (
  key: string,
  source?: ParagraphLayoutSource,
): ParagraphNavAction | null => {
  const layout = getParagraphLayoutContext(source);

  if (key === ' ' || key.toLowerCase() === 'j') return 'next';
  if (key.toLowerCase() === 'k') return 'prev';

  if (layout.vertical) {
    if (key === 'ArrowDown') return 'next';
    if (key === 'ArrowUp') return 'prev';
    if (key === 'ArrowLeft') return layout.writingMode.endsWith('-rl') ? 'next' : 'prev';
    if (key === 'ArrowRight') return layout.writingMode.endsWith('-rl') ? 'prev' : 'next';
    return null;
  }

  if (key === 'ArrowDown') return 'next';
  if (key === 'ArrowUp') return 'prev';
  if (key === 'ArrowLeft') return layout.rtl ? 'next' : 'prev';
  if (key === 'ArrowRight') return layout.rtl ? 'prev' : 'next';
  return null;
};
