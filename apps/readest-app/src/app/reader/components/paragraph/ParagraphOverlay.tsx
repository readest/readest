'use client';

import clsx from 'clsx';
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { ViewSettings } from '@/types/book';
import { Insets } from '@/types/misc';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { DOUBLE_CLICK_INTERVAL_THRESHOLD_MS } from '@/services/constants';
import { setSelectionSuppressed } from '@/utils/bridge';
import { eventDispatcher } from '@/utils/event';
import {
  getParagraphActionForKey,
  getParagraphActionForZone,
  getParagraphLayoutContext,
  ParagraphPresentation,
} from '@/utils/paragraphPresentation';
import { getTextSubRange, rangeTextExcludingInert } from '@/services/tts/wordHighlight';
import { getIndexFromCfi } from '@/utils/cfi';
import { isRangeLike } from '@/utils/range';
import { getHighlightColorHex } from '../../utils/annotatorUtil';
import { getBaseFontFamily } from '@/utils/style';
import { loadShortcuts } from '@/helpers/shortcuts';
import { matchesShortcut } from '@/utils/shortcutKeys';
import TTSFollowIndicator, { TtsSyncStatus } from '../tts/TTSFollowIndicator';
import { buildTtsHighlightCssText } from './paragraphTts';
import {
  getRangeOffsetsInParagraph,
  getSelectionRangeWithin,
  mapCloneSelectionToSource,
} from './paragraphSelection';

// CSS Custom Highlight registry name for the in-paragraph TTS word/sentence
// highlight (#3235). Unique per app so it never collides with other highlights.
const TTS_HIGHLIGHT_NAME = 'readest-tts-paragraph';
// Prefix of the CSS Custom Highlight names the book's own highlights are painted
// under on the clone, one per style and colour (#6200).
const ANNOTATION_HIGHLIGHT_PREFIX = 'readest-annotation-';

const isSameRange = (a: Range, b: Range) => {
  try {
    return (
      a.compareBoundaryPoints(Range.START_TO_START, b) === 0 &&
      a.compareBoundaryPoints(Range.END_TO_END, b) === 0
    );
  } catch {
    return false;
  }
};

interface ParagraphOverlayProps {
  bookKey: string;
  viewSettings?: ViewSettings;
  /** Display scale on top of the reader's font size (#5246); 1 = book size. */
  fontScale?: number;
  gridInsets?: Insets;
  /** Derived TTS-sync status driving the "following audio" indicator (#3235). */
  ttsSyncStatus?: TtsSyncStatus;
  /** Re-engage following after a manual nav decoupled it (indicator action). */
  onResumeTtsFollow?: () => void;
  onClose?: () => void;
}

interface ParagraphContent {
  id: number;
  html: string;
  presentation: ParagraphPresentation;
}

const getParagraphTextAlign = (presentation: ParagraphPresentation) =>
  presentation.textAlign || (presentation.vertical ? 'center' : undefined);

const AnimatedParagraph: React.FC<{
  html: string;
  presentation: ParagraphPresentation;
  style: React.CSSProperties;
}> = ({ html, presentation, style }) => {
  const [isReady, setIsReady] = useState(false);
  // React re-sets innerHTML whenever this object's identity changes, which
  // would rebuild the clone's DOM on every render — throwing away a selection
  // made in it (#6200) and the ranges the TTS highlight holds. One object per
  // paragraph keeps the DOM until the paragraph itself changes.
  const innerHtml = useMemo(() => ({ __html: html }), [html]);

  useEffect(() => {
    setIsReady(false);
    const frame = requestAnimationFrame(() => setIsReady(true));
    return () => cancelAnimationFrame(frame);
  }, [html]);

  return (
    <div
      lang={presentation.lang}
      dir={presentation.dir}
      className={clsx(
        'paragraph-content text-base-content transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
        // The reader page turns selection off; the clone turns it back on so
        // its text can be selected like the book page's (#6200).
        'cursor-text select-text',
        presentation.vertical ? 'mx-auto w-auto max-w-none' : 'w-full',
        isReady ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
      )}
      style={{
        ...style,
        direction: presentation.dir,
        writingMode: presentation.writingMode as React.CSSProperties['writingMode'],
        textOrientation: presentation.textOrientation as React.CSSProperties['textOrientation'],
        unicodeBidi: presentation.unicodeBidi as React.CSSProperties['unicodeBidi'],
        textAlign: getParagraphTextAlign(presentation) as React.CSSProperties['textAlign'],
        transformOrigin: 'center top',
      }}
      dangerouslySetInnerHTML={innerHtml}
    />
  );
};

