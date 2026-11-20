// @vitest-environment node
import { describe, expect, it, beforeEach } from 'vitest';

import {
  clearChapterScreens,
  getCalibratedPagePair,
  getChapterScreensVersion,
  getMeasuredChapterScreens,
  getScreenPageMap,
  growChapterScreens,
  harvestLoadedChapterScreens,
  locateScreenPage,
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
    // 15000 bytes at 1500 bytes/screen -> 10 full screens and a partial one.
    const pair = getCalibratedPagePair(bookKey, sections, 1, 0, false, 0);
    expect(pair).toEqual({ current: 11, total: 33 });
  });

  it('replaces the measured chapter with its real count and re-rates the rest', () => {
    // Chapter 1 measures 5 screens over 15000 bytes, the last one half full
    // on average -> 3333 bytes/screen, so the unmeasured chapters now
    // estimate at 4 full screens and a partial one each.
    recordChapterScreens(bookKey, 1, 5);
    const pair = getCalibratedPagePair(bookKey, sections, 1, 2, false, 0);
    expect(pair).toEqual({ current: 7, total: 15 });
  });

  it('drives a chunked current section from the byte-domain fraction', () => {
    recordChapterScreens(bookKey, 0, 15);
    // ratio = 15000/14.5 = 1034 bytes/screen; the chunked chapter 1 (31000
    // bytes) estimates 30 screens and sits at fraction 0.5 -> 15 screens in.
    const pair = getCalibratedPagePair(
      bookKey,
      [{ size: 15000 }, { size: 31000 }, { size: 15000 }],
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

  it('counts whole screens per chapter, so a measured last chapter ends on total / total', () => {
    // Chapter 2 measures 2 screens over 3000 bytes -> 2000 bytes/screen; the
    // 2500-byte chapters before it estimate two whole screens each.
    // Fractional estimates left the last screen reading 5 / 6 (#7453).
    recordChapterScreens(bookKey, 2, 2);
    const book = [{ size: 2500 }, { size: 2500 }, { size: 3000 }];
    expect(getCalibratedPagePair(bookKey, book, 2, 1, false, 0)).toEqual({ current: 5, total: 6 });
  });

  it('rates text chapters by their full screens, not by a one-screen cover', () => {
    // A 500-byte cover and a 3000-byte title page fill one screen each.
    // 15000-byte chapters then estimate 5 screens; rating them by 3500 bytes
    // / 2 screens estimated 9 each (#7453).
    recordChapterScreens(bookKey, 0, 1);
    recordChapterScreens(bookKey, 1, 1);
    const book = [{ size: 500 }, { size: 3000 }, { size: 15000 }, { size: 15000 }];
    expect(getCalibratedPagePair(bookKey, book, 1, 0, false, 0)).toEqual({ current: 1, total: 12 });
  });

  it('gives spine items paging skips (linear="no") no screens (#7453)', () => {
    // A trailing notes item can't be paged into, so counting it left the last
    // screen a page short of the total.
    const book = [{ size: 3000 }, { size: 3000 }, { size: 1500, linear: 'no' }];
    recordChapterScreens(bookKey, 0, 2);
    recordChapterScreens(bookKey, 1, 2);
    recordChapterScreens(bookKey, 2, 1);
    expect(getCalibratedPagePair(bookKey, book, 1, 1, false, 0)).toEqual({ current: 3, total: 4 });
    // Dragging the slider to 100% lands in that item: it reads the last page.
    expect(getCalibratedPagePair(bookKey, book, 2, 0, false, 0)).toEqual({ current: 3, total: 4 });
  });

  it('lets a chapter that grew after its entry snapshot run past the total', () => {
    // Late images or fonts can add screens after entry. The readout keeps one
    // page per turn and the total follows, rather than reading past it.
    const book = [{ size: 3000 }, { size: 3000 }];
    recordChapterScreens(bookKey, 0, 2);
    recordChapterScreens(bookKey, 1, 2);
    expect(getCalibratedPagePair(bookKey, book, 1, 3, false, 0)).toEqual({ current: 5, total: 6 });
  });

  it('grows the snapshot once the reader pages past a chapter that grew', () => {
    const book = [{ size: 3000 }, { size: 3000 }, { size: 3000 }];
    recordChapterScreens(bookKey, 0, 2);
    recordChapterScreens(bookKey, 1, 2);
    recordChapterScreens(bookKey, 2, 2);
    snapshotChapterScreens(bookKey);
    // Late images lay chapter 1 out on four screens.
    recordChapterScreens(bookKey, 1, 4);
    growChapterScreens(bookKey, 1, 1);
    expect(getScreenPageMap(bookKey, book).total).toBe(6);

    const version = getChapterScreensVersion();
    growChapterScreens(bookKey, 1, 2);
    const map = getScreenPageMap(bookKey, book);
    expect(map).toEqual({ counts: [2, 4, 2], starts: [0, 2, 6], total: 8 });
    expect(getChapterScreensVersion()).toBeGreaterThan(version);
    // Jumps reach both added pages, and the next chapter moves with them.
    expect(locateScreenPage(map, 4)).toEqual({ index: 1, fraction: 2 / 3 });
    expect(locateScreenPage(map, 5)).toEqual({ index: 1, fraction: 2.75 / 3 });
    expect(locateScreenPage(map, 6)).toEqual({ index: 2, fraction: 0 });
    // A chapter with no snapshot count (chunked) stays estimated.
    growChapterScreens(bookKey, 3, 9);
    expect(getScreenPageMap(bookKey, book)).toEqual(map);
  });

  it('locates a screen page: its spine item and an anchor the paginator lands on it with', () => {
    const book = [{ size: 3000 }, { size: 1500, linear: 'no' }, { size: 6000 }];
    recordChapterScreens(bookKey, 0, 2);
    recordChapterScreens(bookKey, 2, 4);
    const map = getScreenPageMap(bookKey, book);
    expect(map).toEqual({ counts: [2, 0, 4], starts: [0, 2, 2], total: 6 });
    expect(locateScreenPage(map, 0)).toEqual({ index: 0, fraction: 0 });
    expect(locateScreenPage(map, 1)).toEqual({ index: 0, fraction: 0.75 });
    // The paginator lands a section fraction f on column round(f * (columns
    // - 1)): p / (n - 1) is screen p's first column at one or two columns.
    expect(locateScreenPage(map, 3)).toEqual({ index: 2, fraction: 1 / 3 });
    // A last screen aimed at fraction 1 would round into the next item.
    expect(locateScreenPage(map, 5)).toEqual({ index: 2, fraction: 2.75 / 3 });
    expect(locateScreenPage(map, 99)).toEqual({ index: 2, fraction: 2.75 / 3 });
  });

  it('tells subscribers when a new snapshot changes the readout', () => {
    const before = getChapterScreensVersion();
    recordChapterScreens(bookKey, 0, 3);
    expect(getChapterScreensVersion()).toBe(before);
    snapshotChapterScreens(bookKey);
    expect(getChapterScreensVersion()).toBe(before + 1);
  });
});
