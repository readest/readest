import { useCallback, useEffect, useRef, useState } from 'react';

import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useEnv } from '@/context/EnvContext';
import { saveSysSettings } from '@/helpers/settings';
import { HandwritingEditor } from '@/services/handwriting/editor';
import { HandwritingService } from '@/services/handwriting/handwritingService';
import { loadInkEditor, withInkNotes } from '@/services/handwriting/persistence';
import { fixedPageKey, sectionPageKey } from '@/services/handwriting/pageKey';
import { createInkAnchoring } from '../utils/inkAnchoring';
import type { PageRect } from '@/services/handwriting/coords';
import type { InkStroke } from '@/services/handwriting/model';
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
const measureFixedPage = (view: FoliateView | null, index?: number): PageRect | null => {
  const contents = (view?.renderer.getContents() ?? []).filter(
    (c) => index === undefined || c.index === index,
  );
  const rects = contents.flatMap(({ doc }) => {
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
  // Ink shows in scrolled mode too, but is drawn and edited on pages only.
  const scrolled = !!getViewSettings(bookKey)?.scrolled;
  const { handwritingColor: penColor, handwritingWidth: penWidth } = settings.globalReadSettings;

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
  const [enabled, setEnabled] = useState(false);
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
  const editable = visible && !scrolled;
  useEffect(() => {
    if (!editable) setEnabled(false);
  }, [editable]);

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
    // A scroll strip shows many pages; the current one is the editable page.
    const page =
      (isFixedLayout && measureFixedPage(getView(bookKey), scrolled ? sectionIndex : undefined)) ||
      cell;
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
   * placed from its own frame or text; read-only, as editing needs a page.
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
    serviceRef.current?.setOptions({ color: penColor, widthFraction: penWidth });
  }, [penColor, penWidth]);

  const attach = useCallback(async (el: HTMLElement | null) => {
    if (!el || !serviceRef.current) return;
    await serviceRef.current.attach(el);
  }, []);

  /** Whether a window point (CSS px) lands on ink shown on this page. */
  const hitTest = useCallback(
    (x: number, y: number) => serviceRef.current?.hitTest(x, y) ?? false,
    [],
  );

  const detach = useCallback(async () => {
    await serviceRef.current?.detach();
  }, []);

  useEffect(() => {
    serviceRef.current?.setEraseMode(erasing);
  }, [erasing]);

  /** Persist the pen choice globally, matching how highlight colors persist. */
  const selectPenColor = useCallback(
    (color: string) => {
      saveSysSettings(envConfig, 'globalReadSettings', {
        ...settings.globalReadSettings,
        handwritingColor: color,
      });
    },
    [envConfig, settings.globalReadSettings],
  );

  const selectPenWidth = useCallback(
    (width: number) => {
      saveSysSettings(envConfig, 'globalReadSettings', {
        ...settings.globalReadSettings,
        handwritingWidth: width,
      });
    },
    [envConfig, settings.globalReadSettings],
  );

  const layers: InkLayer[] = scrolled
    ? scrolledLayers()
    : [{ strokes: serviceRef.current?.strokesForRender() ?? [], rect: pageRect }];

  return {
    layers,
    // Committed strokes only: the live one isn't restyleable or clearable yet.
    hasInk: serviceRef.current?.hasInk() ?? false,
    cellRect,
    pageRect,
    containerRef: setCellEl,
    attach,
    detach,
    hitTest,
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
    undo: () => serviceRef.current?.undo(),
    redo: () => serviceRef.current?.redo(),
    clear: () => serviceRef.current?.clear(),
  };
}
