import { describe, expect, it } from 'vitest';
import { getReferencePageInfo, resolveReferencePageCount } from '@/utils/progress';

const makePageList = (labels: string[]) => labels.map((label) => ({ label, href: '#' }));

describe('getReferencePageInfo', () => {
  describe('with a page list from the book (issue #672)', () => {
    it('uses the current page item label and the highest numeric label as total', () => {
      const pageList = makePageList(['1', '2', '3', '4', '5']);
      const info = getReferencePageInfo({
        pageList,
        pageItem: { label: '3' },
        fraction: 0.5,
        referencePageCount: 0,
      });
      expect(info).toEqual({ current: '3', total: 5 });
    });

    it('keeps non-numeric current labels (front matter roman numerals) as-is', () => {
      const pageList = makePageList(['i', 'ii', '1', '2', '3']);
      const info = getReferencePageInfo({
        pageList,
        pageItem: { label: 'ii' },
        fraction: 0.1,
        referencePageCount: 0,
      });
      expect(info).toEqual({ current: 'ii', total: 3 });
    });

    it('ignores trailing non-numeric labels when computing the total', () => {
      // Reported in #672: a book ends with an index page labeled "XII" after
      // page 553 — the total must stay 553, not "XII".
      const pageList = makePageList(['551', '552', '553', 'XII']);
      const info = getReferencePageInfo({
        pageList,
        pageItem: { label: '552' },
        fraction: 0.6,
        referencePageCount: 0,
      });
      expect(info).toEqual({ current: '552', total: 553 });
    });

    it('falls back to the entry count when no label is numeric', () => {
      const pageList = makePageList(['i', 'ii', 'iii']);
      const info = getReferencePageInfo({
        pageList,
        pageItem: { label: 'iii' },
        fraction: 0.9,
        referencePageCount: 0,
      });
      expect(info).toEqual({ current: 'iii', total: 3 });
    });

    it('counts pages in nested subitems', () => {
      const pageList = [
        { label: '1', href: '#', subitems: makePageList(['2', '3']) },
        { label: '4', href: '#' },
      ];
      const info = getReferencePageInfo({
        pageList,
        pageItem: { label: '2' },
        fraction: 0.3,
        referencePageCount: 0,
      });
      expect(info).toEqual({ current: '2', total: 4 });
    });

    it('estimates the current page linearly when no page item is resolved yet', () => {
      // e.g. on the cover, before the first page anchor
      const pageList = makePageList(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
      const info = getReferencePageInfo({
        pageList,
        pageItem: null,
        fraction: 0.45,
        referencePageCount: 0,
      });
      expect(info).toEqual({ current: '5', total: 10 });
    });

    it('prefers the page list over a user-entered page count', () => {
      const pageList = makePageList(['1', '2', '3']);
      const info = getReferencePageInfo({
        pageList,
        pageItem: { label: '2' },
        fraction: 0.5,
        referencePageCount: 999,
      });
      expect(info).toEqual({ current: '2', total: 3 });
    });
  });

  describe('with a user-entered page count (issue #4542)', () => {
    it('maps the reading fraction linearly onto the page count', () => {
      const info = getReferencePageInfo({
        pageList: null,
        pageItem: null,
        fraction: 0.5,
        referencePageCount: 350,
      });
      expect(info).toEqual({ current: '175', total: 350 });
    });

    it('shows page 1 at the start of the book', () => {
      const info = getReferencePageInfo({
        pageList: undefined,
        pageItem: null,
        fraction: 0,
        referencePageCount: 350,
      });
      expect(info).toEqual({ current: '1', total: 350 });
    });

    it('shows the last page at the end of the book', () => {
      const info = getReferencePageInfo({
        pageList: [],
        pageItem: null,
        fraction: 1,
        referencePageCount: 350,
      });
      expect(info).toEqual({ current: '350', total: 350 });
    });
  });

  it('returns null when the book has no page list and no page count is set', () => {
    expect(
      getReferencePageInfo({
        pageList: null,
        pageItem: null,
        fraction: 0.5,
        referencePageCount: 0,
      }),
    ).toBeNull();
  });
});

// Issue #5716: the count describes the book's print edition, so it has to
// cross devices even though the rest of viewSettings is device-local. Both
// sync backends share this policy so they can never drift apart.
describe('resolveReferencePageCount (cross-device merge policy)', () => {
  it('adopts a peer count when this device has none', () => {
    expect(resolveReferencePageCount(0, 350, false)).toBe(350);
    expect(resolveReferencePageCount(undefined, 350, false)).toBe(350);
  });

  it('keeps the local count when the peer has none', () => {
    expect(resolveReferencePageCount(350, 0, true)).toBe(350);
    expect(resolveReferencePageCount(350, undefined, true)).toBe(350);
  });

  it('lets the newer config win when both sides have a count', () => {
    expect(resolveReferencePageCount(350, 400, true)).toBe(400);
    expect(resolveReferencePageCount(350, 400, false)).toBe(350);
  });

  it('never clears a local count from an absent remote one', () => {
    // A peer running a build that predates this merge pushes a config with no
    // count at all. That is indistinguishable on the wire from "the user
    // cleared it", and wiping a number the user typed is the worse failure.
    expect(resolveReferencePageCount(350, undefined, true)).toBe(350);
    expect(resolveReferencePageCount(350, 0, true)).toBe(350);
  });

  it('resolves to 0 (unset) when neither side has one', () => {
    expect(resolveReferencePageCount(0, 0, true)).toBe(0);
    expect(resolveReferencePageCount(undefined, undefined, false)).toBe(0);
  });
});
