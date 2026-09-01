import { describe, it, expect } from 'vitest';
import { getCFIFromXPointer } from '@/utils/xcfi';
import type { BookDoc } from '@/libs/document';

const createDocument = (htmlString: string): Document =>
  new DOMParser().parseFromString(htmlString, 'text/html');

// Real spine of the EPUB from #5980: "Nexus: A Brief History of Information
// Networks from the Stone Age to AI", 29 XHTML documents, all linear. Sizes are
// the uncompressed zip entry sizes foliate exposes as `section.size`, in
// <itemref> order. They put the chapters at:
//   Chapter 5      -> 18.4189% .. 27.8028%  (spine position 14, 0-based 13)
//   Part II divider-> 27.8028% .. 27.8397%  (0-based 14)
//   Chapter 6      -> 27.8397% .. 32.6423%  (0-based 15)
// Notes (505186) + Index (349516) are 44.1% of all spine bytes, so CREngine's
// pagination percentage sits a whole chapter away from where a byte-size table
// puts it. KOReader reported 31.13% for a position in Chapter 5.
const CHAPTER_5_INDEX = 13;
const CHAPTER_6_INDEX = 15;
const REAL_SIZES = [
  682, 4908, 814, 799, 4554, 4425, 727, 53831, 696, 36372, 52377, 73370, 123333, 181823, 716, 93056,
  64486, 113484, 710, 103849, 29318, 83274, 22568, 23823, 4992, 505186, 349516, 1772, 2154,
];
const KOREADER_PERCENTAGE = 0.3113;

// Real element counts: Chapter 5 has 18 <h3> and 215 <p>, Chapter 6 has 6 <h3>
// and 105 <p>. So h3[17] exists ONLY in Chapter 5, while p[50] exists in both —
// the second case is the one a structural check could never catch.
const elements = (tag: string, count: number, label: string) =>
  Array.from({ length: count }, (_, i) => `<${tag}>${label} ${tag}${i + 1}</${tag}>`).join('');

const makeBookDoc = (): BookDoc => {
  const sections = REAL_SIZES.map((size, index) => {
    let body: string;
    if (index === CHAPTER_5_INDEX) {
      body = `<div>${elements('h3', 18, 'Ch5')}${elements('p', 215, 'Ch5')}</div>`;
    } else if (index === CHAPTER_6_INDEX) {
      body = `<div>${elements('h3', 6, 'Ch6')}${elements('p', 105, 'Ch6')}</div>`;
    } else {
      body = `<div><h3>Section ${index}</h3><p>Body.</p></div>`;
    }
    return {
      size,
      linear: 'yes',
      createDocument: async () => createDocument(`<html><body>${body}</body></html>`),
    };
  });
  return { sections } as unknown as BookDoc;
};

// 0-based section 13 -> CFI spine step (13 + 1) * 2 = 28. That is also the
// spine step the sync server itself derived from the XPointer: the reported
// server log shows epubcfi(/6/28!/4/2/410:0).
const CHAPTER_5_CFI = 'epubcfi(/6/28!';

describe('getCFIFromXPointer resolves the XPointer in its own DocFragment (#5980)', () => {
  it.each([
    ['a heading that exists only in Chapter 5', '/body/DocFragment[14]/body/div/h3[17]/text().0'],
    ['a paragraph that also exists in Chapter 6', '/body/DocFragment[14]/body/div/p[50]/text().0'],
  ])('keeps Chapter 5 for %s', async (_label, xpointer) => {
    const cfi = await getCFIFromXPointer(xpointer, undefined, undefined, makeBookDoc());
    expect(cfi.startsWith(CHAPTER_5_CFI)).toBe(true);
  });

  it('ignores a reading percentage even when one is passed positionally', async () => {
    // The 5th argument is gone; a stray caller passing one must not reach the
    // section choice. Chapter 6 (/6/32!) is where 31.13% would have landed.
    const convert = getCFIFromXPointer as (
      ...args: [string, Document | undefined, number | undefined, BookDoc, number]
    ) => Promise<string>;
    const cfi = await convert(
      '/body/DocFragment[14]/body/div/p[50]/text().0',
      undefined,
      undefined,
      makeBookDoc(),
      KOREADER_PERCENTAGE,
    );
    expect(cfi.startsWith(CHAPTER_5_CFI)).toBe(true);
  });

  it('uses the already-rendered document when it is the XPointer own section', async () => {
    const doc = createDocument(`<html><body><div>${elements('h3', 18, 'Ch5')}</div></body></html>`);
    const cfi = await getCFIFromXPointer(
      '/body/DocFragment[14]/body/div/h3[17]/text().0',
      doc,
      CHAPTER_5_INDEX,
      makeBookDoc(),
    );
    expect(cfi.startsWith(CHAPTER_5_CFI)).toBe(true);
  });
});
