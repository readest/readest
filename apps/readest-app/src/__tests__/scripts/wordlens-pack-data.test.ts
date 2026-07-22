import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GlossIndexData } from '@/services/wordlens/types';

// Validates the lemmatization in the COMMITTED Word Lens pack data (not just the
// build functions). Every English-source pack runs through build-time lemmatization
// — buildEnPack for en-en/en-zh, buildPack reusing en-en's table for en-X — so the
// shipped JSON must satisfy the inflection invariants below. Regenerate with
// `node scripts/build-wordlens-data.mjs ...` if these fail after a data refresh.

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/wordlens');
const load = (pair: string): GlossIndexData =>
  JSON.parse(readFileSync(resolve(DATA_DIR, `${pair}.json`), 'utf8')) as GlossIndexData;

const EN_SOURCE_PAIRS = ['en-en', 'en-zh', 'en-de', 'en-es', 'en-fr', 'en-pt', 'en-ru'] as const;

describe('Word Lens pack data — lemmatization invariants', () => {
  for (const pair of EN_SOURCE_PAIRS) {
    describe(pair, () => {
      const { entries, inflections } = load(pair);

      it('resolves every inflection to a present lemma entry (no dangling pointer)', () => {
        const dangling = Object.entries(inflections).filter(([, lemma]) => !entries[lemma]);
        expect(dangling).toEqual([]);
      });

      it('never keeps an inflected form as a standalone entry (it resolves to its lemma)', () => {
        const leaked = Object.keys(inflections).filter((form) => entries[form]);
        expect(leaked).toEqual([]);
      });

      it('has no inflection chains (every lemma is terminal)', () => {
        const chained = Object.keys(inflections).filter((form) => inflections[inflections[form]!]);
        expect(chained).toEqual([]);
      });

      it('lemmatizes the transparent derivation thickly → thick (gated by lemma rank)', () => {
        expect(inflections['thickly']).toBe('thick');
        expect(entries['thickly']).toBeUndefined();
        expect(entries['thick']).toBeDefined();
      });
    });
  }

  it('keeps the common noun "number" (not dropped as the comparative of "numb")', () => {
    for (const pair of ['en-en', 'en-zh'] as const) {
      const { entries, inflections } = load(pair);
      expect(entries['number']).toBeDefined();
      expect(inflections['number']).toBeUndefined(); // not treated as an inflection
      expect(inflections['numbers']).toBe('number'); // its plural resolves to it
    }
  });

  it('lemmatizes the negative -able derivation insufferable → suffer (translation overlap)', () => {
    // Its English def never names "suffer" — validated by the shared Chinese 忍受.
    for (const pair of ['en-en', 'en-zh'] as const) {
      const { entries, inflections } = load(pair);
      expect(inflections['insufferable']).toBe('suffer');
      expect(entries['insufferable']).toBeUndefined();
      expect(entries['suffer']).toBeDefined();
    }
  });
});
