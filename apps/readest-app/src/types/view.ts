import { BookDoc, TOCItem } from '@/libs/document';
import { BookNote, BookSearchConfig, BookSearchResult } from '@/types/book';
import { TTSGranularity } from '@/services/tts';
import { TTS } from 'foliate-js/tts.js';
import type { MediaOverlayTTS } from '@/services/tts/mediaOverlay/MediaOverlayTTS';
import { LocaleWithTextInfo } from './misc';

// The mark source driving Read Aloud: foliate's text segmentation for
// synthesized speech, or the book's own Media Overlay pars when playing its
// recorded narration. Both expose the same navigation surface.
export type ViewTTS = TTS | MediaOverlayTTS;

export const NOTE_PREFIX = 'foliate-note:';

type RangeAnchor = (doc: Document) => Range;

export interface Renderer extends HTMLElement {
  scrolled?: boolean;
  scrollLocked: boolean;
  size: number; // current page height
  viewSize: number; // whole document view height
  start: number;
  end: number;
  page: number; // section page index (0-based)
  pages: number; // section page count
  atStart: boolean;
  atEnd: boolean;
  containerPosition: number;
  getPageTurnKey?: (delta?: number) => string | null;
  /** Retained fixed-layout views: prepare, scrub and settle without snapshots. */
  preparePageTurn?: (forward: boolean) => Promise<boolean>;
  beginPageTurn?: (forward: boolean) => Promise<boolean>;
  movePageTurn?: (progress: number) => void;
  endPageTurn?: (commit: boolean, duration?: number) => Promise<boolean>;
  cancelPageTurn?: () => void;
  previewPage?: <T>(
    forward: boolean,
    capture: () => Promise<T>,
    signal?: AbortSignal,
  ) => Promise<{ key: string; value: T } | null>;
  // Sub-pixel remainder of the scroll position, rendered as a transform on the
  // scrollport because scroll offsets themselves quantize to whole CSS pixels.
  subpixelOffset: number;
  scrollProp: 'scrollLeft' | 'scrollTop';
  sideProp: 'width' | 'height';
  pageColors?: {
    background: string;
    foreground: string;
    keepImages: boolean;
  };
  columnCount?: number;
  open: (book: BookDoc) => Promise<void>;
  setAttribute: (name: string, value: string | number) => void;
  removeAttribute: (name: string) => void;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  nextSection?: () => Promise<void>;
  prevSection?: () => Promise<void>;
  render?: () => Promise<void>;
  goTo: (params: {
    index: number;
    anchor?: number | RangeAnchor;
    focus?: boolean;
  }) => Promise<void>;
  setStyles?: (css: string) => void;
  primaryIndex: number;
  getContents: () => {
    doc: Document;
    index?: number;
    overlayer?: unknown;
    // readest/foliate-js#133: measured column count of the rendered view;
    // absent on foliate builds older than the #133 squash (1a1cf1d).
    contentPages?: number;
  }[];
  scrollToAnchor?: (anchor: number | Range | Element, reason?: string, smooth?: boolean) => void;
  focusView?: () => void;
  addEventListener: (
    type: string,
    listener: EventListener,
    option?: AddEventListenerOptions,
  ) => void;
  removeEventListener: (type: string, listener: EventListener) => void;
  showLoupe?: (
    x: number,
    y: number,
    options: {
      isVertical: boolean;
      color: string;
      gap: number;
      margin: number;
      radius: number;
      magnification: number;
    },
  ) => void;
  hideLoupe?: () => void;
  destroyLoupe?: () => void;
  pinchZoom?: (ratio: number) => void;
  // Fixed layout: horizontal pan as a fraction of the page's horizontal overflow.
  panX?: number | null;
  pinchEnd?: () => void;
  destroy: () => void;
}

// A CFI, an href, a section index, or a fraction of the book.
type GoToTarget = string | number | { fraction: number };

