import { describe, expect, it } from 'vitest';
import { firstSense, hintFromDictionary } from '@/services/vocabulary/hintSources';
import type { DictionaryProvider } from '@/services/dictionaries/types';

describe('firstSense', () => {
  it('skips the headword and pronunciation lines and drops the part of speech', () => {
    expect(
      firstSense(
        'serendipity\n/ˌserənˈdɪpəti/\nn. the occurrence of events by chance; luck',
        'serendipity',
      ),
    ).toBe('the occurrence of events by chance');
  });

  it('keeps a cross-language gloss whole up to the first sense break', () => {
    expect(
      firstSense('Serendipity [ˌserənˈdɪpəti]\nn. 意外发现，机缘巧合；运气', 'serendipity'),
    ).toBe('意外发现，机缘巧合');
  });

  it('strips sense numbers and bracketed labels', () => {
    expect(firstSense('1. (noun) good fortune.', 'luck')).toBe('good fortune');
  });

  it('caps a long sense at a word boundary', () => {
    const sense = firstSense(
      'the faculty of making fortunate discoveries of things you were not looking for',
      'x',
    );
    expect(sense.length).toBeLessThanOrEqual(40);
    expect(sense.endsWith(' ')).toBe(false);
    expect('the faculty of making fortunate discoveries'.startsWith(sense)).toBe(true);
  });

  it('returns an empty string when only the headword is there', () => {
    expect(firstSense('serendipity', 'serendipity')).toBe('');
  });
});

describe('hintFromDictionary', () => {
  const provider = (id: string, text: string | null): DictionaryProvider => ({
    id,
    kind: 'stardict',
    label: id,
    lookup: async (_word, ctx) => {
      if (text === null) return { ok: false, reason: 'empty' };
      ctx.container.textContent = text;
      return { ok: true };
    },
  });

  it('uses the first dictionary that has the word', async () => {
    const hint = await hintFromDictionary('luck', 'en', [
      provider('a', null),
      provider('b', 'luck\nn. good fortune'),
      provider('c', 'luck\nn. chance'),
    ]);
    expect(hint).toBe('good fortune');
  });

  it('returns an empty string when no dictionary has it', async () => {
    expect(await hintFromDictionary('luck', 'en', [provider('a', null)])).toBe('');
  });
});
