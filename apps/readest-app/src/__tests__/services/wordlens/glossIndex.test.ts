import { describe, it, expect } from 'vitest';
import { GlossIndex } from '@/services/wordlens/glossIndex';
import fixture from '../../fixtures/wordlens/en-zh.fixture.json';
import type { GlossIndexData } from '@/services/wordlens/types';

const index = GlossIndex.fromData(fixture as GlossIndexData);

describe('GlossIndex', () => {
  it('looks up an exact headword', () => {
    expect(index.lookup('cryptic')).toEqual({ rank: 18000, gloss: '晦涩的' });
  });
  it('is case-insensitive', () => {
    expect(index.lookup('The')).toEqual({ rank: 1, gloss: '这' });
  });
  it('resolves inflected forms to the lemma', () => {
    expect(index.lookup('running')).toEqual({ rank: 312, gloss: '跑；经营' });
    expect(index.lookup('RAN')).toEqual({ rank: 312, gloss: '跑；经营' });
  });
  it('returns null for unknown words', () => {
    expect(index.lookup('zzzq')).toBeNull();
  });
});
