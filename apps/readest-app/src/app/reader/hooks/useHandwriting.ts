import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useEnv } from '@/context/EnvContext';
import { saveSysSettings } from '@/helpers/settings';
import { HandwritingEditor } from '@/services/handwriting/editor';
import { HandwritingService } from '@/services/handwriting/handwritingService';
import { loadHandwritingEditor, withHandwriting } from '@/services/handwriting/persistence';
import { fixedPageKey, reflowPageKeys } from '@/services/handwriting/pageKey';
import type { PageRect } from '@/services/handwriting/coords';
import type { FoliateView } from '@/types/view';

const EMPTY_RECT: PageRect = { left: 0, top: 0, width: 0, height: 0 };
const SAVE_DELAY_MS = 1000;

const toRect = (r: DOMRect): PageRect => ({
  left: r.left,
  top: r.top,
  width: r.width,
  height: r.height,
});

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
  const rects = pageFrames(view).map((frame) => frame.getBoundingClientRect());
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
  // Ink is drawn per page; a scrolled view has no page to pin it to.
  const scrolled = !!getViewSettings(bookKey)?.scrolled;
  const { handwritingColor: penColor, handwritingWidth: penWidth } = settings.globalReadSettings;

  const editorRef = useRef<HandwritingEditor | null>(null);
  // Ink from a newer schema can't be read, so it must never be overwritten.
  const readOnlyRef = useRef(false);
  const serviceRef = useRef<HandwritingService | null>(null);
  const [cellEl, setCellEl] = useState<HTMLDivElement | null>(null);
  const [cellRect, setCellRect] = useState<PageRect>(EMPTY_RECT);
  const [pageRect, setPageRect] = useState<PageRect>(EMPTY_RECT);
  const [editorVersion, setEditorVersion] = useState(0);
  const [, forceRender] = useState(0);
  const [enabled, setEnabled] = useState(false);
  const [erasing, setErasing] = useState(false);

  const loadEditor = useCallback(() => {
    const config = getConfig(bookKey);
    const loaded = config ? loadHandwritingEditor(config) : new HandwritingEditor();
    readOnlyRef.current = !loaded;
    editorRef.current = loaded ?? new HandwritingEditor();
  }, [bookKey, getConfig]);

  if (!editorRef.current) loadEditor();

  const location = progress?.location;
  const sectionIndex = progress?.section?.current;
  // The first key takes new strokes; the rest are other anchors on this page.
  const pageKeys = useMemo(() => {
    if (isFixedLayout) return [fixedPageKey(sectionIndex ?? 0)];
    return location ? reflowPageKeys(location, editorRef.current!.pageKeys()) : [''];
    // editorVersion: a reload brings in anchors the old editor didn't have.
  }, [isFixedLayout, sectionIndex, location, editorVersion]);
  const [pageKey = '', ...alsoKeys] = pageKeys;

  const available = !scrolled && !readOnlyRef.current && !!pageKey;
  useEffect(() => {
    if (!available) setEnabled(false);
  }, [available]);

  /**
   * Re-read the ink store from BookConfig. An import merges a new document
   * into the config, and the editor created above holds the pre-import one —
   * without this the canvas keeps drawing strokes that are no longer saved.
   */
  const reload = useCallback(() => {
    loadEditor();
    serviceRef.current?.setEditor(editorRef.current!);
    setEditorVersion((n) => n + 1);
  }, [loadEditor]);

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
      if (!config || readOnlyRef.current) return;
      setConfig(bookKey, withHandwriting(config, editor));
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
  }, [editorVersion, bookKey, envConfig, getConfig, setConfig, saveConfig]);

  const measure = useCallback(() => {
    if (!cellEl) return;
    const cell = toRect(cellEl.getBoundingClientRect());
    const page = (isFixedLayout && measureFixedPage(getView(bookKey))) || cell;
    setCellRect((prev) => (sameRect(prev, cell) ? prev : cell));
    setPageRect((prev) => (sameRect(prev, page) ? prev : page));
  }, [cellEl, isFixedLayout, getView, bookKey]);

  // Re-measure on layout changes: window/cell resize, a page turn, and for
  // fixed layout the page frames resizing (zoom) or the renderer panning.
  useEffect(() => {
    if (!cellEl) return;
    measure();
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(cellEl);
    const renderer = isFixedLayout ? getView(bookKey)?.renderer : null;
    if (renderer) {
      for (const frame of pageFrames(getView(bookKey))) ro.observe(frame);
      renderer.addEventListener('scroll', measure);
    }
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer?.removeEventListener('scroll', measure);
    };
  }, [cellEl, measure, isFixedLayout, getView, bookKey, location, sectionIndex]);

  useEffect(() => {
    if (!serviceRef.current) {
      serviceRef.current = new HandwritingService(editorRef.current!, pageKey, pageRect, {
        color: penColor,
        widthFraction: penWidth,
      });
      serviceRef.current.onNeedsRender(() => forceRender((n) => n + 1));
    } else {
      serviceRef.current.updateRect(pageRect);
    }
    serviceRef.current.setPage(pageKey, alsoKeys);
    // Pen options are applied by their own effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKeys, pageRect]);

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

  return {
    strokes: serviceRef.current?.strokesForRender() ?? [],
    // Committed strokes only: the live one isn't restyleable or clearable yet.
    hasInk: serviceRef.current?.hasInk() ?? false,
    cellRect,
    pageRect,
    containerRef: setCellEl,
    attach,
    detach,
    hitTest,
    available,
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
