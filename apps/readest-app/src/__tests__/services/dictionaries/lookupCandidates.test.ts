import { describe, it, expect } from 'vitest';

import { buildLookupCandidates } from '@/services/dictionaries/lookupCandidates';

describe('buildLookupCandidates', () => {
  it('returns the lowercase word for an already-lowercase selection', () => {
    expect(buildLookupCandidates('hello')).toEqual(['hello', 'Hello', 'HELLO']);
  });

  it('trims leading/trailing whitespace from a double-click selection', () => {
    expect(buildLookupCandidates('world ')).toEqual(['world', 'World', 'WORLD']);
    expect(buildLookupCandidates('  spaced  ')).toEqual(['spaced', 'Spaced', 'SPACED']);
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
});
