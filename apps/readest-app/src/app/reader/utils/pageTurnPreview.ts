import { useSyncExternalStore } from 'react';
import type { SectionItem } from '@/libs/document';
import type { BookProgress } from '@/types/book';
import type { FoliateView } from '@/types/view';
import { SIZE_PER_LOC, SIZE_PER_TIME_UNIT } from '@/services/constants';
import { CHUNKED_SECTION_THRESHOLD } from '@/utils/chapterScreens';

// Matches paginator.js CHUNK_SIZE for estimating screens in >512 KB chunked sections.
const CHUNK_SIZE_BYTES = 256 * 1024;

export interface PageTurnPreviewSnapshot {
  /** Display-only progress override; never written to readerProgressStore. */
  progress: BookProgress;
  /** 0-based screen index within the target section (mirrors view.renderer.page). */
  page: number;
  /** Total screens in the target section (mirrors view.renderer.pages). */
  pages: number;
  /** Whether the target page is the final screen of the book (mirrors view.renderer.atEnd). */
  atEnd: boolean;
}

interface PreviewEntry {
  token: number;
  snapshot: PageTurnPreviewSnapshot;
}

const previews = new Map<string, PreviewEntry>();
const listenersByBook = new Map<string, Set<() => void>>();
let nextToken = 0;

const emit = (bookKey: string) => {
  const listeners = listenersByBook.get(bookKey);
  if (!listeners) return;
  for (const listener of listeners) listener();
};

/**
 * Temporarily override the footer/header display state for `bookKey` while a
 * background `previewPage()` capture paints an adjacent sheet under the native
 * cover. Returns an idempotent release function that clears only this token.
 */
export const setPageTurnPreview = (
  bookKey: string,
  snapshot: PageTurnPreviewSnapshot | null,
): (() => void) => {
  if (!snapshot) {
    clearPageTurnPreview(bookKey);
    return () => {};
  }
  const token = ++nextToken;
  previews.set(bookKey, { token, snapshot });
  emit(bookKey);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (previews.get(bookKey)?.token === token) {
      previews.delete(bookKey);
      emit(bookKey);
    }
  };
};

/** Clear any active page-turn preview for `bookKey`. */
export const clearPageTurnPreview = (bookKey: string) => {
  if (!previews.delete(bookKey)) return;
  emit(bookKey);
};

/** Read the current display-only preview snapshot for `bookKey` without subscribing. */
export const getPageTurnPreview = (bookKey: string): PageTurnPreviewSnapshot | null =>
  previews.get(bookKey)?.snapshot ?? null;

/** Subscribe a reader chrome component (ProgressBar, SectionInfo) to `bookKey`'s preview state. */
export const usePageTurnPreview = (bookKey: string): PageTurnPreviewSnapshot | null =>
  useSyncExternalStore(
    (listener) => {
      let set = listenersByBook.get(bookKey);
      if (!set) {
        set = new Set();
        listenersByBook.set(bookKey, set);
      }
      set.add(listener);
      return () => {
        set!.delete(listener);
        if (set!.size === 0) listenersByBook.delete(bookKey);
      };
    },
    () => previews.get(bookKey)?.snapshot ?? null,
    () => null,
  );

const parsePageTurnKey = (
  key: string | null | undefined,
): { unit: number; localPage: number } | null => {
  if (!key) return null;
  const sep = key.indexOf(':');
  if (sep <= 0 || sep >= key.length - 1) return null;
  const unit = Number(key.slice(0, sep));
  const localPage = Number(key.slice(sep + 1));
  if (!Number.isInteger(unit) || !Number.isInteger(localPage) || unit < 0 || localPage < 0) {
    return null;
  }
  return { unit, localPage };
};

const getLinearTotalBytes = (sections: SectionItem[] | undefined): number => {
  if (!sections?.length) return 0;
  let total = 0;
  for (const section of sections) {
    if (section.linear !== 'no' && (section.size ?? 0) > 0) {
      total += section.size!;
    }
  }
  return total;
};

const isLastLinearSection = (
  sections: SectionItem[] | undefined,
  spine: number,
  sectionTotal: number,
): boolean => {
  if (!sections?.length) return spine >= Math.max(0, sectionTotal - 1);
  for (let i = spine + 1; i < sections.length; i++) {
    if (sections[i]?.linear !== 'no') return false;
  }
  return true;
};

