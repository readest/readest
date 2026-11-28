import { describe, expect, it, beforeEach } from 'vitest';
import type { SectionItem } from '@/libs/document';
import type { BookProgress } from '@/types/book';
import type { FoliateView } from '@/types/view';
import { SIZE_PER_LOC } from '@/services/constants';
import {
  clearChapterScreens,
  recordChapterScreens,
  snapshotChapterScreens,
} from '@/utils/chapterScreens';
import {
  clearPageTurnPreview,
  computePageTurnPreview,
  getPageTurnPreview,
  setPageTurnPreview,
} from '@/app/reader/utils/pageTurnPreview';
import { getScreenPageInfo } from '@/app/reader/utils/screenPages';

const makeSections = (sizes: Array<{ size: number; linear?: string }>): SectionItem[] =>
  sizes.map((item, i) => ({
    id: `sec-${i}`,
    href: `ch${i}.xhtml`,
    cfi: `/6/${(i + 1) * 2}`,
    size: item.size,
    linear: item.linear ?? 'yes',
    createDocument: async () => document,
  }));

const makeProgress = (overrides: Partial<BookProgress> = {}): BookProgress => ({
  location: 'epubcfi(/6/2!/4/2)',
  sectionHref: 'ch0.xhtml',
  sectionLabel: 'Chapter 1',
  pageItem: undefined,
  section: { current: 0, next: 1, total: 2 },
  pageinfo: { current: 0, next: 1, total: 10 },
  timeinfo: { section: 5, total: 10 },
  fraction: 0.1,
  index: 0,
  range: {} as Range,
  page: 1,
  ...overrides,
});

const makeView = ({
  keys,
  page = 0,
  pages = 5,
  columnCount = 1,
  sectionFractions = [0, 0.5, 1],
  contents = [],
  progressOf,
}: {
  keys: Record<number, string | null>;
  page?: number;
  pages?: number;
  columnCount?: number;
  sectionFractions?: number[];
  contents?: Array<{ index: number; contentPages: number }>;
  progressOf?: (index: number) => {
    tocItem?: { label: string; href: string } | null;
    pageItem?: null;
  };
}): FoliateView =>
  ({
    renderer: {
      page,
      pages,
      columnCount,
      atEnd: false,
      getPageTurnKey: (delta = 0) => keys[delta] ?? null,
      getContents: () => contents.map((c) => ({ doc: document, ...c })),
    },
    getSectionFractions: () => sectionFractions,
    getProgressOf: (index: number) => progressOf?.(index) ?? {},
  }) as unknown as FoliateView;

