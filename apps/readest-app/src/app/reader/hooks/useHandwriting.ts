import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useBookDataStore } from '@/store/bookDataStore';
import { useBookProgress } from '@/store/readerProgressStore';
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
  const { getBookData, getConfig, setConfig } = useBookDataStore();
  const progress = useBookProgress(bookKey);
  const bookData = getBookData(bookKey);
  const isPdf = bookData?.book?.format === 'PDF';

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

  const persist = useCallback(() => {
    const config = getConfig(bookKey);
    if (!config || !editorRef.current) return;
    setConfig(bookKey, withHandwriting(config, editorRef.current));
  }, [bookKey, getConfig, setConfig]);

  useEffect(() => {
    if (!serviceRef.current) {
      serviceRef.current = new HandwritingService(editorRef.current!, pageKey, rect);
      serviceRef.current.onNeedsRender(() => {
        forceRender((n) => n + 1);
        persist();
      });
    } else {
      serviceRef.current.updateRect(rect);
    }
  }, [pageKey, rect, persist]);

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

  return {
    strokes: serviceRef.current?.strokesForRender() ?? [],
    rect,
    containerRef,
    attach,
    detach,
    enabled,
    setEnabled,
    erasing,
    setErasing,
    undo: () => serviceRef.current?.undo(),
    redo: () => serviceRef.current?.redo(),
    clear: () => serviceRef.current?.clear(),
  };
}
