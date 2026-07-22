import { describe, it, expect } from 'vitest';
import {
  buildSectionFractionTable,
  sectionIndexForFraction,
  resolveSpineSectionIndex,
  getCFIFromXPointer,
  type SpineSectionInfo,
} from '@/utils/xcfi';
import type { BookDoc } from '@/libs/document';

const createDocument = (htmlString: string): Document =>
  new DOMParser().parseFromString(htmlString, 'text/html');

// Real spine byte sizes of the reference EPUB
// (Myron Bolitar T12 — 54 <itemref>, chap9 at spine index 14, chap10 at 15).
// Order: cover, pagetitre, ident1, ident1-2, sommaire, pre1, chap1..chap46,
// appen1, ident1-1.
const REAL_SIZES = [
  957, 1048, 9298, 1122, 9384, 25528, 55527, 34386, 70246, 56868, 33526, 38429, 18153, 33777, 30457,
  49288, 20450, 30699, 70495, 42777, 35622, 38614, 52874, 38477, 40481, 37437, 49609, 33542, 40797,
  46259, 17142, 56231, 56468, 51486, 41276, 63712, 40506, 54577, 36215, 36369, 31160, 7329, 52825,
  8932, 30261, 14674, 3912, 6646, 15057, 36712, 57634, 14374, 4777, 5070,
];
const CHAP9_INDEX = 14;
const CHAP10_INDEX = 15;

const realSections = (): SpineSectionInfo[] => REAL_SIZES.map((size) => ({ size, linear: 'yes' }));

describe('xcfi spine-section fraction table', () => {
  it('builds cumulative boundaries proportional to size', () => {
    const table = buildSectionFractionTable([{ size: 10 }, { size: 30 }, { size: 60 }]);
    expect(table[0]).toBe(0);
    expect(table[1]).toBeCloseTo(0.1, 6);
    expect(table[2]).toBeCloseTo(0.4, 6);
    expect(table[3]).toBe(1);
  });

  it('falls back to equal weights when sizes are missing', () => {
    const table = buildSectionFractionTable([{}, {}, {}, {}]);
    expect(table).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('maps a fraction to the section whose range contains it (upper-exclusive)', () => {
    const table = buildSectionFractionTable([{ size: 1 }, { size: 1 }, { size: 1 }, { size: 1 }]);
    expect(sectionIndexForFraction(0, table)).toBe(0);
    expect(sectionIndexForFraction(0.24, table)).toBe(0);
    expect(sectionIndexForFraction(0.25, table)).toBe(1);
    expect(sectionIndexForFraction(0.99, table)).toBe(3);
    expect(sectionIndexForFraction(1, table)).toBe(3);
  });
});

describe('resolveSpineSectionIndex — CREngine↔foliate DocFragment drift', () => {
  it('keeps the nominal index when no percentage is available (back-compat)', () => {
    const sections = realSections();
    expect(resolveSpineSectionIndex(CHAP10_INDEX, sections)).toBe(CHAP10_INDEX);
    expect(resolveSpineSectionIndex(CHAP9_INDEX, sections)).toBe(CHAP9_INDEX);
  });

  it('keeps the nominal index when the percentage is consistent with it', () => {
    const sections = realSections();
    // chap9 spans ~[0.2170, 0.2340]; 0.225 is inside, nominal already chap9.
    expect(resolveSpineSectionIndex(CHAP9_INDEX, sections, 0.225)).toBe(CHAP9_INDEX);
  });

  it('re-anchors to chapter 9 when CREngine drift lands the nominal on chapter 10', () => {
    const sections = realSections();
    // Reference regression: KOReader chap.9 @ ~21.7% arrives as a DocFragment
    // whose nominal foliate index is chap.10 (drift +1). The percentage anchor
    // must pull it back to chap.9.
    expect(resolveSpineSectionIndex(CHAP10_INDEX, sections, 0.217)).toBe(CHAP9_INDEX);
  });

  it('does NOT resolve to chapter 10 for the reference position', () => {
    const sections = realSections();
    expect(resolveSpineSectionIndex(CHAP10_INDEX, sections, 0.217)).not.toBe(CHAP10_INDEX);
  });

  it('clamps out-of-range nominal indices', () => {
    const sections = realSections();
    expect(resolveSpineSectionIndex(999, sections)).toBe(sections.length - 1);
    expect(resolveSpineSectionIndex(-5, sections)).toBe(0);
  });
});

describe('getCFIFromXPointer — reference non-regression (chap.9 stays chap.9)', () => {
  // DocFragment[16] is CREngine's number for chap.9 (nominal foliate index 15
  // = chap.10 under the old strict 1:1 mapping). Path: /body/p -> first <p>.
  const xpointer = '/body/DocFragment[16]/body/p/text().0';

  const makeBookDoc = (): BookDoc => {
    const sections = REAL_SIZES.map((size, i) => ({
      size,
      linear: 'yes',
      createDocument: async () =>
        createDocument(
          `<html><body><p>Section ${i} — chap9 content starts here.</p></body></html>`,
        ),
    }));
    return { sections } as unknown as BookDoc;
  };

  it('resolves the XPointer to chapter 9 (CFI spine step /6/30) with the percentage anchor', async () => {
    const cfi = await getCFIFromXPointer(xpointer, undefined, undefined, makeBookDoc(), 0.217);
    // 0-based foliate index 14 -> CFI spine step (14 + 1) * 2 = 30.
    expect(cfi.startsWith('epubcfi(/6/30!')).toBe(true);
  });

  it('reproduces the bug WITHOUT the percentage anchor (lands on chapter 10, /6/32)', async () => {
    const cfi = await getCFIFromXPointer(xpointer, undefined, undefined, makeBookDoc());
    // Without the anchor, nominal index 15 -> CFI spine step (15 + 1) * 2 = 32.
    expect(cfi.startsWith('epubcfi(/6/32!')).toBe(true);
  });
});
