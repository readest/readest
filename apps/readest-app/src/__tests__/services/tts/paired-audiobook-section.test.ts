import { describe, expect, it } from 'vitest';

import type { BookDoc } from '@/libs/document';
import type { PairedAudiobook } from '@/types/book';
import {
  findPairedAudiobookSection,
  loadPairedAudiobookSection,
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
});
