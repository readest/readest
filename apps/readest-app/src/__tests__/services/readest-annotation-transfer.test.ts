import { describe, expect, it } from 'vitest';
import * as CFI from 'foliate-js/epubcfi.js';

import type { BookDoc } from '@/libs/document';
import type { BooknoteGroup, BookNote } from '@/types/book';
import {
  READEST_ANNOTATION_FORMAT,
  type ReadestAnnotationExport,
  buildAnnotationExport,
  convertAnnotationExportToBookNotes,
  parseAnnotationExport,
} from '@/services/annotation/providers/readest';

const CHAPTER_ONE = `<html><body>
  <p id="p1">The quick brown fox jumps over the lazy dog.</p>
  <p id="p2">Nothing else of note happens here.</p>
</body></html>`;

const CHAPTER_TWO = `<html><body>
  <p id="p3">Second chapter opens quietly.</p>
  <p id="p4">A memorable phrase worth keeping.</p>
</body></html>`;

const parseDoc = (html: string) => new DOMParser().parseFromString(html, 'text/html');

/** Locate `needle` in the first text node that contains it and return its Range. */
const rangeFor = (doc: Document, needle: string): Range => {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node) {
    const offset = node.data.indexOf(needle);
    if (offset >= 0) {
      const range = doc.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + needle.length);
      return range;
    }
    node = walker.nextNode() as Text | null;
  }
  throw new Error(`"${needle}" not present in the document`);
};

/** Build the same indirect CFI the reader stores for a highlight. */
const cfiFor = (sectionIndex: number, html: string, needle: string): string =>
  CFI.joinIndir(CFI.fake.fromIndex(sectionIndex), CFI.fromRange(rangeFor(parseDoc(html), needle)));

/**
 * A two-section BookDoc with no `resolveCFI` of its own, so the conversion
 * exercises the fake-CFI fallback used for non-EPUB formats.
 */
const makeBookDoc = (chapters: string[] = [CHAPTER_ONE, CHAPTER_TWO]): BookDoc =>
  ({
    sections: chapters.map((html, index) => ({
      id: `s${index}`,
      cfi: CFI.fake.fromIndex(index),
      size: html.length,
      linear: 'yes',
      createDocument: async () => parseDoc(html),
    })),
  }) as unknown as BookDoc;

const makeEntry = (overrides: Record<string, unknown> = {}) => ({
  id: 'note-1',
  type: 'annotation' as const,
  cfi: cfiFor(0, CHAPTER_ONE, 'quick brown fox'),
  text: 'quick brown fox',
  style: 'highlight' as const,
  color: 'yellow',
  note: 'a note',
  createdAt: 1000,
  updatedAt: 2000,
  ...overrides,
});

const makePayload = (entries: ReturnType<typeof makeEntry>[]): ReadestAnnotationExport => ({
  $format: READEST_ANNOTATION_FORMAT,
  version: 1,
  exportedAt: 5000,
  book: { title: 'Book', author: 'Author', hash: 'oldhash', format: 'EPUB' },
  annotations: entries,
});

const makeNote = (overrides: Partial<BookNote> = {}): BookNote => ({
  id: 'n1',
  type: 'annotation',
  cfi: 'epubcfi(/6/2!/4/2/1:0)',
  text: 'hello',
  style: 'highlight',
  color: 'yellow',
  note: '',
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides,
});

const makeGroup = (notes: BookNote[]): BooknoteGroup => ({
  id: 0,
  href: 'chapter1.xhtml',
  label: 'Chapter 1',
  booknotes: notes,
});

