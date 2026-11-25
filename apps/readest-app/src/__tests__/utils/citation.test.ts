import { describe, expect, test } from 'vitest';
import { TOCItem } from '@/libs/document';
import { formatCitation, getPublishedYear, getTocPathLabels } from '@/utils/citation';

describe('formatCitation', () => {
  test('joins author, title with year, TOC path and page', () => {
    expect(
      formatCitation({
        author: 'John A. List',
        title: 'The Voltage Effect',
        year: '2022',
        chapters: ['Chapter 2', 'From Selection Biases to WEIRD People'],
        page: 'p. 41',
      }),
    ).toBe(
      '— John A. List, The Voltage Effect (2022), Chapter 2 › From Selection Biases to WEIRD People, p. 41',
    );
  });

  test('leaves out what the book does not have', () => {
    expect(formatCitation({ author: '', title: 'Upstream', chapters: [] })).toBe('— Upstream');
    expect(
      formatCitation({ author: 'Dan Heath', title: 'Upstream', chapters: ['Chapter 9'] }),
    ).toBe('— Dan Heath, Upstream, Chapter 9');
  });
});

describe('getPublishedYear', () => {
  test.each([
    ['2020-03-03T00:00:00+00:00', '2020'],
    ['2022', '2022'],
    ['March 1998', '1998'],
  ])('reads the year from %s', (published, year) => {
    expect(getPublishedYear(published)).toBe(year);
  });

  // Calibre writes 0101-01-01 for a book with no date; the library sorts
  // undated books as 0001-01-01.
  test.each([
    undefined,
    '',
    '0101-01-01T00:00:00+00:00',
    '0001-01-01',
  ])('has no year for %s', (published) => {
    expect(getPublishedYear(published)).toBeUndefined();
  });
});

describe('getTocPathLabels', () => {
  // A PDF outline: no CFIs, hrefs are named destinations.
  const toc: TOCItem[] = [
    { id: 1, label: 'Introduction', href: '"Introduction.1"', index: 0 },
    {
      id: 2,
      label: 'Chapter 2',
      href: '"Chapter 2.1"',
      index: 2,
      subitems: [
        { id: 3, label: 'Imposters', href: '"Imposters.2"', index: 2 },
        {
          id: 4,
          label: ' From Selection Biases to WEIRD People ',
          href: '"From Selection Biases.2"',
          index: 5,
        },
      ],
    },
    { id: 5, label: 'Appendix', href: '"Appendix.1"', index: 9 },
  ];

  test('names the chapter and the section the passage is in', () => {
    expect(getTocPathLabels(toc, '"From Selection Biases.2"')).toEqual([
      'Chapter 2',
      'From Selection Biases to WEIRD People',
    ]);
  });

  test('names a chapter without sections', () => {
    expect(getTocPathLabels(toc, '"Introduction.1"')).toEqual(['Introduction']);
  });

  test('is empty for an href outside the TOC', () => {
    expect(getTocPathLabels(toc, 'cover.xhtml')).toEqual([]);
  });
});
