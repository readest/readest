import { describe, expect, it } from 'vitest';

import { getChapterTickFractions } from '@/utils/progress';
import type { TOCItem } from '@/libs/document';

const toc = (href: string, subitems?: TOCItem[]): TOCItem =>
  ({ id: 0, label: href, href, index: 0, subitems }) as TOCItem;

// 5 spine sections -> sectionFractions has length 6 ([0, .2, .4, .6, .8, 1]),
// matching foliate's `getSectionFractions()` (boundaries incl. start and end).
const sectionFractions = [0, 0.2, 0.4, 0.6, 0.8, 1];

const makeView = (fractions: number[], hrefToIndex: Record<string, number>) => ({
  getSectionFractions: () => fractions,
  resolveNavigation: (href: string) => (href in hrefToIndex ? { index: hrefToIndex[href]! } : null),
});

describe('getChapterTickFractions', () => {
  it('returns chapter-start fractions sorted, excluding the first and last tick', () => {
    const view = makeView(sectionFractions, {
      'ch4.xhtml': 4,
      'ch1.xhtml': 1,
      'ch3.xhtml': 3,
      'ch2.xhtml': 2,
    });

    const ticks = getChapterTickFractions(view, [
      toc('ch4.xhtml'),
      toc('ch1.xhtml'),
      toc('ch3.xhtml'),
      toc('ch2.xhtml'),
    ]);

    // chapter starts = [0.2, 0.4, 0.6, 0.8]; the first (0.2) and last (0.8) are
    // dropped so ticks never crowd the bar's rounded ends.
    expect(ticks).toEqual([0.4, 0.6]);
  });

  it('drops the book-start chapter (section 0) and unresolved hrefs before trimming', () => {
    const view = makeView(sectionFractions, {
      'intro.xhtml': 0,
      'ch1.xhtml': 1,
      'ch2.xhtml': 2,
      'ch3.xhtml': 3,
    });

    const ticks = getChapterTickFractions(view, [
      toc('intro.xhtml'),
      toc('ch1.xhtml'),
      toc('ch2.xhtml'),
      toc('ch3.xhtml'),
      toc('missing.xhtml'),
    ]);

    // interior starts = [0.2, 0.4, 0.6]; first (0.2) and last (0.6) dropped.
    expect(ticks).toEqual([0.4]);
  });

  it('collapses TOC entries (including nested subitems) in one section before trimming', () => {
    const view = makeView(sectionFractions, {
      'ch1.xhtml': 1,
      'ch2.xhtml': 2,
      'ch2.xhtml#sec-a': 2,
      'ch3.xhtml': 3,
      'ch4.xhtml': 4,
    });

    const ticks = getChapterTickFractions(view, [
      toc('ch1.xhtml'),
      toc('ch2.xhtml', [toc('ch2.xhtml#sec-a')]),
      toc('ch3.xhtml'),
      toc('ch4.xhtml'),
    ]);

    // unique starts = [0.2, 0.4, 0.6, 0.8]; first and last dropped.
    expect(ticks).toEqual([0.4, 0.6]);
  });

  it('returns an empty array when there are too few chapters or data is missing', () => {
    const view = makeView(sectionFractions, { 'ch1.xhtml': 1, 'ch2.xhtml': 2 });
    // only 2 interior ticks -> trimming the first and last leaves none
    expect(getChapterTickFractions(view, [toc('ch1.xhtml'), toc('ch2.xhtml')])).toEqual([]);
    expect(getChapterTickFractions(null, [toc('ch1.xhtml')])).toEqual([]);
    expect(getChapterTickFractions(view, [])).toEqual([]);
    expect(getChapterTickFractions(view, null)).toEqual([]);
    expect(getChapterTickFractions(makeView([], {}), [toc('ch1.xhtml')])).toEqual([]);
  });
});
