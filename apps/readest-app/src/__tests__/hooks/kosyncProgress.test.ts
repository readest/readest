// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  isXPointerProgress,
  getRemoteFraction,
  getRemoteTotalPages,
} from '@/app/reader/hooks/kosyncProgress';

describe('isXPointerProgress', () => {
  it('accepts CREngine XPointers', () => {
    expect(isXPointerProgress('/body/DocFragment[11]/body/div/p[3]/text().0')).toBe(true);
  });

  it('accepts the FictionBook-rooted XPointers crengine writes for FB2', () => {
    expect(isXPointerProgress('/FictionBook/body[1]/section[3]/p[9]/text().322')).toBe(true);
  });

  it('accepts the html-rooted XPointers crengine writes for MOBI', () => {
    expect(isXPointerProgress('/html/body/body/div[8]/p[152]/text().596')).toBe(true);
  });

  it('accepts the explicit [1] roots newer crengine writes', () => {
    expect(isXPointerProgress('/body[1]/DocFragment[23]/body[1]/div[1]/p[4]/text()[1].0')).toBe(
      true,
    );
    expect(isXPointerProgress('/FictionBook[1]/body[1]/section[3]/p[9]/text()[1].322')).toBe(true);
    expect(isXPointerProgress('/html[1]/body[1]/body[1]/div[8]/p[152]/text()[1].596')).toBe(true);
  });

  it('rejects non-XPointer progress strings', () => {
    expect(isXPointerProgress('epubcfi(/6/14!/4/2/2)')).toBe(false);
    expect(isXPointerProgress('50')).toBe(false);
    expect(isXPointerProgress('')).toBe(false);
    expect(isXPointerProgress(undefined)).toBe(false);
  });
});

describe('getRemoteFraction', () => {
  it('returns the percentage as a 0–1 fraction', () => {
    expect(getRemoteFraction({ percentage: 0.5 })).toBe(0.5);
  });

  it('clamps fractions above 1', () => {
    expect(getRemoteFraction({ percentage: 1.5 })).toBe(1);
  });

  it('returns undefined when there is no usable percentage', () => {
    expect(getRemoteFraction({})).toBeUndefined();
    expect(getRemoteFraction({ percentage: 0 })).toBeUndefined();
    expect(getRemoteFraction({ percentage: -0.2 })).toBeUndefined();
    expect(getRemoteFraction({ percentage: NaN })).toBeUndefined();
    expect(getRemoteFraction({ percentage: Infinity })).toBeUndefined();
  });

  it('falls back to the percentage for non-XPointer progress (e.g. Kavita)', () => {
    // Kavita's KOReader-compatible endpoint reports progress Readest cannot
    // resolve positionally, but still sends a percentage.
    const remote = { progress: 'page-42', percentage: 0.5 };
    expect(isXPointerProgress(remote.progress)).toBe(false);
    expect(getRemoteFraction(remote)).toBe(0.5);
  });
});

describe('getRemoteTotalPages', () => {
  it('reads a Kavita report with the zero-based formula', () => {
    // Kavita: percentage = (page - 1) / total for an 11-page PDF.
    expect(getRemoteTotalPages(2, 0.09090909, 11)).toBe(11);
    expect(getRemoteTotalPages(5, 0.36363637, 11)).toBe(11);
    expect(getRemoteTotalPages(10, 0.8181818, 11)).toBe(11);
    expect(getRemoteTotalPages(11, 10 / 11, 11)).toBe(11);
  });

  it('reads a KOReader report with the one-based formula', () => {
    // KOReader: percentage = page / total for an 11-page PDF.
    expect(getRemoteTotalPages(2, 2 / 11, 11)).toBe(11);
    expect(getRemoteTotalPages(11, 1, 11)).toBe(11);
  });

  it('keeps the KOReader reading with no local total to check against', () => {
    expect(getRemoteTotalPages(2, 0.09090909, 0)).toBe(22);
  });

  it('keeps the KOReader reading when neither reading matches the local total', () => {
    expect(getRemoteTotalPages(2, 0.09090909, 70)).toBe(22);
  });

  it('returns undefined when the percentage is unusable', () => {
    expect(getRemoteTotalPages(2, 0, 11)).toBeUndefined();
    expect(getRemoteTotalPages(2, -0.2, 11)).toBeUndefined();
    expect(getRemoteTotalPages(2, NaN, 11)).toBeUndefined();
    expect(getRemoteTotalPages(2, Infinity, 11)).toBeUndefined();
  });
});
