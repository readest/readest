import { describe, expect, it } from 'vitest';

import {
  getOcrTextLanguage,
  getTesseractLanguages,
  OCR_LANGUAGE_CODES,
} from '@/app/reader/services/ocr/tesseractLanguages';

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

  it('maps supported scanned-book languages to their Tesseract models', () => {
    expect(getTesseractLanguages('es-MX')).toEqual(['spa']);
    expect(getTesseractLanguages('fr')).toEqual(['fra']);
    expect(getTesseractLanguages('deu')).toEqual(['deu']);
    expect(getTesseractLanguages('pt-BR')).toEqual(['por']);
    expect(getTesseractLanguages('ar')).toEqual(['ara']);
    expect(getTesseractLanguages('hi')).toEqual(['hin']);
    expect(getTesseractLanguages('uk')).toEqual(['ukr']);
  });

  it('offers every app language that has a matching OCR model', () => {
    expect(OCR_LANGUAGE_CODES).toContain('es');
    expect(OCR_LANGUAGE_CODES).toContain('ja');
    expect(OCR_LANGUAGE_CODES).toContain('zh-CN');
    for (const language of OCR_LANGUAGE_CODES) {
      const models = getTesseractLanguages(language);
      expect(models.length).toBeGreaterThan(0);
      if (language !== 'en') expect(models).not.toEqual(['eng']);
    }
  });

  it('uses the first metadata language and otherwise falls back to English', () => {
    expect(getTesseractLanguages(['ja', 'en'])).toEqual(['jpn', 'jpn_vert', 'eng']);
    expect(getTesseractLanguages('en-US')).toEqual(['eng']);
    expect(getTesseractLanguages('und', { mangaFallback: true })).toEqual([
      'jpn',
      'jpn_vert',
      'eng',
    ]);
    expect(getTesseractLanguages('xx')).toEqual(['eng']);
  });
});

describe('getOcrTextLanguage', () => {
  it('uses Japanese for manga without language metadata', () => {
    expect(getOcrTextLanguage(undefined, { mangaFallback: true })).toBe('ja');
    expect(getOcrTextLanguage('und', { mangaFallback: true })).toBe('ja');
  });

  it('normalizes Tesseract language codes for dictionary lookup', () => {
    expect(getOcrTextLanguage('jpn')).toBe('ja');
    expect(getOcrTextLanguage('kor')).toBe('ko');
    expect(getOcrTextLanguage('chi_tra')).toBe('zh-TW');
    expect(getOcrTextLanguage('zho-Hans')).toBe('zh-CN');
  });

  it('keeps valid metadata languages and omits an unknown fallback', () => {
    expect(getOcrTextLanguage('es_MX')).toBe('es-MX');
    expect(getOcrTextLanguage(undefined)).toBeUndefined();
  });
});
