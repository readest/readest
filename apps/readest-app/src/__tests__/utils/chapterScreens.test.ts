import { describe, expect, it, beforeEach } from 'vitest';

import {
  clearChapterScreens,
  getCalibratedPagePair,
  getMeasuredChapterScreens,
  harvestLoadedChapterScreens,
  recordChapterScreens,
  snapshotChapterScreens,
} from '@/utils/chapterScreens';

const bookKey = 'book-1';
const sections = [{ size: 15000 }, { size: 15000 }, { size: 15000 }];

beforeEach(() => {
  clearChapterScreens(bookKey);
});

describe('chapterScreens', () => {
  it('records and clears per-book measured counts, ignoring non-positive ones', () => {
    recordChapterScreens(bookKey, 1, 10);
    recordChapterScreens(bookKey, 2, 0);
    expect(getMeasuredChapterScreens(bookKey)?.get(1)).toBe(10);
    expect(getMeasuredChapterScreens(bookKey)?.get(2)).toBeUndefined();
    clearChapterScreens(bookKey);
    expect(getMeasuredChapterScreens(bookKey)).toBeUndefined();
  });

  it('estimates from SIZE_PER_LOC bytes per screen before any measurement', () => {
    // 15000 bytes at 1500 bytes/screen -> 10 screens per chapter.
    const pair = getCalibratedPagePair(bookKey, sections, 1, 0, false, 0);
    expect(pair).toEqual({ current: 10, total: 30 });
  });

  it('replaces the measured chapter with its real count and re-rates the rest', () => {
    // Chapter 1 measures 5 screens over 15000 bytes -> 3000 bytes/screen, so
    // the unmeasured chapters now estimate at 5 screens each.
    recordChapterScreens(bookKey, 1, 5);
    const pair = getCalibratedPagePair(bookKey, sections, 1, 2, false, 0);
    expect(pair).toEqual({ current: 7, total: 15 });
  });

  it('drives a chunked current section from the byte-domain fraction', () => {
    recordChapterScreens(bookKey, 0, 15);
    // ratio = 15000/15 = 1000 bytes/screen; the chunked chapter 1 (30000
    // bytes) estimates 30 screens and sits at fraction 0.5 -> 15 screens in.
    const pair = getCalibratedPagePair(
      bookKey,
      [{ size: 15000 }, { size: 30000 }, { size: 15000 }],
      1,
      999,
      true,
      0.5,
    );
    expect(pair).toEqual({ current: 30, total: 60 });
  });

  it('treats a zero-span chapter fraction as position 0', () => {
    const pair = getCalibratedPagePair(bookKey, [{}], 0, 4, true, 0.7);
    expect(pair).toEqual({ current: 0, total: 0 });
  });

  it('computes from the entry snapshot until the next one re-snapshots', () => {
    // The live map keeps tracking the current layout (preload re-layouts
    // jitter counts by a page), but the pair must not drift mid-chapter: it
    // computes from the snapshot taken at chapter entry, and re-entering a
    // chapter adopts every accumulated correction at that boundary.
    const sections2 = [{ size: 15000 }, { size: 15000 }];
    harvestLoadedChapterScreens(bookKey, [
      { index: 0, contentPages: 10 },
      { index: 1, contentPages: 12 },
    ]);
    snapshotChapterScreens(bookKey);
    // live map updates after the snapshot: jitter plus a newly loaded chapter
    harvestLoadedChapterScreens(bookKey, [
      { index: 0, contentPages: 11 },
      { index: 1, contentPages: 13 },
    ]);
    recordChapterScreens(bookKey, 2, 50);

    const before = getCalibratedPagePair(bookKey, sections2, 1, 2, false, 0);
    expect(before).toEqual({ current: 12, total: 22 });

    snapshotChapterScreens(bookKey);
    const after = getCalibratedPagePair(bookKey, sections2, 1, 2, false, 0);
    expect(after).toEqual({ current: 13, total: 24 });
  });
});
