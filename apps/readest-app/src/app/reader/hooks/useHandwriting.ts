import { useCallback, useEffect, useRef, useState } from 'react';

import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useEnv } from '@/context/EnvContext';
import { saveSysSettings } from '@/helpers/settings';
import { HandwritingEditor } from '@/services/handwriting/editor';
import { HandwritingService, nextInkSession } from '@/services/handwriting/handwritingService';
import { loadInkEditor, withInkNotes } from '@/services/handwriting/persistence';
import { fixedPageKey, sectionPageKey } from '@/services/handwriting/pageKey';
import { createInkAnchoring } from '../utils/inkAnchoring';
import { boundsOf } from '@/services/handwriting/anchor';
import type { PageRect } from '@/services/handwriting/coords';
import type { InkStroke, InkTool } from '@/services/handwriting/model';
import type { ReadSettings } from '@/types/settings';
import type { FoliateView } from '@/types/view';
import type { BookNote } from '@/types/book';

/** Strokes normalized to one rect; the canvas draws each layer against its rect. */
export interface InkLayer {
  strokes: InkStroke[];
  rect: PageRect;
}

const EMPTY_RECT: PageRect = { left: 0, top: 0, width: 0, height: 0 };
const SAVE_DELAY_MS = 1000;

const toRect = (r: DOMRect): PageRect => ({
  left: r.left,
  top: r.top,
  width: r.width,
  height: r.height,
});

/** The text an ink annotation marks, for its sidebar entry. */
const describeInk = (view: FoliateView, cfi: string): string => {
  try {
    const { index, anchor } = view.resolveCFI(cfi);
    const doc = view.renderer.getContents().find((c) => c.index === index)?.doc;
    if (!doc || !cfi.includes('!')) return '';
    return anchor(doc).toString().replace(/\s+/g, ' ').trim().slice(0, 200);
  } catch {
    return '';
  }
};

/** What identifies the book's ink notes, to tell outside edits from our own. */
const inkSignature = (notes: BookNote[] | undefined) =>
  (notes ?? [])
    .filter((n) => n.type === 'ink')
    .map((n) => `${n.id}:${n.updatedAt}:${n.deletedAt ?? ''}`)
    .join();

const sameRect = (a: PageRect, b: PageRect) =>
  a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;

/** The frames of a fixed-layout page (two in a spread), as on screen now. */
const pageFrames = (view: FoliateView | null): Element[] =>
  (view?.renderer.getContents() ?? []).flatMap(({ doc }) => {
    const frame = doc?.defaultView?.frameElement;
    return frame ? [frame] : [];
  });

/**
 * Bounds of the fixed-layout page (or spread) on screen. Ink is normalized to
 * the page itself, so zoom, pan, rotation and window size never move it
 * relative to the page content.
 */
const measureFixedPage = (view: FoliateView | null): PageRect | null => {
  const rects = (view?.renderer.getContents() ?? []).flatMap(({ doc }) => {
    const frame = doc?.defaultView?.frameElement;
    return frame ? [frame.getBoundingClientRect()] : [];
  });
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  return { left, top, width: right - left, height: bottom - top };
};