describe('buildAnnotationExport', () => {
  it('mirrors BookNote fields and carries book identity plus position', () => {
    const payload = buildAnnotationExport({
      book: { title: 'Book', author: 'Author', hash: 'abc', metaHash: 'def', format: 'EPUB' },
      groups: [makeGroup([makeNote({ note: 'kept', global: true })])],
      progress: [12, 300],
      location: 'epubcfi(/6/14!/4/2/1:0)',
      exportedAt: 7000,
    });

    expect(payload.$format).toBe(READEST_ANNOTATION_FORMAT);
    expect(payload.exportedAt).toBe(7000);
    expect(payload.book).toEqual({
      title: 'Book',
      author: 'Author',
      hash: 'abc',
      metaHash: 'def',
      format: 'EPUB',
    });
    expect(payload.progress).toEqual([12, 300]);
    expect(payload.location).toBe('epubcfi(/6/14!/4/2/1:0)');
    expect(payload.annotations).toHaveLength(1);
    expect(payload.annotations[0]).toMatchObject({
      id: 'n1',
      type: 'annotation',
      text: 'hello',
      style: 'highlight',
      color: 'yellow',
      note: 'kept',
      global: true,
      createdAt: 1000,
      updatedAt: 1000,
    });
  });

  it('strips per-install fields and excludes soft-deleted notes', () => {
    const payload = buildAnnotationExport({
      book: { title: 'Book', author: 'Author' },
      groups: [
        makeGroup([
          makeNote({ id: 'keep', bookHash: 'abc', metaHash: 'def', page: 42 }),
          makeNote({ id: 'gone', deletedAt: 999 }),
        ]),
      ],
      exportedAt: 7000,
    });

    expect(payload.annotations.map((a) => a.id)).toEqual(['keep']);
    const [entry] = payload.annotations;
    expect(entry).not.toHaveProperty('bookHash');
    expect(entry).not.toHaveProperty('metaHash');
    expect(entry).not.toHaveProperty('page');
    expect(entry).not.toHaveProperty('deletedAt');
  });

  it('keeps bookmarks and excerpts alongside annotations', () => {
    const payload = buildAnnotationExport({
      book: { title: 'Book', author: 'Author' },
      groups: [
        makeGroup([
          makeNote({ id: 'a', type: 'annotation' }),
          makeNote({ id: 'b', type: 'bookmark', text: undefined, style: undefined }),
          makeNote({ id: 'c', type: 'excerpt' }),
        ]),
      ],
      exportedAt: 7000,
    });

    expect(payload.annotations.map((a) => a.type)).toEqual(['annotation', 'bookmark', 'excerpt']);
  });
});

describe('parseAnnotationExport', () => {
  it('round-trips a built payload', () => {
    const payload = buildAnnotationExport({
      book: { title: 'Book', author: 'Author' },
      groups: [makeGroup([makeNote()])],
      exportedAt: 7000,
    });
    const parsed = parseAnnotationExport(JSON.stringify(payload));
    expect(parsed).toEqual(payload);
  });

  it('rejects malformed JSON and foreign formats', () => {
    expect(parseAnnotationExport('not json at all')).toBeNull();
    expect(parseAnnotationExport('[]')).toBeNull();
    expect(parseAnnotationExport(JSON.stringify({ annotations: [] }))).toBeNull();
    expect(
      parseAnnotationExport(JSON.stringify({ $format: 'moon-reader', annotations: [] })),
    ).toBeNull();
    expect(
      parseAnnotationExport(JSON.stringify({ $format: READEST_ANNOTATION_FORMAT })),
    ).toBeNull();
  });

  it('drops entries missing an id, cfi, or valid type', () => {
    const parsed = parseAnnotationExport(
      JSON.stringify({
        $format: READEST_ANNOTATION_FORMAT,
        version: 1,
        book: { title: 'Book', author: 'Author' },
        annotations: [
          { id: 'ok', type: 'annotation', cfi: 'epubcfi(/6/2!/4)', note: '' },
          { id: 'no-cfi', type: 'annotation', note: '' },
          { type: 'annotation', cfi: 'epubcfi(/6/2!/4)', note: '' },
          { id: 'bad-type', type: 'sticker', cfi: 'epubcfi(/6/2!/4)', note: '' },
        ],
      }),
    );

    expect(parsed?.annotations.map((a) => a.id)).toEqual(['ok']);
  });
});

