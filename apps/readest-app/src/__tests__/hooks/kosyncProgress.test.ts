import { describe, it, expect } from 'vitest';
import {
  getRemoteFraction,
  hasUsableRemoteProgress,
  isXPointerProgress,
} from '@/app/reader/hooks/kosyncProgress';

describe('isXPointerProgress', () => {
  it('accepts CREngine XPointers', () => {
    expect(isXPointerProgress('/body/DocFragment[11]/body/div/p[3]/text().0')).toBe(true);
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

describe('hasUsableRemoteProgress', () => {
  it('accepts either a position string or a usable percentage', () => {
    expect(hasUsableRemoteProgress({ progress: '/body/DocFragment[3]/body/p' })).toBe(true);
    expect(hasUsableRemoteProgress({ percentage: 0.42 })).toBe(true);
  });

  it('rejects empty responses and unusable percentages', () => {
    expect(hasUsableRemoteProgress(null)).toBe(false);
    expect(hasUsableRemoteProgress({})).toBe(false);
    expect(hasUsableRemoteProgress({ progress: '', percentage: 0 })).toBe(false);
    expect(hasUsableRemoteProgress({ percentage: Number.NaN })).toBe(false);
  });
});
