import { describe, expect, it } from 'vitest';

import type { BookDoc } from '@/libs/document';
import type { PairedAudiobook } from '@/types/book';
import {
  adjacentAudioChapter,
  findPairedAudiobookSection,
  loadPairedAudiobookSection,
  narratedAudioChapters,
} from '@/services/tts/pairedAudiobook';

const makeDoc = (body: string): Document =>
  new DOMParser().parseFromString(`<!doctype html><html><body>${body}</body></html>`, 'text/html');

const book = {
  toc: [
    { id: 0, label: 'Cover', href: 'front.xhtml', index: 0 },
    { id: 1, label: 'Chapter 1', href: 'chapter.xhtml#one', index: 0 },
    { id: 2, label: 'Chapter 2', href: 'chapter.xhtml#two', index: 0 },
    { id: 3, label: 'Chapter 3', href: 'last.xhtml', index: 0 },
  ],
  sections: [{ id: 'front.xhtml' }, { id: 'chapter.xhtml' }, { id: 'last.xhtml' }],
  splitTOCHref: (href: string) => href.split('#'),
} as unknown as BookDoc;

const association: PairedAudiobook = {
  version: 1,
  narrator: 'Jane Reader',
  files: [
    { id: 'audio-0', name: 'Part 1.m4b', path: 'hash/audiobook/part-1.m4b', duration: 90 },
    { id: 'audio-1', name: 'Part 2.mp3', path: 'hash/audiobook/part-2.mp3', duration: 40 },
  ],
  chapters: [
    { id: 'audio-0:0', fileId: 'audio-0', label: 'One', start: 5, end: 35 },
    { id: 'audio-0:1', fileId: 'audio-0', label: 'Two', start: 35, end: 90 },
    { id: 'audio-1:0', fileId: 'audio-1', label: 'Three', start: 0, end: 40 },
  ],
  mappings: [
    { ebookChapterId: 'chapter.xhtml#one', audioChapterId: 'audio-0:0' },
    { ebookChapterId: 'chapter.xhtml#two', audioChapterId: 'audio-0:1' },
    { ebookChapterId: 'last.xhtml', audioChapterId: 'audio-1:0' },
  ],
  createdAt: 1,
};