describe('convertAnnotationExportToBookNotes', () => {
  it('keeps the original CFI when it resolves to the exported text', async () => {
    const entry = makeEntry();
    const result = await convertAnnotationExportToBookNotes(makePayload([entry]), makeBookDoc());

    expect(result.total).toBe(1);
    expect(result.reanchored).toBe(0);
    expect(result.unmatched).toBe(0);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]!.cfi).toBe(entry.cfi);
    expect(result.notes[0]!.note).toBe('a note');
  });

  it('re-anchors when the CFI resolves but the text no longer matches', async () => {
    // The CFI points into chapter one; the text now lives in chapter two.
    const entry = makeEntry({
      cfi: cfiFor(0, CHAPTER_ONE, 'quick brown fox'),
      text: 'memorable phrase',
    });
    const result = await convertAnnotationExportToBookNotes(makePayload([entry]), makeBookDoc());

    expect(result.unmatched).toBe(0);
    expect(result.reanchored).toBe(1);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]!.cfi).not.toBe(entry.cfi);
    expect(result.notes[0]!.cfi).toBe(cfiFor(1, CHAPTER_TWO, 'memorable phrase'));
  });

  it('re-anchors when the CFI no longer resolves at all', async () => {
    const entry = makeEntry({
      cfi: CFI.joinIndir(CFI.fake.fromIndex(7), '/4/2/1:0'),
      text: 'memorable phrase',
    });
    const result = await convertAnnotationExportToBookNotes(makePayload([entry]), makeBookDoc());

    expect(result.reanchored).toBe(1);
    expect(result.notes[0]!.cfi).toBe(cfiFor(1, CHAPTER_TWO, 'memorable phrase'));
  });

  it('drops annotations whose text is nowhere in the book', async () => {
    const entry = makeEntry({ text: 'a sentence this book never contains' });
    const result = await convertAnnotationExportToBookNotes(makePayload([entry]), makeBookDoc());

    expect(result.notes).toHaveLength(0);
    expect(result.unmatched).toBe(1);
    expect(result.reanchored).toBe(0);
  });

  it('clears stale xpointers on a re-anchored note but keeps them on an exact match', async () => {
    const payload = makePayload([
      makeEntry({ id: 'exact', xpointer0: '/body/p[1]', xpointer1: '/body/p[1]' }),
      makeEntry({
        id: 'moved',
        text: 'memorable phrase',
        xpointer0: '/body/p[1]',
        xpointer1: '/body/p[1]',
      }),
    ]);
    const result = await convertAnnotationExportToBookNotes(payload, makeBookDoc());

    const exact = result.notes.find((n) => n.id === 'exact')!;
    const moved = result.notes.find((n) => n.id === 'moved')!;
    expect(exact.xpointer0).toBe('/body/p[1]');
    expect(moved.xpointer0).toBeUndefined();
    expect(moved.xpointer1).toBeUndefined();
  });

  // Readest bookmarks carry a `text` snippet of the surrounding paragraph purely
  // for display in the bookmark list. It is routinely truncated, sometimes a
  // chapter label, and their CFI is often a collapsed point covering no text at
  // all — so a bookmark's text must never be treated as an anchor assertion.
  it('keeps a bookmark anchored at a collapsed point CFI even though it carries text', async () => {
    const doc = parseDoc(CHAPTER_ONE);
    const point = rangeFor(doc, 'quick brown fox');
    point.collapse(true);
    const cfi = CFI.joinIndir(CFI.fake.fromIndex(0), CFI.fromRange(point));

    const result = await convertAnnotationExportToBookNotes(
      makePayload([
        makeEntry({
          id: 'mark',
          type: 'bookmark',
          cfi,
          text: 'The quick brown fox jumps over the lazy dog. Nothing else of no',
          style: undefined,
        }),
      ]),
      makeBookDoc(),
    );

    expect(result.unmatched).toBe(0);
    expect(result.reanchored).toBe(0);
    expect(result.notes[0]!.cfi).toBe(cfi);
  });

  it('keeps a bookmark whose text is only a truncated prefix of its range', async () => {
    const cfi = cfiFor(0, CHAPTER_ONE, 'The quick brown fox jumps over the lazy dog.');
    const result = await convertAnnotationExportToBookNotes(
      makePayload([
        makeEntry({
          id: 'mark',
          type: 'bookmark',
          cfi,
          text: 'The quick brown fox',
          style: undefined,
        }),
      ]),
      makeBookDoc(),
    );

    expect(result.unmatched).toBe(0);
    expect(result.reanchored).toBe(0);
    expect(result.notes[0]!.cfi).toBe(cfi);
  });

  it('keeps a bookmark whose text is a chapter label absent from the book', async () => {
    const cfi = cfiFor(1, CHAPTER_TWO, 'Second chapter');
    const result = await convertAnnotationExportToBookNotes(
      makePayload([
        makeEntry({
          id: 'mark',
          type: 'bookmark',
          cfi,
          text: 'in Chapter 9 - The Mock Turtle’s Story',
          style: undefined,
        }),
      ]),
      makeBookDoc(),
    );

    expect(result.unmatched).toBe(0);
    expect(result.notes[0]!.cfi).toBe(cfi);
  });

  it('keeps a bookmark whose CFI resolves and drops one whose CFI does not', async () => {
    const payload = makePayload([
      makeEntry({
        id: 'live',
        type: 'bookmark',
        text: undefined,
        style: undefined,
        cfi: cfiFor(0, CHAPTER_ONE, 'The quick'),
      }),
      makeEntry({
        id: 'dead',
        type: 'bookmark',
        text: undefined,
        style: undefined,
        cfi: CFI.joinIndir(CFI.fake.fromIndex(9), '/4/2/1:0'),
      }),
    ]);
    const result = await convertAnnotationExportToBookNotes(payload, makeBookDoc());

    expect(result.notes.map((n) => n.id)).toEqual(['live']);
    expect(result.unmatched).toBe(1);
  });

  it('round-trips export -> file -> import without moving any anchor', async () => {
    // The feature's core promise: what Readest writes, Readest reads back
    // into the same book with every highlight landing where it started.
    const notes: BookNote[] = [
      makeNote({
        id: 'one',
        cfi: cfiFor(0, CHAPTER_ONE, 'quick brown fox'),
        text: 'quick brown fox',
        note: 'first',
      }),
      makeNote({
        id: 'two',
        cfi: cfiFor(1, CHAPTER_TWO, 'memorable phrase'),
        text: 'memorable phrase',
        color: 'green',
        style: 'underline',
      }),
      makeNote({
        id: 'mark',
        type: 'bookmark',
        cfi: cfiFor(1, CHAPTER_TWO, 'Second chapter'),
        text: undefined,
        style: undefined,
      }),
    ];

    const file = JSON.stringify(
      buildAnnotationExport({
        book: { title: 'Book', author: 'Author', hash: 'abc', format: 'EPUB' },
        groups: [makeGroup(notes)],
        exportedAt: 7000,
      }),
    );
    const payload = parseAnnotationExport(file)!;
    const result = await convertAnnotationExportToBookNotes(payload, makeBookDoc());

    expect(result.unmatched).toBe(0);
    expect(result.reanchored).toBe(0);
    expect(result.notes).toEqual(notes);
  });

  it('never emits per-install identity fields on imported notes', async () => {
    const result = await convertAnnotationExportToBookNotes(
      makePayload([makeEntry()]),
      makeBookDoc(),
    );
    const note = result.notes[0]!;
    expect(note.bookHash).toBeUndefined();
    expect(note.metaHash).toBeUndefined();
    expect(note.deletedAt).toBeUndefined();
  });
});