export function useHandwriting(bookKey: string) {
  const { getBookData, getConfig, setConfig, saveConfig } = useBookDataStore();
  const { getView, getViewSettings } = useReaderStore();
  const { settings } = useSettingsStore();
  const { envConfig } = useEnv();
  const progress = useBookProgress(bookKey);
  const isFixedLayout = !!getBookData(bookKey)?.isFixedLayout;
  // Scrolled views show several pages at once; strokes are routed per page.
  const scrolled = !!getViewSettings(bookKey)?.scrolled;
  // Each tool keeps its own color and width; the dock shows the active one's.
  const readSettings = settings.globalReadSettings;
  const tool = readSettings.handwritingTool;
  const marker = tool === 'marker';
  const penColor = marker ? readSettings.handwritingMarkerColor : readSettings.handwritingColor;
  const penWidth = marker ? readSettings.handwritingMarkerWidth : readSettings.handwritingWidth;

  const editorRef = useRef<HandwritingEditor | null>(null);
  // The ink notes as this hook last wrote or read them.
  const inkSignatureRef = useRef('');
  const serviceRef = useRef<HandwritingService | null>(null);
  const [cellEl, setCellEl] = useState<HTMLDivElement | null>(null);
  const [cellRect, setCellRect] = useState<PageRect>(EMPTY_RECT);
  const [pageRect, setPageRect] = useState<PageRect>(EMPTY_RECT);
  const [editorVersion, setEditorVersion] = useState(0);
  const [, forceRender] = useState(0);
  // Bumped when content moves without a page change (scroll, pinch preview).
  const [layoutTick, setLayoutTick] = useState(0);
  // In the reader store so the viewer can make room for the drawing bars.
  const enabled = useReaderStore((state) => !!state.viewStates[bookKey]?.drawingEnabled);
  const setDrawingEnabled = useReaderStore((state) => state.setDrawingEnabled);
  const setEnabled = useCallback(
    (on: boolean) => setDrawingEnabled(bookKey, on),
    [bookKey, setDrawingEnabled],
  );
  const [erasing, setErasing] = useState(false);

  const loadEditor = useCallback(() => {
    const booknotes = getConfig(bookKey)?.booknotes;
    inkSignatureRef.current = inkSignature(booknotes);
    editorRef.current = loadInkEditor(booknotes ?? [], isFixedLayout);
  }, [bookKey, getConfig, isFixedLayout]);

  if (!editorRef.current) loadEditor();

  const location = progress?.location;
  const sectionIndex = progress?.section?.current;
  // Fixed layout pins ink to the page; reflowable ink is kept per section and
  // each stroke is bound to the text or element under it.
  const pageKey =
    sectionIndex === undefined
      ? ''
      : isFixedLayout
        ? fixedPageKey(sectionIndex)
        : sectionPageKey(sectionIndex);

  const visible = !!pageKey;
  const editable = visible;
  useEffect(() => {
    if (!editable) setEnabled(false);
  }, [editable]);

  // Each visit to drawing mode is one drawing session: one ink annotation.
  useEffect(() => {
    if (enabled) serviceRef.current?.setSession(nextInkSession());
  }, [enabled]);

  /** Finish the drawing as one annotation and keep drawing; true when it had ink. */
  const saveDrawing = useCallback(() => serviceRef.current?.endSession() ?? false, []);

  /** Re-read the ink from the booknotes after they changed elsewhere. */
  const reload = useCallback(() => {
    loadEditor();
    serviceRef.current?.setEditor(editorRef.current!);
    setEditorVersion((n) => n + 1);
  }, [loadEditor]);

  // An ink annotation deleted from the sidebar, or ink pulled by sync,
  // changes the notes without this hook; pick it up.
  const booknotes = getConfig(bookKey)?.booknotes;
  useEffect(() => {
    if (inkSignature(booknotes) !== inkSignatureRef.current) reload();
  }, [booknotes, reload]);

  // Write to the store on every committed edit, and to disk shortly after, so
  // ink survives the app being killed before the next page turn.
  useEffect(() => {
    const editor = editorRef.current!;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const save = () => {
      timer = null;
      const config = getConfig(bookKey);
      if (config) void saveConfig(envConfig, bookKey, config, useSettingsStore.getState().settings);
    };
    const unsubscribe = editor.subscribe(() => {
      const config = getConfig(bookKey);
      const view = getView(bookKey);
      if (!config || !view) return;
      const booknotes = withInkNotes(config.booknotes ?? [], editor, {
        cfiOf: (index) => view.getCFI(index),
        describe: (cfi) => describeInk(view, cfi),
      });
      inkSignatureRef.current = inkSignature(booknotes);
      setConfig(bookKey, { booknotes });
      if (timer) clearTimeout(timer);
      timer = setTimeout(save, SAVE_DELAY_MS);
    });
    return () => {
      unsubscribe();
      if (timer) {
        clearTimeout(timer);
        save();
      }
    };
  }, [editorVersion, bookKey, envConfig, getConfig, getView, setConfig, saveConfig]);

  const measure = useCallback(() => {
    if (!cellEl) return;
    const cell = toRect(cellEl.getBoundingClientRect());
    // A scrolled view shows many pages: input spans the whole view and each
    // stroke is routed to the page it is drawn over.
    const page = (isFixedLayout && !scrolled && measureFixedPage(getView(bookKey))) || cell;
    setCellRect((prev) => (sameRect(prev, cell) ? prev : cell));
    setPageRect((prev) => (sameRect(prev, page) ? prev : page));
  }, [cellEl, isFixedLayout, getView, bookKey, scrolled, sectionIndex]);

  // Re-measure on layout changes: window/cell resize, a page turn, scrolling,
  // fixed-layout frames resizing (zoom), and the live transform a pinch
  // applies before the zoom commits, so ink tracks the page frame by frame.
  useEffect(() => {
    if (!cellEl) return;
    let frameRequest = 0;
    const update = () => {
      if (frameRequest) return;
      frameRequest = requestAnimationFrame(() => {
        frameRequest = 0;
        measure();
        setLayoutTick((n) => n + 1);
      });
    };
    measure();
    update();
    const ro = new ResizeObserver(update);
    ro.observe(cellEl);
    const renderer = getView(bookKey)?.renderer;
    for (const frame of isFixedLayout ? pageFrames(getView(bookKey)) : []) ro.observe(frame);
    renderer?.addEventListener('scroll', update);
    const mo = new MutationObserver(update);
    if (renderer?.shadowRoot) {
      mo.observe(renderer.shadowRoot, {
        attributes: true,
        attributeFilter: ['style'],
        subtree: true,
      });
    }
    return () => {
      cancelAnimationFrame(frameRequest);
      ro.disconnect();
      mo.disconnect();
      renderer?.removeEventListener('scroll', update);
    };
  }, [cellEl, measure, isFixedLayout, getView, bookKey, location, sectionIndex]);

  /**
   * In scrolled mode every loaded page or section on screen shows its ink,
   * placed from its own frame or text.
   */
  const scrolledLayers = (): InkLayer[] => {
    const view = getView(bookKey);
    const editor = editorRef.current;
    if (!view || !editor || !cellRect.width) return [];
    return view.renderer.getContents().flatMap(({ doc, index }): InkLayer[] => {
      if (index === undefined) return [];
      if (isFixedLayout) {
        const frame = doc?.defaultView?.frameElement;
        const strokes = editor.strokes(fixedPageKey(index));
        if (!frame || !strokes.length) return [];
        return [{ strokes: [...strokes], rect: toRect(frame.getBoundingClientRect()) }];
      }
      const strokes = editor.strokes(sectionPageKey(index));
      const anchoring = strokes.length ? createInkAnchoring(view, index, cellRect) : null;
      if (!anchoring) return [];
      const placed = strokes.flatMap((stroke) =>
        stroke.anchor
          ? (anchoring.place(stroke) ?? []).map((points) => ({ ...stroke, points }))
          : [],
      );
      return [{ strokes: placed, rect: cellRect }];
    });
  };

  useEffect(() => {
    if (!serviceRef.current) {
      serviceRef.current = new HandwritingService(editorRef.current!, pageKey, pageRect, {
        tool,
        color: penColor,
        widthFraction: penWidth,
      });
      serviceRef.current.onNeedsRender(() => forceRender((n) => n + 1));
    } else {
      serviceRef.current.setPage(pageKey);
      serviceRef.current.updateRect(pageRect);
    }
    // Pen options are applied by their own effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey, pageRect]);

  // Re-resolve text anchors whenever the layout may have moved them: a page
  // turn, a relayout (font, margins, spacing) or a resize.
  useEffect(() => {
    if (isFixedLayout || sectionIndex === undefined) return;
    const view = getView(bookKey);
    serviceRef.current?.setAnchoring(
      view && pageRect.width ? createInkAnchoring(view, sectionIndex, pageRect) : null,
    );
  }, [isFixedLayout, sectionIndex, location, pageRect, layoutTick, getView, bookKey]);

  // Pen choice is a device-wide setting, so a change here retargets the live
  // session without disturbing the ink already committed.
  useEffect(() => {
    serviceRef.current?.setOptions({ tool, color: penColor, widthFraction: penWidth });
  }, [tool, penColor, penWidth]);

  const attach = useCallback(async (el: HTMLElement | null) => {
    if (!el || !serviceRef.current) return;
    await serviceRef.current.attach(el);
  }, []);

  /** Whether a window point (CSS px) lands on ink shown on this page. */
  const hitTest = useCallback(
    (x: number, y: number) => serviceRef.current?.hitTest(x, y) ?? false,
    [],
  );

  /** Turn the page (or scroll a screen) from drawing mode, by its on-screen side. */
  const turnPage = useCallback(
    (side: 'left' | 'right') => {
      const view = getView(bookKey);
      if (scrolled) void (side === 'left' ? view?.prev() : view?.next());
      else if (side === 'left') view?.goLeft();
      else view?.goRight();
    },
    [getView, bookKey, scrolled],
  );

  // Scrolled views show several sections or pages at once: send each stroke
  // to the one it is drawn over, pinned to that section's text or page.
  useEffect(() => {
    const service = serviceRef.current;
    if (!service) return;
    if (!scrolled) {
      service.setRouter(null);
      return;
    }
    service.setRouter((points) => {
      const view = getView(bookKey);
      if (!view || !points.length || !cellRect.width) return null;
      const box = boundsOf(points);
      const [cx, cy] = [box.left + box.width / 2, box.top + box.height / 2];
      let best: { index: number; rect: PageRect } | null = null;
      let bestDistance = Infinity;
      for (const { doc, index } of view.renderer.getContents()) {
        const frame = doc?.defaultView?.frameElement;
        if (!frame || index === undefined) continue;
        const rect = toRect(frame.getBoundingClientRect());
        const dx = Math.max(rect.left - cx, 0, cx - (rect.left + rect.width));
        const dy = Math.max(rect.top - cy, 0, cy - (rect.top + rect.height));
        const distance = Math.hypot(dx, dy);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { index, rect };
        }
      }
      if (!best) return null;
      return isFixedLayout
        ? { page: fixedPageKey(best.index), rect: best.rect, anchoring: null }
        : {
            page: sectionPageKey(best.index),
            rect: cellRect,
            anchoring: createInkAnchoring(view, best.index, cellRect),
          };
    });
  }, [scrolled, isFixedLayout, cellRect, getView, bookKey]);

  const detach = useCallback(async () => {
    await serviceRef.current?.detach();
  }, []);

  useEffect(() => {
    serviceRef.current?.setEraseMode(erasing);
  }, [erasing]);

  /** Persist the tool choice globally, matching how highlight colors persist. */
  const saveReadSettings = useCallback(
    (changes: Partial<ReadSettings>) =>
      saveSysSettings(envConfig, 'globalReadSettings', {
        ...settings.globalReadSettings,
        ...changes,
      }),
    [envConfig, settings.globalReadSettings],
  );

  const selectPenColor = useCallback(
    (color: string) =>
      saveReadSettings(marker ? { handwritingMarkerColor: color } : { handwritingColor: color }),
    [marker, saveReadSettings],
  );

  const selectPenWidth = useCallback(
    (width: number) =>
      saveReadSettings(marker ? { handwritingMarkerWidth: width } : { handwritingWidth: width }),
    [marker, saveReadSettings],
  );

  const selectTool = useCallback(
    (next: InkTool) => {
      setErasing(false);
      saveReadSettings({ handwritingTool: next });
    },
    [saveReadSettings],
  );

  const layers: InkLayer[] = scrolled
    ? [...scrolledLayers(), { strokes: serviceRef.current?.liveStrokes() ?? [], rect: pageRect }]
    : [{ strokes: serviceRef.current?.strokesForRender() ?? [], rect: pageRect }];

  return {
    layers,
    cellRect,
    pageRect,
    containerRef: setCellEl,
    attach,
    detach,
    hitTest,
    turnPage,
    visible,
    editable,
    enabled,
    setEnabled,
    reload,
    erasing,
    setErasing,
    penColor,
    penWidth,
    selectPenColor,
    selectPenWidth,
    tool,
    selectTool,
    saveDrawing,
    undo: () => serviceRef.current?.undo(),
    redo: () => serviceRef.current?.redo(),
  };
}
