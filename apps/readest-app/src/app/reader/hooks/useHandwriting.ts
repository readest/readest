import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useEnv } from '@/context/EnvContext';
import { saveSysSettings } from '@/helpers/settings';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { HandwritingEditor } from '@/services/handwriting/editor';
import { HandwritingService } from '@/services/handwriting/handwritingService';
import { loadHandwritingEditor, withHandwriting } from '@/services/handwriting/persistence';
import type { PageRect } from '@/services/handwriting/coords';

/**
 * Resolves the page key handwriting is stored under.
 *
 * PDF: the actual page index — precise, stable across zoom/rotation.
 * EPUB: the current section's href. Reflowable text has no fixed "page", so
 * ink is anchored to the chapter rather than an exact reflowed page; changing
 * font size or margins will shift where within the section a stroke falls.
 * This is the most robust behavior the current pagination model supports
 * without inventing a competing locator system (see issue #3673 discussion,
 * point 14) — it is a documented limitation, not a bug.
 */
const pageKeyFor = (isPdf: boolean, sectionHref: string, pdfPage: number): string =>
  isPdf ? `pdf:${pdfPage}` : `epub:${sectionHref}`;

export function useHandwriting(bookKey: string) {
  const _ = useTranslation();
  const { getBookData, getConfig, setConfig } = useBookDataStore();
  const { settings } = useSettingsStore();
  const { envConfig } = useEnv();
  const progress = useBookProgress(bookKey);
  const bookData = getBookData(bookKey);
  const isPdf = bookData?.book?.format === 'PDF';
  const { handwritingColor: penColor, handwritingWidth: penWidth } = settings.globalReadSettings;

  const editorRef = useRef<HandwritingEditor | null>(null);
  const serviceRef = useRef<HandwritingService | null>(null);
  const [rect, setRect] = useState<PageRect>({ left: 0, top: 0, width: 0, height: 0 });
  const [, forceRender] = useState(0);
  const [enabled, setEnabled] = useState(false);
  const [erasing, setErasing] = useState(false);

  const pageKey = useMemo(
    () => pageKeyFor(!!isPdf, progress?.sectionHref ?? '', progress?.pageinfo?.current ?? 0),
    [isPdf, progress?.sectionHref, progress?.pageinfo?.current],
  );

  // Load (or lazily create) the editor once per book, from BookConfig.
  if (!editorRef.current) {
    const config = getConfig(bookKey);
    editorRef.current = (config && loadHandwritingEditor(config)) || new HandwritingEditor();
  }

  /**
   * Re-read the ink store from BookConfig. An import merges a new document
   * into the config, and the editor created above holds the pre-import one —
   * without this the canvas keeps drawing strokes that are no longer saved.
   */
  const reload = useCallback(() => {
    const config = getConfig(bookKey);
    if (!config) return;
    editorRef.current = loadHandwritingEditor(config) || new HandwritingEditor();
    serviceRef.current?.setEditor(editorRef.current);
    forceRender((n) => n + 1);
  }, [bookKey, getConfig]);

  const persist = useCallback(() => {
    const config = getConfig(bookKey);
    if (!config || !editorRef.current) return;
    setConfig(bookKey, withHandwriting(config, editorRef.current));
  }, [bookKey, getConfig, setConfig]);

  useEffect(() => {
    if (!serviceRef.current) {
      serviceRef.current = new HandwritingService(editorRef.current!, pageKey, rect, {
        color: penColor,
        widthFraction: penWidth,
      });
      serviceRef.current.onNeedsRender(() => {
        forceRender((n) => n + 1);
        persist();
      });
    } else {
      serviceRef.current.setPage(pageKey);
      serviceRef.current.updateRect(rect);
    }
  }, [pageKey, rect, persist]);

  // Pen choice is a device-wide setting, so a change here retargets the live
  // session without disturbing the ink already committed.
  useEffect(() => {
    serviceRef.current?.setOptions({ color: penColor, widthFraction: penWidth });
  }, [penColor, penWidth]);

  const containerRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setRect({ left: r.left, top: r.top, width: r.width, height: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const attach = useCallback(async (el: HTMLElement | null) => {
    if (!el || !serviceRef.current) return;
    await serviceRef.current.attach(el);
  }, []);

  const detach = useCallback(async () => {
    await serviceRef.current?.detach();
  }, []);

  useEffect(() => {
    serviceRef.current?.setEraseMode(erasing);
  }, [erasing]);

  /** Persist the pen choice globally, matching how highlight colors persist. */
  const selectPenColor = useCallback(
    (color: string) => {
      const next = { ...settings.globalReadSettings, handwritingColor: color };
      saveSysSettings(envConfig, 'globalReadSettings', next);
      // Restyle only when the reader asks for it, never on a bare pen change.
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

  /** Repaint this page's existing ink in the pen currently selected. */
  const restylePage = useCallback(() => {
    if (serviceRef.current?.restylePage()) {
      persist();
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('Restyled handwriting on this page'),
        timeout: 2000,
      });
      return true;
    }
    return false;
  }, [persist]);

  return {
    strokes: serviceRef.current?.strokesForRender() ?? [],
    // Committed strokes only: the live one isn't restyleable or clearable yet.
    hasInk: serviceRef.current?.hasInk() ?? false,
    rect,
    containerRef,
    attach,
    detach,
    enabled,
    setEnabled,
    reload,
    erasing,
    setErasing,
    penColor,
    penWidth,
    selectPenColor,
    selectPenWidth,
    restylePage,
    undo: () => serviceRef.current?.undo(),
    redo: () => serviceRef.current?.redo(),
    clear: () => serviceRef.current?.clear(),
  };
}
