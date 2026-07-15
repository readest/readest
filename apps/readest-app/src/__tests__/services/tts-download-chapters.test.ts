import { describe, expect, test } from 'vitest';

import { chapterDownloadStatus, deriveDownloadChapters } from '@/services/tts/downloadChapters';
import type { TOCItem } from '@/libs/document';

const toc = (label: string, href: string, subitems?: TOCItem[]): TOCItem => ({
  id: 0,
  label,
  href,
  index: 0,
  subitems,
});

// href -> section index resolver, like view.resolveNavigation.
const resolver = (map: Record<string, number>) => (href: string) =>
  href in map ? map[href]! : null;

describe('deriveDownloadChapters', () => {
  test('one chapter per TOC entry, spanning to the next chapter section', () => {
    const chapters = deriveDownloadChapters(
      [toc('One', 'a'), toc('Two', 'b'), toc('Three', 'c')],
      resolver({ a: 0, b: 2, c: 4 }),
      6,
    );
    expect(chapters).toEqual([
      { key: 'a', label: 'One', depth: 0, startSection: 0, endSection: 2 },
      { key: 'b', label: 'Two', depth: 0, startSection: 2, endSection: 4 },
      { key: 'c', label: 'Three', depth: 0, startSection: 4, endSection: 6 },
    ]);
  });

  test('flattens nested subitems in reading order', () => {
    const chapters = deriveDownloadChapters(
      [toc('Part I', 'p1', [toc('Ch 1', 'c1'), toc('Ch 2', 'c2')]), toc('Part II', 'p2')],
      resolver({ p1: 0, c1: 1, c2: 2, p2: 3 }),
      4,
    );
    expect(chapters.map((c) => [c.label, c.startSection, c.depth])).toEqual([
      ['Part I', 0, 0],
      ['Ch 1', 1, 1],
      ['Ch 2', 2, 1],
      ['Part II', 3, 0],
    ]);
  });

  test('collapses consecutive entries that resolve to the same section', () => {
    const chapters = deriveDownloadChapters(
      [toc('Heading', 'h'), toc('Subheading', 'h#frag'), toc('Next', 'n')],
      resolver({ h: 1, 'h#frag': 1, n: 3 }),
      5,
    );
    expect(chapters.map((c) => [c.label, c.startSection, c.endSection])).toEqual([
      ['Heading', 1, 3],
      ['Next', 3, 5],
    ]);
  });

  test('a chapter that spans several TOC-less sections covers all of them', () => {
    const chapters = deriveDownloadChapters(
      [toc('One', 'a'), toc('Two', 'b')],
      resolver({ a: 0, b: 5 }),
      8,
    );
    expect(chapters[0]).toMatchObject({ startSection: 0, endSection: 5 });
    expect(chapters[1]).toMatchObject({ startSection: 5, endSection: 8 });
  });

  test('falls back to one row per section when there is no usable TOC', () => {
    const chapters = deriveDownloadChapters([], resolver({}), 3);
    expect(chapters).toEqual([
      { key: 'section-0', label: 'Section 1', depth: 0, startSection: 0, endSection: 1 },
      { key: 'section-1', label: 'Section 2', depth: 0, startSection: 1, endSection: 2 },
      { key: 'section-2', label: 'Section 3', depth: 0, startSection: 2, endSection: 3 },
    ]);
  });

  test('drops entries whose href does not resolve', () => {
    const chapters = deriveDownloadChapters(
      [toc('Good', 'a'), toc('Broken', 'x'), toc('Also good', 'c')],
      resolver({ a: 0, c: 2 }),
      4,
    );
    expect(chapters.map((c) => c.label)).toEqual(['Good', 'Also good']);
  });
});

describe('chapterDownloadStatus', () => {
  const chapter = { key: 'a', label: 'A', depth: 0, startSection: 1, endSection: 4 };

  test('complete only when every span section is packed', () => {
    const statuses = new Map([
      [1, { total: 3, recorded: 3, packed: true }],
      [2, { total: 2, recorded: 2, packed: true }],
      [3, { total: 4, recorded: 4, packed: true }],
    ]);
    expect(chapterDownloadStatus(chapter, statuses)).toBe('complete');
  });

  test('partial when some section has recorded audio but not all are packed', () => {
    const statuses = new Map([
      [1, { total: 3, recorded: 3, packed: true }],
      [2, { total: 2, recorded: 1, packed: false }],
    ]);
    expect(chapterDownloadStatus(chapter, statuses)).toBe('partial');
  });

  test('none when no span section has any recorded audio', () => {
    expect(chapterDownloadStatus(chapter, new Map())).toBe('none');
  });
});
