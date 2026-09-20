import { describe, expect, it } from 'vitest';
import { alignEbookChapters, collectTopLevelChapterIds } from '@/services/bookorbit/pairing';
import type { TOCItem } from '@/libs/document';

// The real TOC of the Standard Ebooks "Adventures of Sherlock Holmes" that is
// paired with a 12-part LibriVox recording: front matter, twelve stories with
// one of them split into sub-sections, then back matter.
const toc: TOCItem[] = [
  { label: 'Titlepage', href: 'text/titlepage.xhtml' },
  { label: 'Imprint', href: 'text/imprint.xhtml' },
  {
    label: 'A Scandal in Bohemia',
    href: 'text/a-scandal-in-bohemia.xhtml',
    subitems: [
      { label: 'I', href: 'text/a-scandal-in-bohemia.xhtml#i' },
      { label: 'II', href: 'text/a-scandal-in-bohemia.xhtml#ii' },
      { label: 'III', href: 'text/a-scandal-in-bohemia.xhtml#iii' },
    ],
  },
  ...[
    'the-redheaded-league',
    'a-case-of-identity',
    'the-boscombe-valley-mystery',
    'the-five-orange-pips',
    'the-man-with-the-twisted-lip',
    'the-adventure-of-the-blue-carbuncle',
    'the-adventure-of-the-speckled-band',
    'the-adventure-of-the-engineers-thumb',
    'the-adventure-of-the-noble-bachelor',
    'the-adventure-of-the-beryl-coronet',
    'the-adventure-of-the-copper-beeches',
  ].map((slug) => ({ label: slug, href: `text/${slug}.xhtml` })),
  { label: 'Colophon', href: 'text/colophon.xhtml' },
  { label: 'Uncopyright', href: 'text/uncopyright.xhtml' },
] as TOCItem[];

describe('collectTopLevelChapterIds', () => {
  // A sub-section of a story is never its own audio chapter; flattening them
  // in is what made the ebook list longer than the recording.
  it('ignores sub-sections nested under a chapter', () => {
    const ids = collectTopLevelChapterIds(toc);

    expect(ids).toHaveLength(16);
    expect(ids.some((id) => id.includes('#'))).toBe(false);
  });
});

describe('alignEbookChapters', () => {
  it('drops front and back matter to meet the recording exactly', () => {
    const aligned = alignEbookChapters(collectTopLevelChapterIds(toc), 12);

    expect(aligned).toHaveLength(12);
    expect(aligned[0]).toBe('text/a-scandal-in-bohemia.xhtml');
    expect(aligned[11]).toBe('text/the-adventure-of-the-copper-beeches.xhtml');
  });

  it('leaves an already-matching list untouched', () => {
    const ids = ['a', 'b', 'c'];

    expect(alignEbookChapters(ids, 3)).toEqual(ids);
  });

  // Trimming is only ever allowed to *reach* an exact match. If it cannot,
  // the caller must not map: a near-miss alignment narrates the wrong text.
  it('gives up rather than trimming to an approximate fit', () => {
    expect(alignEbookChapters(collectTopLevelChapterIds(toc), 7)).toEqual([]);
    expect(alignEbookChapters(['a', 'b'], 5)).toEqual([]);
  });

  it('never trims a real chapter just because the count is close', () => {
    // Four stories, no matter: nothing here is front matter, so a request for
    // three must fail rather than dropping a story.
    expect(alignEbookChapters(['s1', 's2', 's3', 's4'], 3)).toEqual([]);
  });
});
