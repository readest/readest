import { describe, expect, it } from 'vitest';

import { fixedPageKey, parsePageKey, reflowPageKey } from '@/services/handwriting/pageKey';

const CHAPTER = 'epubcfi(/6/8!/4/2/10,/1:0,/1:350)';
const START = 'epubcfi(/6/8!/4/2/10/1:0)';

describe('fixedPageKey', () => {
  it('keys a fixed-layout page by its section index, not the location counter', () => {
    // PDF sections are 1000 units and a location is 1500, so pages 0 and 1
    // share location 0. The section index keeps them apart.
    expect(fixedPageKey(0)).not.toBe(fixedPageKey(1));
    expect(parsePageKey(fixedPageKey(41))).toEqual({ kind: 'page', index: 41 });
  });
});

describe('reflowPageKey', () => {
  it('anchors a blank page at the start of its visible range', () => {
    const key = reflowPageKey(CHAPTER, []);
    expect(parsePageKey(key)).toEqual({ kind: 'cfi', cfi: START });
  });

  it('reuses an existing anchor that falls inside the visible range', () => {
    // Ink drawn under another layout anchored a little further in; it still
    // belongs on whichever page now shows that text.
    const existing = reflowPageKey('epubcfi(/6/8!/4/2/10,/1:120,/1:400)', []);
    expect(reflowPageKey(CHAPTER, [existing])).toBe(existing);
  });

  it('ignores anchors on other pages', () => {
    const elsewhere = reflowPageKey('epubcfi(/6/8!/4/2/12,/1:0,/1:200)', []);
    expect(reflowPageKey(CHAPTER, [elsewhere])).not.toBe(elsewhere);
  });
});
