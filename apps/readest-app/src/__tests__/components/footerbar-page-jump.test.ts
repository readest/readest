import { describe, expect, it } from 'vitest';
import {
  clampPage,
  findReferencePageHref,
  fractionForPage,
  parsePageInput,
} from '@/app/reader/components/footerbar/pageJump';

describe('parsePageInput', () => {
  it('parses plain page numbers', () => {
    expect(parsePageInput('94')).toBe(94);
    expect(parsePageInput(' 12 ')).toBe(12);
  });

  it('parses the page portion of a "current / total" field', () => {
    expect(parsePageInput('120 / 251')).toBe(120);
    expect(parsePageInput('94/251')).toBe(94);
    expect(parsePageInput('7 / ')).toBe(7);
  });

  it('rejects non-numeric and non-positive input', () => {
    expect(parsePageInput('')).toBeNull();
    expect(parsePageInput('abc')).toBeNull();
    expect(parsePageInput('abc / 251')).toBeNull();
    expect(parsePageInput('12.5')).toBeNull();
    expect(parsePageInput('-3')).toBeNull();
    expect(parsePageInput('0')).toBeNull();
    expect(parsePageInput('0 / 251')).toBeNull();
  });
});

describe('clampPage', () => {
  it('clamps to the valid page range', () => {
    expect(clampPage(0, 251)).toBe(1);
    expect(clampPage(94, 251)).toBe(94);
    expect(clampPage(9999, 251)).toBe(251);
  });
});

describe('fractionForPage', () => {
  it('targets the middle of the requested page', () => {
    // Page N of T equal-size pages spans [(N-1)/T, N/T); aiming at the middle
    // keeps the jump inside page N even when page boundaries shift slightly.
    expect(fractionForPage(1, 251)).toBeCloseTo(0.5 / 251);
    expect(fractionForPage(94, 251)).toBeCloseTo(93.5 / 251);
    expect(fractionForPage(251, 251)).toBeCloseTo(250.5 / 251);
  });

  it('stays within [0, 1] and handles empty books', () => {
    expect(fractionForPage(1, 0)).toBe(0);
    expect(fractionForPage(500, 10)).toBeLessThanOrEqual(1);
  });
});

describe('findReferencePageHref', () => {
  const pageList = [
    { label: 'xii', href: 'front.html#p12' },
    {
      label: '1',
      href: 'ch01.html#p1',
      subitems: [{ label: '2', href: 'ch01.html#p2' }],
    },
    { label: '3 ', href: 'ch02.html#p3' },
  ];

  it('finds the href matching a numeric page label, including nested items', () => {
    expect(findReferencePageHref(pageList, 1)).toBe('ch01.html#p1');
    expect(findReferencePageHref(pageList, 2)).toBe('ch01.html#p2');
    expect(findReferencePageHref(pageList, 3)).toBe('ch02.html#p3');
  });

  it('returns null when the page is not in the list', () => {
    expect(findReferencePageHref(pageList, 42)).toBeNull();
    expect(findReferencePageHref([], 1)).toBeNull();
    expect(findReferencePageHref(undefined, 1)).toBeNull();
  });
});