const findAdjacentLinearSpine = (
  sections: SectionItem[] | undefined,
  fromSpine: number,
  delta: 1 | -1,
  sectionTotal: number,
): number | null => {
  const limit = sections?.length ?? sectionTotal;
  for (let i = fromSpine + delta; i >= 0 && i < limit; i += delta) {
    if (!sections || sections[i]?.linear !== 'no') return i;
  }
  return null;
};

const buildDerivedMetrics = ({
  progress,
  targetStartFraction,
  targetNextFraction,
  sectionEnd,
  sizeTotal,
  atEnd,
}: {
  progress: BookProgress;
  targetStartFraction: number;
  targetNextFraction: number;
  sectionEnd: number;
  sizeTotal: number;
  atEnd: boolean;
}) => {
  const totalLoc =
    progress.pageinfo.total > 0
      ? progress.pageinfo.total
      : sizeTotal > 0
        ? Math.ceil(sizeTotal / SIZE_PER_LOC)
        : 0;
  if (sizeTotal > 0) {
    const size = targetStartFraction * sizeTotal;
    const nextSize = targetNextFraction * sizeTotal;
    const currentLoc =
      atEnd && totalLoc > 0
        ? totalLoc - 1
        : Math.min(Math.max(0, totalLoc - 1), Math.max(0, Math.floor(size / SIZE_PER_LOC + 1e-9)));
    const nextLoc = Math.min(
      totalLoc,
      Math.max(currentLoc, Math.floor(nextSize / SIZE_PER_LOC + 1e-9)),
    );
    const remainingSectionBytes = Math.max(0, (sectionEnd - targetStartFraction) * sizeTotal);
    const remainingTotalBytes = Math.max(0, (1 - targetStartFraction) * sizeTotal);
    return {
      pageinfo: {
        current: currentLoc,
        next: nextLoc,
        total: totalLoc,
      },
      timeinfo: {
        section: remainingSectionBytes / SIZE_PER_TIME_UNIT,
        total: remainingTotalBytes / SIZE_PER_TIME_UNIT,
      },
    };
  }
  const currentLoc =
    atEnd && totalLoc > 0
      ? totalLoc - 1
      : totalLoc > 0
        ? Math.min(totalLoc - 1, Math.max(0, Math.floor(targetStartFraction * totalLoc + 1e-9)))
        : progress.pageinfo.current;
  const nextLoc =
    totalLoc > 0
      ? Math.min(totalLoc, Math.max(currentLoc, Math.floor(targetNextFraction * totalLoc + 1e-9)))
      : progress.pageinfo.next;
  return {
    pageinfo: {
      current: currentLoc,
      next: nextLoc,
      total: totalLoc,
    },
    timeinfo: progress.timeinfo,
  };
};

/**
 * Estimate the target adjacent page's display progress and renderer screen
 * coordinates for a `previewPage(forward)` capture without emitting a real
 * `relocate` or mutating reading progress.
 */