describe('pageTurnPreview', () => {
  beforeEach(() => {
    clearPageTurnPreview('book-1');
    clearChapterScreens('book-1');
  });

  it('advances page, fraction, and location for same-section forward preview', () => {
    const sections = makeSections([{ size: 5 * SIZE_PER_LOC }, { size: 5 * SIZE_PER_LOC }]);
    const view = makeView({
      keys: { 0: '0:0', 1: '0:1' },
      page: 0,
      pages: 5,
      sectionFractions: [0, 0.5, 1],
    });
    const progress = makeProgress({
      fraction: 0.1,
      pageinfo: { current: 0, next: 1, total: 10 },
    });

    const preview = computePageTurnPreview({
      forward: true,
      progress,
      view,
      sections,
      isFixedLayout: false,
    });

    expect(preview).not.toBeNull();
    expect(preview!.page).toBe(1);
    expect(preview!.pages).toBe(5);
    expect(preview!.atEnd).toBe(false);
    expect(preview!.progress.fraction).toBeCloseTo(0.2, 6);
    expect(preview!.progress.pageinfo).toEqual({ current: 1, next: 2, total: 10 });
    expect(preview!.progress.sectionLabel).toBe('Chapter 1');
  });

  it('decrements page, fraction, and location for same-section backward preview', () => {
    const sections = makeSections([{ size: 5 * SIZE_PER_LOC }, { size: 5 * SIZE_PER_LOC }]);
    const view = makeView({
      keys: { 0: '0:2', '-1': '0:1' },
      page: 2,
      pages: 5,
      sectionFractions: [0, 0.5, 1],
    });
    const progress = makeProgress({
      fraction: 0.3,
      pageinfo: { current: 2, next: 3, total: 10 },
    });

    const preview = computePageTurnPreview({
      forward: false,
      progress,
      view,
      sections,
      isFixedLayout: false,
    });

    expect(preview).not.toBeNull();
    expect(preview!.page).toBe(1);
    expect(preview!.atEnd).toBe(false);
    expect(preview!.progress.fraction).toBeCloseTo(0.2, 6);
    expect(preview!.progress.pageinfo).toEqual({ current: 1, next: 2, total: 10 });
  });

  it('marks atEnd on the final screen of the last linear section', () => {
    const sections = makeSections([
      { size: 5 * SIZE_PER_LOC },
      { size: 5 * SIZE_PER_LOC },
      { size: 100, linear: 'no' },
    ]);
    const view = makeView({
      keys: { 0: '1:3', 1: '1:4' },
      page: 3,
      pages: 5,
      sectionFractions: [0, 0.5, 1, 1],
    });
    const progress = makeProgress({
      index: 1,
      section: { current: 1, next: 2, total: 3 },
      fraction: 0.9,
      pageinfo: { current: 8, next: 9, total: 10 },
    });

    const preview = computePageTurnPreview({
      forward: true,
      progress,
      view,
      sections,
      isFixedLayout: false,
    });

    expect(preview).not.toBeNull();
    expect(preview!.page).toBe(4);
    expect(preview!.atEnd).toBe(true);
    expect(preview!.progress.fraction).toBe(1);
    expect(preview!.progress.pageinfo.current).toBe(9);
  });

  it('updates section label, pages, and progress when previewing across a preloaded chapter boundary', () => {
    const sections = makeSections([
      { size: 5 * SIZE_PER_LOC },
      { size: 100, linear: 'no' },
      { size: 5 * SIZE_PER_LOC },
    ]);
    const view = makeView({
      keys: { 0: '0:4', 1: '2:0' },
      page: 4,
      pages: 5,
      sectionFractions: [0, 0.5, 0.5, 1],
      contents: [
        { index: 0, contentPages: 5 },
        { index: 2, contentPages: 8 },
      ],
      progressOf: (index) =>
        index === 2 ? { tocItem: { label: 'Chapter 2', href: 'ch2.xhtml' }, pageItem: null } : {},
    });
    const progress = makeProgress({
      index: 0,
      section: { current: 0, next: 1, total: 3 },
      fraction: 0.5,
      pageinfo: { current: 4, next: 5, total: 10 },
    });

    const preview = computePageTurnPreview({
      forward: true,
      progress,
      view,
      sections,
      isFixedLayout: false,
    });

    expect(preview).not.toBeNull();
    expect(preview!.progress.section.current).toBe(2);
    expect(preview!.progress.sectionLabel).toBe('Chapter 2');
    expect(preview!.progress.sectionHref).toBe('ch2.xhtml');
    expect(preview!.page).toBe(0);
    expect(preview!.pages).toBe(8);
    expect(preview!.progress.pageinfo.current).toBe(5);
  });

  it('computes calibrated screen pages accurately using rendererOverride', () => {
    const sections = makeSections([{ size: 5 * SIZE_PER_LOC }, { size: 5 * SIZE_PER_LOC }]);
    recordChapterScreens('book-1', 0, 5);
    recordChapterScreens('book-1', 1, 5);
    snapshotChapterScreens('book-1');

    const view = makeView({
      keys: { 0: '0:2', 1: '0:3', '-1': '0:1' },
      page: 2,
      pages: 5,
      sectionFractions: [0, 0.5, 1],
    });
    const progress = makeProgress({
      fraction: 0.3,
      pageinfo: { current: 2, next: 3, total: 10 },
    });

    const currentPair = getScreenPageInfo('book-1', view, sections, progress);
    expect(currentPair).toEqual({ current: 2, next: 2, total: 10 });

    const nextPreview = computePageTurnPreview({
      forward: true,
      progress,
      view,
      sections,
      isFixedLayout: false,
    })!;
    const nextPair = getScreenPageInfo('book-1', view, sections, nextPreview.progress, {
      page: nextPreview.page,
      atEnd: nextPreview.atEnd,
    });
    expect(nextPair).toEqual({ current: 3, next: 3, total: 10 });

    const prevPreview = computePageTurnPreview({
      forward: false,
      progress,
      view,
      sections,
      isFixedLayout: false,
    })!;
    const prevPair = getScreenPageInfo('book-1', view, sections, prevPreview.progress, {
      page: prevPreview.page,
      atEnd: prevPreview.atEnd,
    });
    expect(prevPair).toEqual({ current: 1, next: 1, total: 10 });
  });

  it('guards release tokens so a stale preview cleanup cannot clear a newer preview', () => {
    const first = {
      progress: makeProgress({ page: 2 }),
      page: 1,
      pages: 5,
      atEnd: false,
    };
    const second = {
      progress: makeProgress({ page: 3 }),
      page: 2,
      pages: 5,
      atEnd: false,
    };

    const releaseFirst = setPageTurnPreview('book-1', first);
    expect(getPageTurnPreview('book-1')).toBe(first);

    const releaseSecond = setPageTurnPreview('book-1', second);
    expect(getPageTurnPreview('book-1')).toBe(second);

    // Late release from the superseded preview must not drop the active one.
    releaseFirst();
    expect(getPageTurnPreview('book-1')).toBe(second);

    releaseSecond();
    expect(getPageTurnPreview('book-1')).toBeNull();
  });

  it('returns null for fixed-layout books', () => {
    const sections = makeSections([{ size: 5 * SIZE_PER_LOC }]);
    const view = makeView({ keys: { 0: '0:0', 1: '0:1' } });
    expect(
      computePageTurnPreview({
        forward: true,
        progress: makeProgress(),
        view,
        sections,
        isFixedLayout: true,
      }),
    ).toBeNull();
  });
});
