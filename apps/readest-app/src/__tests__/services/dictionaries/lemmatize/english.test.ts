import { describe, it, expect } from 'vitest';

import { lemmatizeEnglish } from '@/services/dictionaries/lemmatize/english';

describe('lemmatizeEnglish', () => {
  describe('irregular forms (issue test cases)', () => {
    it('maps irregular verb forms to their base', () => {
      expect(lemmatizeEnglish('ran')).toContain('run');
      expect(lemmatizeEnglish('went')).toContain('go');
      expect(lemmatizeEnglish('gone')).toContain('go');
    });

    it('maps irregular plurals to their singular', () => {
      expect(lemmatizeEnglish('mice')).toContain('mouse');
      expect(lemmatizeEnglish('children')).toContain('child');
    });

    it('maps irregular comparatives/superlatives to their base adjective', () => {
      expect(lemmatizeEnglish('better')).toContain('good');
      expect(lemmatizeEnglish('best')).toContain('good');
      expect(lemmatizeEnglish('worse')).toContain('bad');
    });
  });

  describe('regular suffix rules (issue test cases)', () => {
    it('reduces Greek/Latin -ses plurals to -sis', () => {
      expect(lemmatizeEnglish('analyses')).toContain('analysis');
    });

    it('prefers the -sis noun ahead of the -se verb for -ses words', () => {
      const candidates = lemmatizeEnglish('analyses');
      const analysis = candidates.indexOf('analysis');
      const analyse = candidates.indexOf('analyse');
      expect(analysis).toBeGreaterThanOrEqual(0);
      // When both surface, the noun (issue's expected lookup) comes first.
      if (analyse >= 0) expect(analysis).toBeLessThan(analyse);
    });

    it('drops a trailing -d from -ed words built on an e-stem', () => {
      expect(lemmatizeEnglish('realised')).toContain('realise');
    });
  });

  describe('regular suffix rule families', () => {
    it('handles regular plurals and third-person -s/-es', () => {
      expect(lemmatizeEnglish('cats')).toContain('cat');
      expect(lemmatizeEnglish('boxes')).toContain('box');
      expect(lemmatizeEnglish('dishes')).toContain('dish');
      expect(lemmatizeEnglish('cities')).toContain('city');
      expect(lemmatizeEnglish('wolves')).toContain('wolf');
      expect(lemmatizeEnglish('knives')).toContain('knife');
    });

    it('handles regular past tense, including doubled consonants', () => {
      expect(lemmatizeEnglish('walked')).toContain('walk');
      expect(lemmatizeEnglish('studied')).toContain('study');
      expect(lemmatizeEnglish('stopped')).toContain('stop');
      expect(lemmatizeEnglish('baked')).toContain('bake');
    });

    it('handles -ing forms, including e-restoration and doubled consonants', () => {
      expect(lemmatizeEnglish('walking')).toContain('walk');
      expect(lemmatizeEnglish('running')).toContain('run');
      expect(lemmatizeEnglish('making')).toContain('make');
      expect(lemmatizeEnglish('lying')).toContain('lie');
    });

    it('handles comparatives and superlatives', () => {
      expect(lemmatizeEnglish('faster')).toContain('fast');
      expect(lemmatizeEnglish('fastest')).toContain('fast');
      expect(lemmatizeEnglish('larger')).toContain('large');
      expect(lemmatizeEnglish('happier')).toContain('happy');
      expect(lemmatizeEnglish('happiest')).toContain('happy');
      expect(lemmatizeEnglish('bigger')).toContain('big');
    });

    it('strips possessive clitics', () => {
      expect(lemmatizeEnglish("cat's")).toContain('cat');
      expect(lemmatizeEnglish("dogs'")).toContain('dog');
    });
  });

  describe('guards', () => {
    it('returns an empty list for multi-word, numeric, or non-ASCII input', () => {
      expect(lemmatizeEnglish('hello world')).toEqual([]);
      expect(lemmatizeEnglish('123')).toEqual([]);
      expect(lemmatizeEnglish('café')).toEqual([]);
      expect(lemmatizeEnglish('')).toEqual([]);
      expect(lemmatizeEnglish('   ')).toEqual([]);
    });

    it('is case-insensitive on the input', () => {
      expect(lemmatizeEnglish('Ran')).toContain('run');
      expect(lemmatizeEnglish('MICE')).toContain('mouse');
    });

    it('never returns the input word itself or single letters', () => {
      expect(lemmatizeEnglish('run')).not.toContain('run');
      expect(lemmatizeEnglish('cat')).not.toContain('cat');
      expect(lemmatizeEnglish('best')).not.toContain('b');
    });
  });
});
