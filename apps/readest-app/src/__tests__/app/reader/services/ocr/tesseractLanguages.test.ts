import { describe, expect, it } from 'vitest';

import { getTesseractLanguages } from '@/app/reader/services/ocr/tesseractLanguages';

describe('getTesseractLanguages', () => {
  it('uses mixed Japanese models for manga without language metadata', () => {
    expect(getTesseractLanguages(undefined, { mangaFallback: true })).toEqual([
      'jpn',
      'jpn_vert',
      'eng',
    ]);
  });

  it('includes vertical models for Japanese, Korean, and Chinese', () => {
    expect(getTesseractLanguages('ja-JP')).toEqual(['jpn', 'jpn_vert', 'eng']);
    expect(getTesseractLanguages('kor')).toEqual(['kor', 'kor_vert', 'eng']);
    expect(getTesseractLanguages('zh-Hant')).toEqual(['chi_tra', 'chi_tra_vert', 'eng']);
    expect(getTesseractLanguages('zh-CN')).toEqual(['chi_sim', 'chi_sim_vert', 'eng']);
  });

  it('uses the first metadata language and otherwise falls back to English', () => {
    expect(getTesseractLanguages(['ja', 'en'])).toEqual(['jpn', 'jpn_vert', 'eng']);
    expect(getTesseractLanguages('en-US')).toEqual(['eng']);
    expect(getTesseractLanguages('und', { mangaFallback: true })).toEqual([
      'jpn',
      'jpn_vert',
      'eng',
    ]);
    expect(getTesseractLanguages('fr')).toEqual(['eng']);
  });
});