export interface FoliateView extends HTMLElement {
  open: (book: BookDoc) => Promise<void>;
  close: () => void;
  init: (options: { lastLocation: string }) => void;
  // `focus` moves focus to the destination: only for a navigation the user
  // asked for (a TOC entry, a bookmark, a search result), never for one that
  // runs on its own (restoring the position, sync, read aloud).
  // `step`: one jump in a run the reader makes in a row (search results,
  // annotations, the progress slider). A run keeps one history entry, so Back
  // returns to where it started (see wrappedFoliateView).
  goTo: (target: GoToTarget, options?: { focus?: boolean; step?: boolean }) => void;
  goToFraction: (fraction: number) => void;
  getSectionFractions: () => number[];
  prev: (distance?: number) => Promise<void>;
  next: (distance?: number) => Promise<void>;
  pan: (dx: number, dy: number) => void;
  isOverflowX: () => boolean;
  isOverflowY: () => boolean;
  goLeft: () => void;
  goRight: () => void;
  getCFI: (index: number, range?: Range) => string;
  // The TOC entry and the book's printed page (page-list) a range is in.
  getProgressOf: (
    index: number,
    range: Range,
  ) => { tocItem?: TOCItem | null; pageItem?: TOCItem | null };
  getCFIProgress: (cfi: string) => Promise<{
    fraction: number;
    section: { current: number; total: number };
    location: { current: number; next: number; total: number };
    time: { section: number; total: number };
  } | null>;
  resolveCFI: (cfi: string) => { index: number; anchor: RangeAnchor };
  resolveNavigation: (cfiOrHrefOrIndex: GoToTarget) => { index: number; anchor?: RangeAnchor };
  addAnnotation: (
    note: BookNote & { value?: string },
    remove?: boolean,
  ) => { index: number; label: string };
  search: (config: BookSearchConfig) => AsyncGenerator<BookSearchResult | string, void, void>;
  clearSearch: () => void;
  select: (target: string | number | { fraction: number }) => void;
  deselect: () => void;
  initTTS: (
    granularity?: TTSGranularity,
    nodeFilter?: (node: Node) => number,
    highlight?: (range: Range) => void,
  ) => Promise<void>;
  book: BookDoc;
  tts: ViewTTS | null;
  // The most recent relocate location, set synchronously by foliate on every
  // relocate — fresher than the rAF-debounced readerStore progress.
  lastLocation?: { cfi?: string; range?: Range | null; tocItem?: TOCItem | null };
  isFixedLayout: boolean;
  language: {
    locale?: LocaleWithTextInfo;
    isCJK?: boolean;
    canonical?: string;
    direction?: string;
  };
  history: EventTarget & {
    canGoBack: boolean;
    canGoForward: boolean;
    back: () => void;
    forward: () => void;
    clear: () => void;
    replaceState: (state: GoToTarget) => void;
  };
  renderer: Renderer;
}

export const wrappedFoliateView = (originalView: FoliateView): FoliateView => {
  const originalAddAnnotation = originalView.addAnnotation.bind(originalView);
  originalView.addAnnotation = (note: BookNote, remove = false) => {
    // transform BookNote to foliate annotation
    const annotation = {
      value: note.cfi,
      ...note,
    };
    return originalAddAnnotation(annotation, remove);
  };

  const originalGoTo = originalView.goTo.bind(originalView);
  // A run of steps (search hits, annotations, slider moves) moves the entry its
  // first step pushed instead of pushing one per step, so Back returns to where
  // reading was, not to the previous step. The run goes on only while the
  // reader stays where its last step landed: a page turn or any other
  // navigation starts a new one.
  let runCfi: string | undefined;
  let runFrom: string | undefined;
  const stepTo = async (target: GoToTarget, focus?: boolean) => {
    try {
      const resolved = await originalView.resolveNavigation(target);
      await originalView.renderer.goTo(focus ? { ...resolved, focus } : resolved);
      originalView.history.replaceState(target);
      return resolved;
    } catch (e) {
      console.error(`Could not go to ${target}`, e);
      return undefined;
    }
  };
  // The FoliateView interface declares goTo as (href: string) => void, but
  // Foliate's runtime implementation returns a Promise. Returning a Promise
  // here is compatible with the void return type in TypeScript and lets callers
  // that know about the promise (e.g. tests, async handlers) await completion.
  originalView.goTo = (
    target: GoToTarget,
    options?: { focus?: boolean; step?: boolean },
  ): Promise<unknown> => {
    // Cross-section jumps can take seconds (the target section's images block
    // its iframe load); surface start/end so the viewer can show a spinner.
    originalView.dispatchEvent(new CustomEvent('navigate-start'));
    const from = originalView.lastLocation;
    const continues = options?.step && !!from?.cfi && from.cfi === runCfi;
    return Promise.resolve(
      continues ? stepTo(target, options.focus) : originalGoTo(target, options),
    )
      .then((resolved) => {
        const to = originalView.lastLocation;
        const asked = options?.focus || options?.step;
        if (asked && from?.cfi && to?.cfi && from.cfi !== to.cfi) {
          if (options.step && !continues) runFrom = from.tocItem?.label;
          runCfi = options.step ? to.cfi : undefined;
          originalView.dispatchEvent(
            new CustomEvent('reader-jump', {
              detail: {
                from: options.step ? runFrom : from.tocItem?.label,
                to: to.tocItem?.label,
              },
            }),
          );
        }
        return resolved;
      })
      .finally(() => {
        originalView.dispatchEvent(new CustomEvent('navigate-end'));
      });
  };

  return originalView;
};
