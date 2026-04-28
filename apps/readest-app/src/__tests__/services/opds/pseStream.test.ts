import { describe, it, expect } from 'vitest';
import {
  PSE_SCHEME,
  buildPseStreamFileName,
  parsePseStreamFileName,
  isPseStreamFileName,
} from '@/services/opds/pseStream';

describe('pseStream', () => {
  const sample = {
    url: 'https://library.example.com/api/v1/series/42/page/{pageNumber}',
    catalogId: 'catalog-1',
    count: 120,
    title: 'Sample Title',
    author: 'Sample Author',
  };

  describe('buildPseStreamFileName', () => {
    it('produces a pse:// URL', () => {
      const name = buildPseStreamFileName(sample);
      expect(name.startsWith(PSE_SCHEME)).toBe(true);
    });

    it('does not embed auth credentials or proxy URLs', () => {
      const name = buildPseStreamFileName(sample);
      const decoded = decodeURIComponent(name.replace(PSE_SCHEME, ''));
      expect(decoded).not.toMatch(/Basic\s/i);
      expect(decoded).not.toMatch(/auth=/);
      expect(decoded).not.toMatch(/\/opds\/proxy/);
    });
  });

  describe('parsePseStreamFileName', () => {
    it('round-trips through build', () => {
      const parsed = parsePseStreamFileName(buildPseStreamFileName(sample));
      expect(parsed).toEqual(sample);
    });
  });

  describe('isPseStreamFileName', () => {
    it('recognizes pse:// URLs', () => {
      expect(isPseStreamFileName('pse://abc')).toBe(true);
    });

    it('rejects other URLs', () => {
      expect(isPseStreamFileName('https://example.com')).toBe(false);
      expect(isPseStreamFileName('book.cbz')).toBe(false);
      expect(isPseStreamFileName('')).toBe(false);
    });
  });
});