describe('paired audiobook narration sections', () => {
  it('finds the next or previous spine section that has a mapped audio chapter', () => {
    expect(findPairedAudiobookSection(book, association, 0, 1)).toBe(1);
    expect(findPairedAudiobookSection(book, association, 2, -1)).toBe(2);
    expect(findPairedAudiobookSection(book, association, 0, -1)).toBe(-1);
  });

  it('turns mapped TOC chapters into external narration clips', () => {
    const doc = makeDoc(
      '<h1 id="one">Chapter 1</h1><p>First text.</p><h1 id="two">Chapter 2</h1><p>Second text.</p>',
    );
    const section = loadPairedAudiobookSection(book, association, 1, doc, 'en');

    expect(
      section?.pars.map((par) => ({
        text: par.text,
        audioHref: par.audioHref,
        clipBegin: par.clipBegin,
        clipEnd: par.clipEnd,
        range: par.range.toString(),
      })),
    ).toEqual([
      {
        text: 'Chapter 1',
        audioHref: 'hash/audiobook/part-1.m4b',
        clipBegin: 5,
        clipEnd: 35,
        range: 'Chapter 1First text.',
      },
      {
        text: 'Chapter 2',
        audioHref: 'hash/audiobook/part-1.m4b',
        clipBegin: 35,
        clipEnd: 90,
        range: 'Chapter 2Second text.',
      },
    ]);
    expect(section?.blockCount).toBe(2);
    expect(section?.textTiming).toBe('approximate');
  });

  it('resolves named and empty TOC anchors to the following chapter text', () => {
    const doc = makeDoc(
      '<a name="one"></a><h1>Chapter 1</h1><p>First text.</p>' +
        '<a id="two"></a><h1>Chapter 2</h1><p>Second text.</p>',
    );

    const section = loadPairedAudiobookSection(book, association, 1, doc, 'en');

    expect(section?.pars.map((par) => par.range.toString())).toEqual([
      'Chapter 1First text.',
      'Chapter 2Second text.',
    ]);
  });

  it('plays a shared audio chapter once and spans every mapped ebook chapter', () => {
    const shared: PairedAudiobook = {
      ...association,
      mappings: [
        { ebookChapterId: 'chapter.xhtml#one', audioChapterId: 'audio-0:0' },
        { ebookChapterId: 'chapter.xhtml#two', audioChapterId: 'audio-0:0' },
      ],
    };
    const doc = makeDoc(
      '<h1 id="one">Chapter 1</h1><p>First text.</p><h1 id="two">Chapter 2</h1><p>Second text.</p>',
    );

    const section = loadPairedAudiobookSection(book, shared, 1, doc, 'en');

    expect(section?.pars).toHaveLength(1);
    expect(section?.pars[0]?.text).toBe('Chapter 1');
    expect(section?.pars[0]?.range.toString()).toBe('Chapter 1First text.Chapter 2Second text.');
  });

  it('splits a shared audio chapter across consecutive EPUB spine sections', () => {
    const shared: PairedAudiobook = {
      ...association,
      chapters: association.chapters.filter((chapter) => chapter.id !== 'audio-0:1'),
      mappings: [
        { ebookChapterId: 'chapter.xhtml#one', audioChapterId: 'audio-0:0' },
        { ebookChapterId: 'chapter.xhtml#two', audioChapterId: 'audio-0:0' },
        { ebookChapterId: 'last.xhtml', audioChapterId: 'audio-0:0' },
      ],
    };
    const chapterDoc = makeDoc(
      '<h1 id="one">Chapter 1</h1><p>First text.</p><h1 id="two">Chapter 2</h1><p>Second text.</p>',
    );
    const lastDoc = makeDoc('<h1>Chapter 3</h1><p>Third text.</p>');

    const chapterSection = loadPairedAudiobookSection(book, shared, 1, chapterDoc, 'en');
    const lastSection = loadPairedAudiobookSection(book, shared, 2, lastDoc, 'en');

    expect(chapterSection?.pars).toHaveLength(1);
    expect(chapterSection?.pars[0]).toMatchObject({ clipBegin: 5, clipEnd: 25 });
    expect(lastSection?.pars).toHaveLength(1);
    expect(lastSection?.pars[0]).toMatchObject({ clipBegin: 25, clipEnd: 35 });
  });

  describe('unmapped audio chapters', () => {
    // An audiobook whose chapter list is finer than the EPUB's: 1.1 and 1.2
    // have no TOC entry to map to, and the recording ends with credits.
    const subChapters: PairedAudiobook = {
      ...association,
      chapters: [
        { id: 'audio-0:intro', fileId: 'audio-0', label: 'Opening credits', start: 0, end: 5 },
        { id: 'audio-0:0', fileId: 'audio-0', label: 'One', start: 5, end: 35 },
        { id: 'audio-0:0a', fileId: 'audio-0', label: 'One.1', start: 35, end: 50 },
        { id: 'audio-0:0b', fileId: 'audio-0', label: 'One.2', start: 50, end: 60 },
        { id: 'audio-0:1', fileId: 'audio-0', label: 'Two', start: 60, end: 90 },
        { id: 'audio-1:0', fileId: 'audio-1', label: 'Three', start: 0, end: 30 },
        { id: 'audio-1:credits', fileId: 'audio-1', label: 'Credits', start: 30, end: 40 },
      ],
    };
    const doc = makeDoc(
      '<h1 id="one">Chapter 1</h1><p>First text.</p><h1 id="two">Chapter 2</h1><p>Second text.</p>',
    );

    it('plays them as part of the mapped chapter they follow', () => {
      const section = loadPairedAudiobookSection(book, subChapters, 1, doc, 'en');
      expect(section?.pars.map(({ clipBegin, clipEnd }) => [clipBegin, clipEnd])).toEqual([
        [5, 60],
        [60, 90],
      ]);

      const last = loadPairedAudiobookSection(book, subChapters, 2, makeDoc('<p>Third.</p>'), 'en');
      expect(last?.pars.map(({ clipBegin, clipEnd }) => [clipBegin, clipEnd])).toEqual([[0, 40]]);
    });

    it('lists every reachable chapter in recording order with its narrating section', () => {
      expect(
        narratedAudioChapters(book, subChapters).map(({ chapter, audioHref, sectionIndex }) => [
          chapter.label,
          audioHref,
          sectionIndex,
        ]),
      ).toEqual([
        ['One', 'hash/audiobook/part-1.m4b', 1],
        ['One.1', 'hash/audiobook/part-1.m4b', 1],
        ['One.2', 'hash/audiobook/part-1.m4b', 1],
        ['Two', 'hash/audiobook/part-1.m4b', 1],
        ['Three', 'hash/audiobook/part-2.mp3', 2],
        ['Credits', 'hash/audiobook/part-2.mp3', 2],
      ]);
    });

    it('skips to the adjacent chapter, restarting the current one on a late backward skip', () => {
      const chapters = narratedAudioChapters(book, subChapters);
      const label = (entry: ReturnType<typeof adjacentAudioChapter>) =>
        entry?.chapter.label ?? null;
      const part1 = 'hash/audiobook/part-1.m4b';
      const part2 = 'hash/audiobook/part-2.mp3';

      expect(label(adjacentAudioChapter(chapters, part1, 10, 1))).toBe('One.1');
      expect(label(adjacentAudioChapter(chapters, part1, 36, 1))).toBe('One.2');
      expect(label(adjacentAudioChapter(chapters, part1, 89, 1))).toBe('Three');
      expect(label(adjacentAudioChapter(chapters, part2, 35, 1))).toBeNull();

      expect(label(adjacentAudioChapter(chapters, part1, 61, -1))).toBe('One.2');
      expect(label(adjacentAudioChapter(chapters, part1, 70, -1))).toBe('Two');
      expect(label(adjacentAudioChapter(chapters, part2, 1, -1))).toBe('Two');
      expect(label(adjacentAudioChapter(chapters, part1, 6, -1))).toBeNull();
    });
  });
});
