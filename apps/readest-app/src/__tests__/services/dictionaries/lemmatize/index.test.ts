import { describe, it, expect } from 'vitest';

import { getLemmaCandidates } from '@/services/dictionaries/lemmatize';

describe('getLemmaCandidates', () => {
  it('lemmatizes words for an English language code', () => {
    expect(getLemmaCandidates('ran', 'en')).toContain('run');
  });

  it('normalizes regional/script English subtags to the en lemmatizer', () => {
    expect(getLemmaCandidates('mice', 'en-US')).toContain('mouse');
    expect(getLemmaCandidates('mice', 'en-GB')).toContain('mouse');
  });

  it('defaults to English when the language is missing or empty', () => {
    expect(getLemmaCandidates('ran')).toContain('run');
    expect(getLemmaCandidates('ran', undefined)).toContain('run');
    expect(getLemmaCandidates('ran', '')).toContain('run');
    expect(getLemmaCandidates('ran', null)).toContain('run');
  });

  it('returns [] for an explicit language with no registered lemmatizer', () => {
    expect(getLemmaCandidates('mange', 'fr')).toEqual([]);
    expect(getLemmaCandidates('rennt', 'de')).toEqual([]);
    expect(getLemmaCandidates('mice', 'zh')).toEqual([]);
  });
});
