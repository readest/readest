import { describe, expect, test } from 'vitest';

import { extractTermContext } from '@/services/ai/xray/lexrank';

describe('extractTermContext', () => {
  test('returns the matching sentence with bounded neighboring context in reading order', () => {
    const text = [
      'Rain fell outside.',
      'Alice hid the brass key.',
      'The door opened slowly.',
      'A dog barked.',
    ].join(' ');

    expect(
      extractTermContext(text, 'en', ['brass key'], {
        maxSentences: 1,
        contextBefore: 1,
        contextAfter: 1,
      }),
    ).toEqual(['Rain fell outside.', 'Alice hid the brass key.', 'The door opened slowly.']);
  });
});
