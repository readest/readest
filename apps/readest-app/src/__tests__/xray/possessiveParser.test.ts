import { describe, expect, test } from 'vitest';

import { parsePossessiveChains } from '@/services/ai/xray/possessiveParser';

describe('parsePossessiveChains', () => {
  test('parses named relationship chains with stable source offsets', () => {
    const text = "Alice Liddell's brother's mentor arrived beside Bob's sword.";

    expect(parsePossessiveChains(text)).toEqual([
      {
        rootEntity: 'Alice Liddell',
        chain: ['brother', 'mentor'],
        exactQuote: "Alice Liddell's brother's mentor",
        offsetStart: 0,
        offsetEnd: 32,
      },
    ]);
  });
});
