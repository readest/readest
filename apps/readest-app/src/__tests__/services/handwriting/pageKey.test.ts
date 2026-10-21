import { describe, expect, it } from 'vitest';

import { fixedPageKey, parsePageKey, sectionPageKey } from '@/services/handwriting/pageKey';

describe('page keys', () => {
  it('keys a fixed-layout page by its section index, not the location counter', () => {
    // PDF sections are 1000 units and a location is 1500, so pages 0 and 1
    // share location 0. The section index keeps them apart.
    expect(fixedPageKey(0)).not.toBe(fixedPageKey(1));
    expect(parsePageKey(fixedPageKey(41))).toEqual({ kind: 'page', index: 41 });
  });

  it('keys reflowable ink by section; strokes carry their own text anchors', () => {
    expect(parsePageKey(sectionPageKey(3))).toEqual({ kind: 'section', index: 3 });
  });

  it('rejects unknown keys', () => {
    expect(parsePageKey('cfi:epubcfi(/6/4!/4)')).toBeNull();
  });
});
