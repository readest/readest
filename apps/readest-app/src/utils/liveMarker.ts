import { Overlayer } from 'foliate-js/overlayer.js';
import { FoliateView } from '@/types/view';

/** Shared overlay slot for the live reading marker (TTS and audiobook sync share this). */
export const LIVE_MARKER_KEY = 'tts-highlight';

type LiveMarkerStyle = 'highlight' | 'underline' | 'strikethrough' | 'squiggly' | 'outline';

interface LiveMarkerOptions {
  style: LiveMarkerStyle;
  color: string;
}

interface ScrollSettings {
  showHeader: boolean;
  showFooter: boolean;
  showBarsOnScroll: boolean;
  scrollingOverlap: number;
}

export type MarkerResult =
  | { status: 'applied' }
  | { status: 'wrong-section'; cfiSectionIndex: number }
  | { status: 'error' };

/**
 * Resolves a CFI to a DOM Range, stamps the live reading marker overlay onto
 * it, and scrolls the view to keep it visible.  Both TTS and audiobook sync
 * call this so exactly one marker is ever shown at a time.
 *
 * Returns a status so callers can handle section mismatches:
 * - 'applied' — marker was placed in the current visible section
 * - 'wrong-section' — the CFI belongs to a different section; caller should
 *   navigate there first
 * - 'error' — the CFI could not be resolved
 */
export function applyLiveMarker(
  view: FoliateView,
  cfi: string,
  options: LiveMarkerOptions,
  scrollSettings: ScrollSettings,
): MarkerResult {
  const contents = view.renderer.getContents();
  const primaryIndex = view.renderer.primaryIndex;
  const content = (contents.find((x) => x.index === primaryIndex) ?? contents[0]) as
    | { doc: Document; index?: number; overlayer?: unknown }
    | undefined;
  if (!content) return { status: 'error' };

  const { doc, index: viewSectionIndex, overlayer } = content;

  let anchor: (doc: Document) => Range;
  let cfiSectionIndex: number;
  try {
    ({ anchor, index: cfiSectionIndex } = view.resolveCFI(cfi));
  } catch {
    return { status: 'error' };
  }

  if (viewSectionIndex !== cfiSectionIndex) {
    return { status: 'wrong-section', cfiSectionIndex };
  }

  const range = anchor(doc);
  const { style, color } = options;
  (overlayer as Overlayer | undefined)?.remove(LIVE_MARKER_KEY);
  (overlayer as Overlayer | undefined)?.add(LIVE_MARKER_KEY, range, Overlayer[style], { color });

  if (!view.renderer.scrolled) {
    view.renderer.scrollToAnchor?.(range);
  } else {
    const rect = range.getBoundingClientRect();
    const { start, end, sideProp } = view.renderer;
    const rangeTop = rect[sideProp === 'height' ? 'y' : 'x'];
    const rangeBottom = rangeTop + rect[sideProp === 'height' ? 'height' : 'width'];
    const { showHeader, showFooter, showBarsOnScroll, scrollingOverlap } = scrollSettings;
    const headerScrollOverlap = showHeader && showBarsOnScroll ? 44 : 0;
    const footerScrollOverlap = showFooter && showBarsOnScroll ? 44 : 0;
    const outOfView =
      rangeBottom > end - footerScrollOverlap - scrollingOverlap ||
      rangeTop < start + headerScrollOverlap + scrollingOverlap;
    if (outOfView) {
      view.renderer.scrollToAnchor?.(range);
    }
  }

  return { status: 'applied' };
}

/** Removes the live reading marker from the primary view content. */
export function clearLiveMarker(view: FoliateView): void {
  const contents = view.renderer.getContents();
  const primaryIndex = view.renderer.primaryIndex;
  const content = (contents.find((x) => x.index === primaryIndex) ?? contents[0]) as
    | { overlayer?: unknown }
    | undefined;
  (content?.overlayer as Overlayer | undefined)?.remove(LIVE_MARKER_KEY);
}
