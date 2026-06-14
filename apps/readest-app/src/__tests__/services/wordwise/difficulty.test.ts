import { describe, it, expect } from 'vitest';
import {
  WORD_WISE_MIN_LEVEL,
  WORD_WISE_MAX_LEVEL,
  CEFR_LEVELS,
  getRankCutoff,
  cefrLabel,
  isDifficult,
  canTokenizeSource,
} from '@/services/wordwise/difficulty';

describe('difficulty', () => {
  it('exposes a 1..6 (A1..C2) level range', () => {
    expect(WORD_WISE_MIN_LEVEL).toBe(1);
    expect(WORD_WISE_MAX_LEVEL).toBe(6);
    expect(CEFR_LEVELS).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
  });

  it('labels each level with its CEFR band', () => {
    expect(cefrLabel(1)).toBe('A1');
    expect(cefrLabel(3)).toBe('B1');
    expect(cefrLabel(6)).toBe('C2');
  });

  it('RAISES the EN cutoff as the level rises (A1 = most hints, C2 = fewest)', () => {
    expect(getRankCutoff('en', 1)).toBeLessThan(getRankCutoff('en', 6));
    expect(getRankCutoff('en', 1)).toBe(1000); // A1
    expect(getRankCutoff('en', 3)).toBe(4000); // B1
  });

  it('uses the shared frequency table for other Latin sources', () => {
    expect(getRankCutoff('es', 3)).toBe(4000);
    expect(getRankCutoff('fr', 1)).toBe(getRankCutoff('en', 1));
  });

  it('uses the HSK scale for zh, aligned to the build script ranks', () => {
    expect(getRankCutoff('zh', 1)).toBe(6000); // A1
    expect(getRankCutoff('zh', 6)).toBe(24000); // C2
    expect(getRankCutoff('zh', 1)).toBeLessThan(getRankCutoff('zh', 6));
  });

  it('clamps out-of-range levels', () => {
    expect(getRankCutoff('en', 0)).toBe(getRankCutoff('en', 1));
    expect(getRankCutoff('en', 99)).toBe(getRankCutoff('en', 6));
  });

  it('treats a word as difficult when its rank is at or beyond the cutoff', () => {
    expect(isDifficult(8000, 7000)).toBe(true);
    expect(isDifficult(7000, 7000)).toBe(true);
    expect(isDifficult(6999, 7000)).toBe(false);
  });

  it('reports tokenizable sources (Latin + zh) and blocks segmenter-less CJK', () => {
    expect(canTokenizeSource('en')).toBe(true);
    expect(canTokenizeSource('zh')).toBe(true);
    expect(canTokenizeSource('es')).toBe(true);
    expect(canTokenizeSource('ja')).toBe(false);
    expect(canTokenizeSource('ko')).toBe(false);
  });
});
