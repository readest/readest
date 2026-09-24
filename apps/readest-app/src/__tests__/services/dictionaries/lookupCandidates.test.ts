import { describe, it, expect } from 'vitest';

import { buildLookupCandidates } from '@/services/dictionaries/lookupCandidates';

describe('buildLookupCandidates', () => {
  it('returns the lowercase word for an already-lowercase selection', () => {
    expect(buildLookupCandidates('hello')).toEqual(['hello', 'Hello', 'HELLO']);
  });

  it('trims leading/trailing whitespace from a double-click selection', () => {
    // Non-inflecting words keep this focused on trimming + case folding.
    expect(buildLookupCandidates('world ')).toEqual(['world', 'World', 'WORLD']);
    expect(buildLookupCandidates('  planet  ')).toEqual(['planet', 'Planet', 'PLANET']);
  });

  it('offers a lowercase variant for a sentence-initial capitalized word', () => {
    expect(buildLookupCandidates('Hello')).toEqual(['Hello', 'hello', 'HELLO']);
  });

  it('offers lowercase and title-case variants for an all-caps selection', () => {
    expect(buildLookupCandidates('HELLO')).toEqual(['HELLO', 'hello', 'Hello']);
  });

  it('de-duplicates collapsed variants', () => {
    // A single lowercase letter collapses to one unique candidate.
    expect(buildLookupCandidates('a')).toEqual(['a', 'A']);
  });

  it('returns an empty list for a blank selection', () => {
    expect(buildLookupCandidates('')).toEqual([]);
    expect(buildLookupCandidates('   ')).toEqual([]);
  });

  it.each([
    'rūpa',
    'café',
    'niño',
    'a\u1ab0',
  ])('folds Latin diacritics in %s after exact forms', (word) => {
    const candidates = buildLookupCandidates(word, 'fr');
    const folded = word.normalize('NFD').replace(/\p{M}/gu, '');
    expect(candidates[0]).toBe(word);
    expect(candidates).toContain(folded);
    expect(candidates).toContain(folded.toUpperCase());
    expect(candidates.indexOf(folded)).toBeGreaterThan(candidates.indexOf(word.toUpperCase()));
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it.each([
    'café',
    'cafe\u0301',
  ])('tries both Unicode compositions of %s before folding', (word) => {
    const candidates = buildLookupCandidates(word, 'fr');
    expect(candidates[0]).toBe(word);
    for (const form of ['NFC', 'NFD'] as const) {
      expect(candidates).toContain(word.normalize(form));
      expect(candidates.indexOf(word.normalize(form))).toBeLessThan(candidates.indexOf('cafe'));
    }
  });

  it('preserves marks in non-Latin scripts', () => {
    expect(buildLookupCandidates('が', 'ja')).not.toContain('か');
    expect(buildLookupCandidates('हिन्दी', 'hi')).not.toContain('हनद');
  });

  describe('lemmatization fallback', () => {
    it('appends lemma candidates after the exact/case variants', () => {
      const candidates = buildLookupCandidates('ran', 'en');
      expect(candidates[0]).toBe('ran'); // exact selection tried first
      expect(candidates).toContain('run');
      expect(candidates.indexOf('run')).toBeGreaterThan(candidates.indexOf('ran'));
    });

    it('keeps every exact/case variant ahead of any lemma', () => {
      const candidates = buildLookupCandidates('Mice', 'en');
      const lastCaseVariant = Math.max(
        candidates.indexOf('Mice'),
        candidates.indexOf('mice'),
        candidates.indexOf('MICE'),
      );
      expect(candidates.indexOf('mouse')).toBeGreaterThan(lastCaseVariant);
    });

    it('resolves the issue test cases to their expected lemma', () => {
      const cases: Array<[string, string]> = [
        ['ran', 'run'],
        ['went', 'go'],
        ['gone', 'go'],
        ['mice', 'mouse'],
        ['children', 'child'],
        ['better', 'good'],
        ['analyses', 'analysis'],
        ['realised', 'realise'],
      ];
      for (const [selection, lemma] of cases) {
        expect(buildLookupCandidates(selection, 'en')).toContain(lemma);
      }
    });

    it('defaults to English lemmatization when no language is given', () => {
      expect(buildLookupCandidates('ran')).toContain('run');
    });

    it('does not lemmatize for an explicit non-English language', () => {
      expect(buildLookupCandidates('ran', 'fr')).toEqual(['ran', 'Ran', 'RAN']);
    });
  });
});
