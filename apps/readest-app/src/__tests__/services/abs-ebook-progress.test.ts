import { describe, it, expect } from 'vitest';
import {
  buildAbsEbookProgressPatch,
  findAbsEbookProgress,
  resolveAbsEbookResume,
} from '@/services/audiobookshelf/ebookProgress';
import type { ABSMediaProgress } from '@/types/audiobookshelf';

const makeProgress = (overrides: Partial<ABSMediaProgress> = {}): ABSMediaProgress => ({
  libraryItemId: 'item1',
  currentTime: 0,
  duration: 0,
  isFinished: false,
  lastUpdate: 2000,
  ebookLocation: 'epubcfi(/6/14!/4/2/10/1:0)',
  ebookProgress: 0.42,
  ...overrides,
});

describe('findAbsEbookProgress', () => {
  it('matches the book-level row for the item', () => {
    const rows = [makeProgress({ libraryItemId: 'other' }), makeProgress()];
    expect(findAbsEbookProgress(rows, 'item1')?.ebookProgress).toBe(0.42);
  });

  it('ignores podcast episode rows of the same item', () => {
    const rows = [makeProgress({ episodeId: 'ep1' })];
    expect(findAbsEbookProgress(rows, 'item1')).toBeUndefined();
  });

  it('tolerates a missing mediaProgress list', () => {
    expect(findAbsEbookProgress(undefined, 'item1')).toBeUndefined();
  });
});

describe('resolveAbsEbookResume', () => {
  it('applies the server location when the server row is newer', () => {
    expect(
      resolveAbsEbookResume({
        remote: makeProgress({ lastUpdate: 2000 }),
        localLocation: 'epubcfi(/6/4!/4/2/2/1:0)',
        localFraction: 0.1,
        localLastReadAt: 1000,
      }),
    ).toEqual({ kind: 'location', location: 'epubcfi(/6/14!/4/2/10/1:0)' });
  });

  it('keeps the local position when local is strictly newer', () => {
    expect(
      resolveAbsEbookResume({
        remote: makeProgress({ lastUpdate: 1000 }),
        localLocation: 'epubcfi(/6/4!/4/2/2/1:0)',
        localFraction: 0.1,
        localLastReadAt: 2000,
      }),
    ).toBeNull();
  });

  it('lets the server win ties, matching the audiobook resume rule', () => {
    expect(
      resolveAbsEbookResume({
        remote: makeProgress({ lastUpdate: 2000 }),
        localLocation: 'epubcfi(/6/4!/4/2/2/1:0)',
        localFraction: 0.1,
        localLastReadAt: 2000,
      }),
    ).toEqual({ kind: 'location', location: 'epubcfi(/6/14!/4/2/10/1:0)' });
  });

  it('takes the server position on a device that has never read this book', () => {
    // A freshly opened book has a local config stamped "now" and a page-one
    // location, but this device has never written a position — the server's
    // month-old row is still the only real reading progress there is.
    expect(
      resolveAbsEbookResume({
        remote: makeProgress({ lastUpdate: 1000 }),
        localLocation: 'epubcfi(/6/2!/4/2[titlepage],,/6)',
        localFraction: 0.001,
        localLastReadAt: 0,
      }),
    ).toEqual({ kind: 'location', location: 'epubcfi(/6/14!/4/2/10/1:0)' });
  });

  it('does nothing when the server echoes the local location', () => {
    expect(
      resolveAbsEbookResume({
        remote: makeProgress(),
        localLocation: 'epubcfi(/6/14!/4/2/10/1:0)',
        localFraction: 0.42,
        localLastReadAt: 1000,
      }),
    ).toBeNull();
  });

  it('falls back to the fraction when the server location is not a CFI', () => {
    expect(
      resolveAbsEbookResume({
        remote: makeProgress({ ebookLocation: '42', ebookProgress: 0.42 }),
        localLocation: 'epubcfi(/6/4!/4/2/2/1:0)',
        localFraction: 0.1,
        localLastReadAt: 1000,
      }),
    ).toEqual({ kind: 'fraction', fraction: 0.42 });
  });

  it('falls back to the fraction when the server has no location', () => {
    expect(
      resolveAbsEbookResume({
        remote: makeProgress({ ebookLocation: null }),
        localFraction: 0.1,
        localLastReadAt: 1000,
      }),
    ).toEqual({ kind: 'fraction', fraction: 0.42 });
  });

  it('ignores a fraction that already matches the local position', () => {
    expect(
      resolveAbsEbookResume({
        remote: makeProgress({ ebookLocation: null, ebookProgress: 0.42 }),
        localFraction: 0.4201,
        localLastReadAt: 1000,
      }),
    ).toBeNull();
  });

  it('ignores an unusable server fraction', () => {
    expect(
      resolveAbsEbookResume({
        remote: makeProgress({ ebookLocation: null, ebookProgress: 0 }),
        localFraction: 0.4,
        localLastReadAt: 1000,
      }),
    ).toBeNull();
    expect(
      resolveAbsEbookResume({
        remote: makeProgress({ ebookLocation: null, ebookProgress: undefined }),
        localFraction: 0.4,
        localLastReadAt: 1000,
      }),
    ).toBeNull();
  });

  it('applies the server position when the book has never been opened here', () => {
    expect(
      resolveAbsEbookResume({
        remote: makeProgress(),
        localLastReadAt: 0,
      }),
    ).toEqual({ kind: 'location', location: 'epubcfi(/6/14!/4/2/10/1:0)' });
  });

  it('does nothing without a server row', () => {
    expect(resolveAbsEbookResume({ localFraction: 0.1, localLastReadAt: 1000 })).toBeNull();
  });
});

describe('buildAbsEbookProgressPatch', () => {
  it('sends the reading position in both the ebook and the generic fields', () => {
    expect(
      buildAbsEbookProgressPatch({ location: 'epubcfi(/6/14!/4/2/10/1:0)', fraction: 0.42 }),
    ).toEqual({
      ebookLocation: 'epubcfi(/6/14!/4/2/10/1:0)',
      ebookProgress: 0.42,
      progress: 0.42,
    });
  });

  it('clears a stale location when this push has none', () => {
    // ABS keeps a field the patch omits, so a fraction-only push has to null
    // the location out: left in place, an older CFI would outrank the fraction
    // beside it the next time a reader resumes.
    expect(buildAbsEbookProgressPatch({ fraction: 0.5 })).toEqual({
      ebookLocation: null,
      ebookProgress: 0.5,
      progress: 0.5,
    });
  });

  it('clamps the fraction to the 0..1 range ABS stores', () => {
    expect(buildAbsEbookProgressPatch({ fraction: 1.4 }).progress).toBe(1);
    expect(buildAbsEbookProgressPatch({ fraction: -0.2 }).progress).toBe(0);
  });
});