export const computePageTurnPreview = ({
  forward,
  progress,
  view,
  sections,
  isFixedLayout,
}: {
  forward: boolean;
  progress: BookProgress | null;
  view: FoliateView | null | undefined;
  sections: SectionItem[] | undefined;
  isFixedLayout: boolean;
}): PageTurnPreviewSnapshot | null => {
  if (!progress || !view?.renderer || isFixedLayout) return null;
  const delta: 1 | -1 = forward ? 1 : -1;
  const cur = parsePageTurnKey(view.renderer.getPageTurnKey?.(0));
  const target = parsePageTurnKey(view.renderer.getPageTurnKey?.(delta));
  if (!cur || !target) return null;

  const sectionFractions = view.getSectionFractions?.() ?? [];
  const sizeTotal = getLinearTotalBytes(sections);
  const sectionTotal = progress.section.total || sections?.length || 1;
  const curSpine = progress.section.current;

  if (target.unit === cur.unit) {
    const curPages = Math.max(1, view.renderer.pages || cur.localPage + 1);
    const curPage = Number.isFinite(view.renderer.page) ? view.renderer.page : cur.localPage;
    const targetPage = Math.max(0, Math.min(curPages - 1, curPage + delta));
    const atEnd =
      delta > 0 &&
      isLastLinearSection(sections, curSpine, sectionTotal) &&
      targetPage >= curPages - 1;

    const sectionStart = sectionFractions[curSpine] ?? 0;
    const sectionEnd = sectionFractions[curSpine + 1] ?? 1;
    const sectionSpan = Math.max(0, sectionEnd - sectionStart);
    const sectionSize = sections?.[curSpine]?.size ?? 0;
    const isChunked = sectionSize > CHUNKED_SECTION_THRESHOLD;
    const chunkFactor = isChunked ? Math.max(1, Math.ceil(sectionSize / CHUNK_SIZE_BYTES)) : 1;
    const effectivePages = Math.max(1, curPages * chunkFactor);
    const pageFraction = 1 / effectivePages;
    const fractionStep = sectionSpan * pageFraction;

    const curNextFraction = Number.isFinite(progress.fraction)
      ? progress.fraction
      : sectionStart + Math.min(1, (curPage + 1) * pageFraction) * sectionSpan;
    const minNextFraction = sectionStart + Math.min(sectionSpan, fractionStep);
    const targetNextFraction = atEnd
      ? 1
      : Math.max(minNextFraction, Math.min(sectionEnd, curNextFraction + delta * fractionStep));
    const targetStartFraction = Math.max(sectionStart, targetNextFraction - fractionStep);

    const { pageinfo, timeinfo } = buildDerivedMetrics({
      progress,
      targetStartFraction,
      targetNextFraction,
      sectionEnd,
      sizeTotal,
      atEnd,
    });

    return {
      progress: {
        ...progress,
        fraction: targetNextFraction,
        pageinfo,
        timeinfo,
        page: pageinfo.current + 1,
      },
      page: targetPage,
      pages: curPages,
      atEnd,
    };
  }

  // Adjacent preloaded unit (chapter boundary). Skip chunked sections because
  // an adjacent unit there may be another chunk of the same spine item.
  if ((sections?.[curSpine]?.size ?? 0) > CHUNKED_SECTION_THRESHOLD) return null;
  const targetSpine = findAdjacentLinearSpine(sections, curSpine, delta, sectionTotal);
  if (targetSpine === null) return null;
  if ((sections?.[targetSpine]?.size ?? 0) > CHUNKED_SECTION_THRESHOLD) return null;

  const columnCount = Math.max(1, view.renderer.columnCount ?? 1);
  const loadedTarget = view.renderer.getContents?.().find((item) => item.index === targetSpine);
  const measuredPages =
    loadedTarget?.contentPages && loadedTarget.contentPages > 0
      ? Math.ceil(loadedTarget.contentPages / columnCount)
      : 0;
  const targetPages = Math.max(1, target.localPage + 1, measuredPages);
  const targetPage = Math.max(0, Math.min(targetPages - 1, target.localPage));
  const atEnd =
    delta > 0 &&
    isLastLinearSection(sections, targetSpine, sectionTotal) &&
    targetPage >= targetPages - 1;

  const sectionStart = sectionFractions[targetSpine] ?? 0;
  const sectionEnd = sectionFractions[targetSpine + 1] ?? 1;
  const sectionSpan = Math.max(0, sectionEnd - sectionStart);
  const pageFraction = 1 / targetPages;
  const targetStartFraction = sectionStart + (targetPage / targetPages) * sectionSpan;
  const targetNextFraction = atEnd
    ? 1
    : Math.min(sectionEnd, targetStartFraction + pageFraction * sectionSpan);

  const { pageinfo, timeinfo } = buildDerivedMetrics({
    progress,
    targetStartFraction,
    targetNextFraction,
    sectionEnd,
    sizeTotal,
    atEnd,
  });

  const targetMeta = view.getProgressOf?.(targetSpine);
  const sectionLabel =
    targetMeta && targetMeta.tocItem !== undefined
      ? (targetMeta.tocItem?.label ?? '')
      : progress.sectionLabel;
  const sectionHref =
    targetMeta && targetMeta.tocItem !== undefined
      ? (targetMeta.tocItem?.href ?? '')
      : progress.sectionHref;
  const pageItem =
    targetMeta && targetMeta.pageItem !== undefined ? targetMeta.pageItem : progress.pageItem;

  return {
    progress: {
      ...progress,
      index: targetSpine,
      section: {
        current: targetSpine,
        total: sectionTotal,
      },
      sectionLabel,
      sectionHref,
      pageItem,
      fraction: targetNextFraction,
      pageinfo,
      timeinfo,
      page: pageinfo.current + 1,
    },
    page: targetPage,
    pages: targetPages,
    atEnd,
  };
};
