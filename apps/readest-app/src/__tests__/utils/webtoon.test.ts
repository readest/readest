import { describe, expect, it } from 'vitest';

import { getScrollGapAttr } from '@/utils/webtoon';

describe('getScrollGapAttr', () => {
  it('returns 0 for Webtoon Mode (seamless, no gap)', () => {
    expect(getScrollGapAttr(true)).toBe('0');
  });

  it('returns the default 4 otherwise', () => {
    expect(getScrollGapAttr(false)).toBe('4');
  });
});