const SectionTransitionIndicator: React.FC<{
  isVisible: boolean;
  direction: 'next' | 'prev';
}> = ({ isVisible, direction }) => {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!isVisible) return undefined;
    const timer = requestAnimationFrame(() => {
      setTimeout(() => setIsReady(true), 30);
    });
    return () => {
      cancelAnimationFrame(timer);
      setIsReady(false);
    };
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <div
      className={clsx(
        'flex w-full items-center justify-center',
        'duration-400 transition-all ease-out',
        isReady ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
      )}
    >
      <div className='flex items-center gap-3'>
        <div className='flex items-center gap-1.5'>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className='bg-base-content/30 h-1.5 w-1.5 rounded-full'
              style={{
                animation: 'pulse 800ms ease-in-out infinite',
                animationDelay: `${i * 150}ms`,
              }}
            />
          ))}
        </div>
        <span className='text-base-content/40 text-base font-medium'>
          {direction === 'next' ? 'Next chapter' : 'Previous chapter'}
        </span>
      </div>
    </div>
  );
};

const ParagraphOverlay: React.FC<ParagraphOverlayProps> = ({
  bookKey,
  viewSettings,
  fontScale = 1,
  gridInsets = { top: 0, right: 0, bottom: 0, left: 0 },
  ttsSyncStatus = 'idle',
  onResumeTtsFollow,
  onClose,
}) => {
  const { appService } = useEnv();
  const { getView, getProgress } = useReaderStore();
  const booknotes = useBookDataStore(
    (state) => state.booksData[bookKey.split('-')[0]!]?.config?.booknotes,
  );
  const { settings } = useSettingsStore();
  const [paragraphs, setParagraphs] = useState<ParagraphContent[]>([]);
  const [isVisible, setIsVisible] = useState(false);
  const [isOverlayMounted, setIsOverlayMounted] = useState(false);
  const [isChangingSection, setIsChangingSection] = useState(false);
  const [sectionDirection, setSectionDirection] = useState<'next' | 'prev'>('next');
  // Index of the currently focused paragraph, used to gate the TTS word/sentence
  // highlight so a stale highlight never lands on the wrong paragraph (#3235).
  const [focusIndex, setFocusIndex] = useState(-1);
  // `::highlight()` rules for the book highlights painted on the clone.
  const [annotationCss, setAnnotationCss] = useState('');
  const [ttsHighlight, setTtsHighlight] = useState<{
    index: number;
    start: number;
    end: number;
  } | null>(null);
  const paragraphIdCounter = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const lastScrollTime = useRef(0);
  const onCloseRef = useRef(onClose);
  // The focused paragraph's live range in the book document, so a selection
  // made in the clone can be mapped back onto the book (#6200).
  const sourceRangeRef = useRef<Range | null>(null);
  // The clone range last handed to the annotator; null once the live selection
  // has left it, so the same text selected again is reported again.
  const reportedRangeRef = useRef<Range | null>(null);
  // Whether the annotator holds a selection of ours that has not been cleared.
  const selectionActiveRef = useRef(false);
  const menuSuppressedRef = useRef(false);
  const pendingTapRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const contentStyle = useMemo(() => {
    if (!viewSettings) return {};
    // Resolve the same font chain as the RSVP overlay (custom + CJK +
    // fallbacks); a bare serif/sans pair dropped the user's CJK/custom font,
    // so CJK text fell back to the system font (#5246).
    const defaultFontFamily = viewSettings.defaultFont
      ? getBaseFontFamily(viewSettings)
      : undefined;
    return {
      fontFamily: defaultFontFamily,
      fontSize: `${(viewSettings.defaultFontSize || 16) * fontScale}px`,
      lineHeight: viewSettings.lineHeight || 1.6,
      letterSpacing: viewSettings.letterSpacing ? `${viewSettings.letterSpacing}px` : undefined,
      wordSpacing: viewSettings.wordSpacing ? `${viewSettings.wordSpacing}px` : undefined,
      fontWeight: viewSettings.fontWeight || 400,
      WebkitFontSmoothing: 'antialiased',
      fontKerning: 'normal',
      textRendering: 'optimizeLegibility',
    } as React.CSSProperties;
  }, [viewSettings, fontScale]);

  const activePresentation = paragraphs[0]?.presentation ?? undefined;
  const activeParagraph = paragraphs[0];
  const layoutContext = useMemo(
    () => getParagraphLayoutContext(activePresentation ?? viewSettings),
    [activePresentation, viewSettings],
  );
  const frameStyle = useMemo(() => {
    const topInset = appService?.hasSafeAreaInset ? gridInsets.top : 0;
    const bottomInset = appService?.hasSafeAreaInset ? gridInsets.bottom * 0.33 : 0;
    const viewportPadding = `clamp(1rem, 4vw, 2.5rem)`;

    return {
      boxSizing: 'border-box',
      paddingBlock: layoutContext.vertical
        ? 'clamp(0.9rem, 2.4vh, 1.35rem)'
        : 'clamp(1rem, 3vh, 1.75rem)',
      paddingInline: layoutContext.vertical
        ? 'clamp(0.85rem, 2.8vw, 1.2rem)'
        : 'clamp(1rem, 4vw, 2rem)',
      inlineSize: layoutContext.vertical
        ? 'fit-content'
        : `min(calc(100vw - (${viewportPadding} * 2)), 66ch)`,
      blockSize: layoutContext.vertical ? 'fit-content' : undefined,
      minInlineSize: layoutContext.vertical ? '5.25rem' : undefined,
      maxInlineSize: layoutContext.vertical
        ? `min(calc(100dvh - ${topInset + bottomInset + 80}px), 24rem)`
        : undefined,
      maxBlockSize: layoutContext.vertical
        ? 'min(calc(100vw - 1.5rem), 28rem)'
        : `min(calc(100dvh - ${topInset + bottomInset + 132}px), 38rem)`,
      marginInline: 'auto',
    } as React.CSSProperties;
  }, [appService?.hasSafeAreaInset, gridInsets.bottom, gridInsets.top, layoutContext.vertical]);
  // `::highlight()` declaration matching the user's TTS highlight color/style so
  // the in-paragraph word/sentence highlight looks like normal mode (#3235).
  const ttsHighlightCss = useMemo(
    () => buildTtsHighlightCssText(viewSettings?.ttsHighlightOptions),
    [viewSettings?.ttsHighlightOptions],
  );
  const fallbackPresentation = useMemo(
    (): ParagraphPresentation => ({
      dir: layoutContext.rtl ? 'rtl' : 'ltr',
      writingMode: layoutContext.writingMode,
      vertical: layoutContext.vertical,
      rtl: layoutContext.rtl,
    }),
    [layoutContext.rtl, layoutContext.vertical, layoutContext.writingMode],
  );

  const extractContent = useCallback((range: Range): string => {
    try {
      const fragment = range.cloneContents();
      const tempDiv = document.createElement('div');
      tempDiv.appendChild(fragment);
      return tempDiv.innerHTML;
    } catch {
      return '';
    }
  }, []);

  const addParagraph = useCallback(
    (range: Range, presentation?: ParagraphPresentation) => {
      const html = extractContent(range);
      if (!html) return;

      const newId = ++paragraphIdCounter.current;
      const nextPresentation = presentation ?? fallbackPresentation;

      setParagraphs([{ id: newId, html, presentation: nextPresentation }]);
    },
    [extractContent, fallbackPresentation],
  );

  const getCloneRoot = useCallback(
    () => contentRef.current?.querySelector('.paragraph-content') ?? null,
    [],
  );
  const getCloneSelection = useCallback(
    () => getSelectionRangeWithin(getCloneRoot()),
    [getCloneRoot],
  );
  // Whether the document selection sits in the clone at all — a caret left by
  // a click counts, so a keyboard selection can be started from it.
  const isSelectionAnchoredInClone = useCallback(() => {
    const anchor = document.getSelection()?.anchorNode;
    return !!anchor && !!getCloneRoot()?.contains(anchor);
  }, [getCloneRoot]);

  // Android floats its own menu over a selection; the book page keeps it off
  // while its text is selected (useTextSelector), and so does the clone.
  const syncNativeSelectionMenu = useCallback(
    (suppressed: boolean) => {
      if (!appService?.isAndroidApp || menuSuppressedRef.current === suppressed) return;
      menuSuppressedRef.current = suppressed;
      setSelectionSuppressed({ target: 'menu', suppressed }).catch(() => {});
    },
    [appService?.isAndroidApp],
  );

  const clearReportedSelection = useCallback(() => {
    reportedRangeRef.current = null;
    syncNativeSelectionMenu(false);
    if (!selectionActiveRef.current) return;
    selectionActiveRef.current = false;
    eventDispatcher.dispatch('footnote-selection', { key: bookKey });
  }, [bookKey, syncNativeSelectionMenu]);

  // Surface a selection made in the clone to the annotator (#6200). The book's
  // selection listeners live on the section iframes and never see it, so it
  // takes the popup-window path the footnote popup uses: the clone range
  // positions the toolbar, and the CFI — the same text located in the book's
  // paragraph — anchors highlights and notes. A copy of the range is handed
  // over so a click that collapses the live selection (a toolbar button) does
  // not pull the toolbar off the text.
  const reportSelection = useCallback(() => {
    const cloneRoot = getCloneRoot();
    const range = getSelectionRangeWithin(cloneRoot);
    if (!range) {
      reportedRangeRef.current = null;
      return;
    }
    const reported = reportedRangeRef.current;
    if (reported && isSameRange(reported, range)) return;
    const cloneRange = range.cloneRange();
    reportedRangeRef.current = cloneRange;
    const source = sourceRangeRef.current;
    const view = getView(bookKey);
    const index = source
      ? view?.renderer
          ?.getContents()
          .find((content) => content.doc === source.startContainer.ownerDocument)?.index
      : undefined;
    const sourceRange =
      source && cloneRoot ? mapCloneSelectionToSource(cloneRoot, cloneRange, source) : null;
    let cfi: string | undefined;
    if (sourceRange && index !== undefined) {
      try {
        cfi = view?.getCFI(index, sourceRange);
      } catch {
        cfi = undefined;
      }
    }
    selectionActiveRef.current = true;
    eventDispatcher.dispatch('footnote-selection', {
      key: bookKey,
      range: cloneRange,
      index: index ?? -1,
      cfi,
      href: getProgress(bookKey)?.sectionHref,
    });
  }, [bookKey, getCloneRoot, getView, getProgress]);

  useEffect(() => {
    let sectionChangeTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const handleFocus = (event: CustomEvent) => {
      if (event.detail?.bookKey !== bookKey) return;
      const range = event.detail?.range;
      const presentation = event.detail?.presentation;
      if (range) {
        if (sectionChangeTimeoutId) {
          clearTimeout(sectionChangeTimeoutId);
          sectionChangeTimeoutId = null;
        }
        setIsChangingSection(false);
        setIsVisible(true);
        setIsOverlayMounted(true);
        setFocusIndex(typeof event.detail?.index === 'number' ? event.detail.index : -1);
        sourceRangeRef.current = range;
        clearReportedSelection();
        addParagraph(range, presentation);
      }
    };

    const handleDisabled = (event: CustomEvent) => {
      if (event.detail?.bookKey !== bookKey) return;
      if (sectionChangeTimeoutId) {
        clearTimeout(sectionChangeTimeoutId);
        sectionChangeTimeoutId = null;
      }
      setIsOverlayMounted(false);
      setIsChangingSection(false);
      setTtsHighlight(null);
      sourceRangeRef.current = null;
      clearReportedSelection();
      setTimeout(() => {
        setIsVisible(false);
        setParagraphs([]);
      }, 300);
    };

    const handleSectionChanging = (event: CustomEvent) => {
      if (event.detail?.bookKey !== bookKey) return;
      setSectionDirection(event.detail?.direction || 'next');
      setParagraphs([]);
      setTtsHighlight(null);
      clearReportedSelection();
      setIsChangingSection(true);
    };

    // TTS word/sentence highlight within the focused paragraph (#3235). The hook
    // sends character offsets relative to the paragraph start (+ its index, to
    // guard against landing on the wrong paragraph) or a clear when TTS stops.
    const handleTtsHighlight = (event: CustomEvent) => {
      if (event.detail?.bookKey !== bookKey) return;
      const detail = event.detail as
        | { clear?: boolean; index?: number; start?: number; end?: number }
        | undefined;
      if (detail?.clear || typeof detail?.start !== 'number' || typeof detail?.end !== 'number') {
        setTtsHighlight(null);
        return;
      }
      setTtsHighlight({ index: detail.index ?? -1, start: detail.start, end: detail.end });
    };

    eventDispatcher.on('paragraph-focus', handleFocus);
    eventDispatcher.on('paragraph-mode-disabled', handleDisabled);
    eventDispatcher.on('paragraph-section-changing', handleSectionChanging);
    eventDispatcher.on('paragraph-tts-highlight', handleTtsHighlight);

    return () => {
      if (sectionChangeTimeoutId) clearTimeout(sectionChangeTimeoutId);
      eventDispatcher.off('paragraph-focus', handleFocus);
      eventDispatcher.off('paragraph-mode-disabled', handleDisabled);
      eventDispatcher.off('paragraph-section-changing', handleSectionChanging);
      eventDispatcher.off('paragraph-tts-highlight', handleTtsHighlight);
    };
  }, [bookKey, addParagraph, clearReportedSelection]);

  // Focus the dialog when it opens (the dialog/alert pattern) so it receives
  // keydowns directly via its own onKeyDown handler, regardless of where focus
  // sat before — fixes Shift+P/Escape not toggling when focus was still inside
  // the book iframe (#4717).
  useEffect(() => {
    if (!isVisible) return;
    containerRef.current?.focus({ preventScroll: true });
  }, [isVisible]);

  // Keydown handler bound to the dialog element. Keeps every key inside the
  // overlay (stopPropagation) so the global shortcut handler never sees it — the
  // toggle therefore fires exactly once.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation();

      if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        // Escape drops a live selection (and its toolbar) first; the next
        // Escape exits.
        if (e.key === 'Escape' && getCloneSelection()) {
          document.getSelection()?.removeAllRanges();
          clearReportedSelection();
          return;
        }
        onCloseRef.current?.();
        return;
      }

      if (matchesShortcut(e, loadShortcuts().onToggleParagraphMode.keys)) {
        e.preventDefault();
        onCloseRef.current?.();
        return;
      }

      // Shift+arrow starts or extends a keyboard selection from a caret or a
      // selection in the clone; leave it to the browser.
      if (e.shiftKey && isSelectionAnchoredInClone()) return;

      const action = getParagraphActionForKey(e.key, activePresentation ?? viewSettings);
      if (action === 'next') {
        e.preventDefault();
        eventDispatcher.dispatch('paragraph-next', { bookKey });
      } else if (action === 'prev') {
        e.preventDefault();
        eventDispatcher.dispatch('paragraph-prev', { bookKey });
      }
    },
    [
      activePresentation,
      bookKey,
      viewSettings,
      getCloneSelection,
      isSelectionAnchoredInClone,
      clearReportedSelection,
    ],
  );

  useEffect(() => {
    if (!isVisible) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const now = Date.now();
      if (now - lastScrollTime.current < 150) return;
      lastScrollTime.current = now;

      if (e.deltaY > 0) {
        eventDispatcher.dispatch('paragraph-next', { bookKey });
      } else if (e.deltaY < 0) {
        eventDispatcher.dispatch('paragraph-prev', { bookKey });
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    return () => window.removeEventListener('wheel', handleWheel, true);
  }, [isVisible, bookKey]);

  // Watch the document selection while the overlay is up (#6200). A settled
  // selection inside the clone is reported once; a finished drag reports at
  // once rather than after the debounce. A collapsed selection is never a
  // dismissal by itself — a click on a toolbar button collapses it too. The
  // toolbar goes with a tap on the overlay (handleContentClick), a paragraph
  // change, Escape, or the overlay closing.
  useEffect(() => {
    if (!isVisible) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handleSelectionChange = () => {
      const range = getCloneSelection();
      syncNativeSelectionMenu(!!range);
      // Once the live selection has left the reported range, selecting the
      // same text again is a new selection (the toolbar may have gone in the
      // meantime, e.g. with a relocate).
      if (!range) reportedRangeRef.current = null;
      if (timer) clearTimeout(timer);
      timer = setTimeout(reportSelection, 250);
    };
    const handlePointerUp = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      reportSelection();
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    document.addEventListener('pointerup', handlePointerUp);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('selectionchange', handleSelectionChange);
      document.removeEventListener('pointerup', handlePointerUp);
      clearReportedSelection();
    };
  }, [
    isVisible,
    getCloneSelection,
    reportSelection,
    clearReportedSelection,
    syncNativeSelectionMenu,
  ]);

  useEffect(() => {
    return () => {
      if (pendingTapRef.current) clearTimeout(pendingTapRef.current);
    };
  }, []);

  // Paint the current TTS word/sentence onto the cloned paragraph using the CSS
  // Custom Highlight API (#3235). It highlights a Range without mutating the DOM
  // and natively spans inline element boundaries (sentences), so the fade-in
  // animation and the clone's markup stay untouched. Re-runs when the clone
  // (paragraphs) or the offsets change; gated on the index so a highlight from a
  // previous paragraph never paints the wrong text. No-op where unsupported.
  useEffect(() => {
    const registry = typeof CSS !== 'undefined' ? CSS.highlights : undefined;
    if (!registry || typeof Highlight === 'undefined') return undefined;
    const clear = () => {
      registry.delete(TTS_HIGHLIGHT_NAME);
    };

    if (!ttsHighlight || ttsHighlight.index !== focusIndex) {
      clear();
      return clear;
    }
    const contentEl = contentRef.current?.querySelector('.paragraph-content');
    if (!contentEl) {
      clear();
      return clear;
    }
    const base = document.createRange();
    base.selectNodeContents(contentEl);
    const range = getTextSubRange(base, ttsHighlight.start, ttsHighlight.end);
    if (!range) {
      clear();
      return clear;
    }
    registry.set(TTS_HIGHLIGHT_NAME, new Highlight(range));
    return clear;
  }, [ttsHighlight, focusIndex, paragraphs]);

  // Paint the book's highlights that fall in the focused paragraph onto the
  // clone (#6200). The overlay hides the page, so a highlight made here — or
  // one already there — gave no feedback at all. Each is resolved from its CFI
  // in the book document, clipped to the paragraph, mapped by text offset onto
  // the clone and drawn with the CSS Custom Highlight API like the TTS
  // highlight: no DOM mutation, so a selection in the clone survives. Keyed on
  // the book's notes, a highlight shows the moment it is made.
  useEffect(() => {
    const registry = typeof CSS !== 'undefined' ? CSS.highlights : undefined;
    if (!registry || typeof Highlight === 'undefined') return undefined;
    const clear = () => {
      for (const name of [...registry.keys()]) {
        if (name.startsWith(ANNOTATION_HIGHLIGHT_PREFIX)) registry.delete(name);
      }
      setAnnotationCss('');
    };
    clear();
    const cloneRoot = getCloneRoot();
    const source = sourceRangeRef.current;
    const view = getView(bookKey);
    const doc = source?.startContainer.ownerDocument;
    if (!cloneRoot || !source || !view || !doc || !booknotes?.length) return clear;
    const index = view.renderer.getContents().find((content) => content.doc === doc)?.index;
    if (index === undefined) return clear;

    const base = document.createRange();
    base.selectNodeContents(cloneRoot);
    const cloneText = rangeTextExcludingInert(base);
    const groups = new Map<string, { css: string; ranges: Range[] }>();
    for (const note of booknotes) {
      if (note.type !== 'annotation' || note.deletedAt || !note.style || !note.color) continue;
      if (getIndexFromCfi(note.cfi) !== index) continue;
      const offsets: { start: number; end: number }[] = [];
      try {
        const anchor = view.resolveCFI(note.cfi)?.anchor(doc);
        let range: Range | null = null;
        if (isRangeLike(anchor)) {
          range = anchor;
        } else if (anchor) {
          range = doc.createRange();
          range.selectNodeContents(anchor);
        }
        const clipped = range && getRangeOffsetsInParagraph(source, range);
        if (clipped) offsets.push(clipped);
      } catch {
        // An unresolvable CFI has nothing to paint.
      }
      // A global highlight marks every occurrence of its text on the page.
      if (note.global && note.text) {
        for (
          let at = cloneText.indexOf(note.text);
          at >= 0;
          at = cloneText.indexOf(note.text, at + note.text.length)
        ) {
          offsets.push({ start: at, end: at + note.text.length });
        }
      }
      const ranges = offsets
        .map(({ start, end }) => getTextSubRange(base, start, end))
        .filter((range): range is Range => !!range);
      const color = getHighlightColorHex(settings, note.color);
      if (ranges.length === 0 || !color) continue;
      const name = `${ANNOTATION_HIGHLIGHT_PREFIX}${note.style}-${color.replace('#', '')}`;
      const group = groups.get(name) ?? {
        css: buildTtsHighlightCssText({ style: note.style, color }),
        ranges: [],
      };
      group.ranges.push(...ranges);
      groups.set(name, group);
    }
    for (const [name, group] of groups) registry.set(name, new Highlight(...group.ranges));
    setAnnotationCss(
      [...groups].map(([name, group]) => `::highlight(${name}) { ${group.css} }`).join('\n'),
    );
    return clear;
  }, [paragraphs, booknotes, bookKey, getCloneRoot, getView, settings]);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      // A finger on a selected paragraph is dragging the selection, not swiping.
      if (getCloneSelection()) return;
      const touchStartY = e.touches[0]?.clientY ?? 0;
      const touchStartX = e.touches[0]?.clientX ?? 0;

      const handleTouchMove = (moveEvent: TouchEvent) => {
        // The long-press that selects a word lands mid-gesture, and the finger
        // then drags the selection out: not a swipe either.
        if (getCloneSelection()) {
          document.removeEventListener('touchmove', handleTouchMove);
          document.removeEventListener('touchend', handleTouchEnd);
          return;
        }
        const touchEndY = moveEvent.touches[0]?.clientY ?? 0;
        const touchEndX = moveEvent.touches[0]?.clientX ?? 0;
        const diffY = touchStartY - touchEndY;
        const diffX = touchStartX - touchEndX;
        const horizontalAction =
          diffX > 0
            ? getParagraphActionForZone('right', activePresentation ?? viewSettings)
            : getParagraphActionForZone('left', activePresentation ?? viewSettings);

        if (layoutContext.vertical && Math.abs(diffY) > Math.abs(diffX) && Math.abs(diffY) > 50) {
          eventDispatcher.dispatch(diffY > 0 ? 'paragraph-next' : 'paragraph-prev', { bookKey });
          document.removeEventListener('touchmove', handleTouchMove);
          document.removeEventListener('touchend', handleTouchEnd);
        } else if (
          !layoutContext.vertical &&
          Math.abs(diffX) > Math.abs(diffY) &&
          Math.abs(diffX) > 50 &&
          horizontalAction
        ) {
          eventDispatcher.dispatch(
            horizontalAction === 'next' ? 'paragraph-next' : 'paragraph-prev',
            { bookKey },
          );
          document.removeEventListener('touchmove', handleTouchMove);
          document.removeEventListener('touchend', handleTouchEnd);
        }
      };

      const handleTouchEnd = () => {
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('touchend', handleTouchEnd);
      };

      document.addEventListener('touchmove', handleTouchMove);
      document.addEventListener('touchend', handleTouchEnd);
    },
    [activePresentation, bookKey, layoutContext.vertical, viewSettings, getCloneSelection],
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      // Keep keyboard focus on the dialog so Escape/Shift+P keep working after a
      // tap moved focus elsewhere (e.g. into the book iframe).
      containerRef.current?.focus({ preventScroll: true });
      // A showing selection toolbar or lookup popup takes the tap to dismiss
      // itself, as it does for a tap on the book page (#6200).
      if (eventDispatcher.dispatchSync('iframe-single-click')) return;
      // Tapping the empty area around the paragraph used to exit, which made it
      // easy to leave paragraph mode by accident. Reveal the controls instead so
      // exiting stays an explicit action (the bar's exit button or Escape).
      if (e.target === containerRef.current) {
        eventDispatcher.dispatch('paragraph-show-controls', { bookKey });
      }
    },
    [bookKey],
  );

  const lastTapTimeRef = useRef(0);
  const cancelPendingTap = useCallback(() => {
    if (pendingTapRef.current) {
      clearTimeout(pendingTapRef.current);
      pendingTapRef.current = null;
    }
  }, []);
  const handleContentClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      // Keep keyboard focus on the dialog so it keeps receiving keys after a tap.
      containerRef.current?.focus({ preventScroll: true });
      cancelPendingTap();

      // A click with the clone's text still selected is the tail of the
      // selection gesture — the release of a drag, the second click of a word
      // double-click — and the selection belongs to the toolbar now.
      if (getCloneSelection()) {
        lastTapTimeRef.current = 0;
        return;
      }

      // A showing selection toolbar or lookup popup takes the tap to dismiss
      // itself, as it does for a tap on the book page (#6200).
      if (eventDispatcher.dispatchSync('iframe-single-click')) {
        lastTapTimeRef.current = 0;
        return;
      }

      const now = Date.now();
      if (now - lastTapTimeRef.current < DOUBLE_CLICK_INTERVAL_THRESHOLD_MS) {
        lastTapTimeRef.current = 0;
        onCloseRef.current?.();
        return;
      }
      lastTapTimeRef.current = now;

      const rect = contentRef.current?.getBoundingClientRect();
      if (!rect) return;

      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      const zone = layoutContext.vertical
        ? clickY < rect.height / 3
          ? 'top'
          : clickY > (rect.height * 2) / 3
            ? 'bottom'
            : null
        : clickX < rect.width / 3
          ? 'left'
          : clickX > (rect.width * 2) / 3
            ? 'right'
            : null;

      const action = zone
        ? getParagraphActionForZone(zone, activePresentation ?? viewSettings)
        : null;
      const act = () => {
        if (action === 'prev') {
          eventDispatcher.dispatch('paragraph-prev', { bookKey });
        } else if (action === 'next') {
          eventDispatcher.dispatch('paragraph-next', { bookKey });
        } else {
          // A tap in the neutral center zone reveals the controls so the exit
          // button stays reachable on touch after the bar has auto-hidden.
          eventDispatcher.dispatch('paragraph-show-controls', { bookKey });
        }
      };
      // A mouse double-click selects a word, so a mouse click waits out the
      // double-click interval before acting — the wait the book page takes
      // (iframeEventHandlers.handleClick). A touch tap stays immediate.
      const isMouse = (e.nativeEvent as PointerEvent).pointerType === 'mouse';
      if (isMouse && !viewSettings?.disableDoubleClick) {
        pendingTapRef.current = setTimeout(() => {
          pendingTapRef.current = null;
          act();
        }, DOUBLE_CLICK_INTERVAL_THRESHOLD_MS);
      } else {
        act();
      }
    },
    [
      activePresentation,
      bookKey,
      layoutContext.vertical,
      viewSettings,
      cancelPendingTap,
      getCloneSelection,
    ],
  );

  // Mobile long-press selects a word; the platform context menu is not wanted
  // over the selection toolbar, same as on the book page.
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (appService?.isMobile) e.preventDefault();
    },
    [appService?.isMobile],
  );

  if (!isVisible) return null;

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      ref={containerRef}
      role='dialog'
      aria-modal='true'
      aria-label='Paragraph reading mode'
      tabIndex={-1}
      className={clsx(
        'fixed inset-0 z-40',
        'flex flex-col items-center justify-center',
        // Solid page color, not a translucent blur of the book behind it — the
        // blurred backdrop read as foreign chrome next to the rest of the app
        // (#5275), and without the blur any translucency leaks ghost text.
        'bg-base-100',
        // The dialog is focused programmatically (so it receives keys); it is not
        // a tab stop, so suppress the focus ring that would otherwise outline the
        // whole viewport.
        'outline-hidden',
        'transition-opacity duration-300 ease-out',
        isOverlayMounted ? 'opacity-100' : 'opacity-0',
      )}
      style={{
        paddingTop: appService?.hasSafeAreaInset ? `${gridInsets.top}px` : undefined,
        paddingBottom: appService?.hasSafeAreaInset ? `${gridInsets.bottom * 0.33}px` : undefined,
      }}
      onClick={handleBackdropClick}
      onTouchStart={handleTouchStart}
      onKeyDown={handleKeyDown}
    >
      {/* TTS "following audio" indicator, pinned top-center. Anchored below the
          top safe-area inset the overlay already accounts for; idle/unsupported
          render nothing so it stays out of the way when TTS isn't driving. */}
      <div
        className='pointer-events-none absolute inset-x-0 z-10 flex justify-center'
        style={{
          top: appService?.hasSafeAreaInset ? `calc(${gridInsets.top}px + 0.75rem)` : '0.75rem',
        }}
      >
        {/* Only the indicator itself takes pointer events (its decoupled state is
            a button); the wrapper stays transparent to backdrop/region taps. */}
        <div className='pointer-events-auto'>
          <TTSFollowIndicator status={ttsSyncStatus} onResume={onResumeTtsFollow} />
        </div>
      </div>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        ref={contentRef}
        className={clsx(
          'relative flex w-full cursor-default flex-col items-center px-4 sm:px-6',
          layoutContext.vertical ? 'justify-center py-2' : '',
        )}
        onClick={handleContentClick}
        onContextMenu={handleContextMenu}
      >
        <style>{`
          .paragraph-content {
            text-wrap: pretty;
          }

          .paragraph-content :is(h1, h2, h3, h4, h5, h6) {
            line-height: 1.2;
            text-wrap: balance;
            margin-block-end: 0.45em;
          }

          .paragraph-content > :first-child {
            margin-block-start: 0;
          }

          .paragraph-content > :last-child {
            margin-block-end: 0;
          }

          ::highlight(${TTS_HIGHLIGHT_NAME}) {
            ${ttsHighlightCss}
          }

          ${annotationCss}
        `}</style>
        {activeParagraph ? (
          <div
            className={clsx(
              // No surface of its own: the paragraph sits on the page color, so
              // there is nothing left to round off (#5275).
              'relative',
              layoutContext.vertical
                ? 'inline-flex items-center justify-center self-center overflow-visible'
                : 'w-full overflow-auto',
            )}
            // The frame carries the paragraph font too so its ch-based width
            // cap resolves against the (scaled) text, widening the column as
            // the text grows instead of squeezing it into the same box (#5246).
            style={{
              ...frameStyle,
              fontFamily: contentStyle.fontFamily,
              fontSize: contentStyle.fontSize,
            }}
          >
            <AnimatedParagraph
              key={activeParagraph.id}
              html={activeParagraph.html}
              presentation={activeParagraph.presentation}
              style={contentStyle}
            />
          </div>
        ) : isChangingSection ? (
          <SectionTransitionIndicator isVisible={isChangingSection} direction={sectionDirection} />
        ) : null}
      </div>
    </div>
  );
};

export default ParagraphOverlay;
