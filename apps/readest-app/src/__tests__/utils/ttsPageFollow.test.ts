import { describe, expect, test, vi } from 'vitest';
import { pageBreakFraction } from '@/utils/ttsPageFollow';

// Where a page stops being able to show a sentence is a property of the layout,
// not of the text: the same sentence breaks at a different word on a phone, at a
// larger font size, or in a narrower column. So the break is *found* in the live
// layout and then expressed as a fraction of the sentence's text, which is the
// unit that tracks how long the narrator spends on it.
describe('pageBreakFraction', () => {
  // A sentence's characters are laid out in reading order, so "is this character
  // past the page edge?" flips exactly once — which is what lets the break be
  // bisected instead of scanned.
  const breaksAt = (k: number) => (offset: number) => offset >= k;

  test('a sentence that fits on the page has no break', () => {
    expect(pageBreakFraction(120, () => false)).toBeNull();
  });

  test('reports the break as a fraction of the sentence text', () => {
    expect(pageBreakFraction(200, breaksAt(50))).toBeCloseTo(0.25, 5);
  });

  test('a sentence entirely past the page edge breaks at its start', () => {
    // Nothing of it is readable here, so the page should follow at once.
    expect(pageBreakFraction(200, breaksAt(0))).toBe(0);
  });

  test('a break in the final character is still a break', () => {
    expect(pageBreakFraction(100, breaksAt(99))).toBeCloseTo(0.99, 5);
  });

  test('an empty sentence has no break', () => {
    expect(pageBreakFraction(0, () => true)).toBeNull();
  });

  // Each probe measures the live layout, which forces a reflow, so the search
  // must bisect rather than walk the sentence.
  test('bisects instead of scanning', () => {
    const probe = vi.fn(breaksAt(700));
    expect(pageBreakFraction(1000, probe)).toBeCloseTo(0.7, 5);
    expect(probe.mock.calls.length).toBeLessThanOrEqual(12);
  });

  test('never probes outside the sentence', () => {
    const seen: number[] = [];
    pageBreakFraction(300, (offset) => {
      seen.push(offset);
      return offset >= 123;
    });
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...seen)).toBeLessThanOrEqual(299);
  });

  test('treats an unmeasurable character as not yet past the page', () => {
    // getTextSubRange can fail to map an offset (inert gloss text, detached
    // node). Reporting it as "past the page" would turn the page early.
    expect(pageBreakFraction(100, () => false)).toBeNull();
  });
});
