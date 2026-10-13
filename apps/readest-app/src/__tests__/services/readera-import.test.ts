import { describe, it, expect } from 'vitest';
import * as CFI from 'foliate-js/epubcfi.js';
import type { BookDoc } from '@/libs/document';
import type { ReadEraDoc, ReadEraNote } from '@/utils/readera';
import {
  convertReadEraDocToBookNotes,
  findReadEraTextRange,
  mapReadEraColor,
} from '@/services/annotation/providers/readera';

const parseDoc = (html: string) => new DOMParser().parseFromString(html, 'text/html');

/** Resolve a CFI back to the range it covers inside its section document. */
const rangeInSection = async (bookDoc: BookDoc, index: number, cfi: string): Promise<Range> => {
  const doc = await bookDoc.sections![index]!.createDocument();
  const parsed = CFI.parse(cfi);
  (Array.isArray(parsed) ? parsed : parsed.parent).shift();
  return CFI.toRange(doc, parsed);
};

/** A reflowable book whose sections carry real spine CFIs, as EPUB does. */
const makeEpubDoc = (htmls: string[]): BookDoc =>
  ({
    sections: htmls.map((html, index) => ({
      id: `section-${index}`,
      cfi: `epubcfi(/6/${(index + 1) * 2})`,
      size: 1000,
      linear: 'yes',
      createDocument: async () => parseDoc(html),
    })),
  }) as unknown as BookDoc;

/** A paged book whose sections have no spine CFI, as the PDF adapter builds. */
const makePdfDoc = (pages: string[]): BookDoc =>
  ({
    sections: pages.map((html, index) => ({
      id: `${index}`,
      size: 1000,
      linear: 'yes',
      createDocument: async () => parseDoc(`<div class="textLayer">${html}</div>`),
    })),
  }) as unknown as BookDoc;

const makeNote = (overrides: Partial<ReadEraNote> = {}): ReadEraNote => ({
  uri: 'note-1',
  body: 'All grown-ups used to be children once.',
  note: '',
  mark: 2,
  page: 6,
  position: { xPath: '/body/DocFragment[2]/body/html/body/p[1]/text().0' },
  createdAt: 1662042803762,
  updatedAt: 1662042900000,
  ...overrides,
});

const makeReadEraDoc = (overrides: Partial<ReadEraDoc> = {}): ReadEraDoc => ({
  format: 'EPUB',
  title: 'The Little Prince',
  citations: [],
  bookmarks: [],
  ...overrides,
});

describe('findReadEraTextRange', () => {
  it('locates text that spans several inline elements', () => {
    const doc = parseDoc('<p>Grown-ups <em>never</em> understand anything by themselves.</p>');
    const range = findReadEraTextRange(doc, 'never understand anything');
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe('never understand anything');
  });

  it('ignores case and whitespace differences in the ReadEra copy of the text', () => {
    const doc = parseDoc('<p>All grown-ups\n   used to be children once.</p>');
    const range = findReadEraTextRange(doc, 'All grown-ups used to be  children once.');
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe('All grown-ups\n   used to be children once.');
  });

  it('rejects an ambiguous match for a caller that has a locator to fall back on', () => {
    const doc = parseDoc('<p>She saw Alice first.</p><p>Then Alice waited.</p>');
    expect(findReadEraTextRange(doc, 'Alice', true)).toBeNull();
    expect(findReadEraTextRange(doc, 'Alice')).not.toBeNull();
  });

  it('returns null when the text is not in the document', () => {
    const doc = parseDoc('<p>Nothing to see here.</p>');
    expect(findReadEraTextRange(doc, 'a passage from another book')).toBeNull();
  });
});

describe('mapReadEraColor', () => {
  it('maps every ReadEra marker to a distinct Readest color', () => {
    const colors = [0, 1, 2, 3, 4].map(mapReadEraColor);
    expect(new Set(colors).size).toBe(5);
  });

  it('falls back to yellow for an unknown marker', () => {
    expect(mapReadEraColor(undefined)).toBe('yellow');
    expect(mapReadEraColor(42)).toBe('yellow');
  });
});

describe('convertReadEraDocToBookNotes', () => {
  const bookDoc = makeEpubDoc([
    '<p>Once upon a time.</p>',
    '<p>All grown-ups used to be children once.</p><p>Second paragraph.</p>',
  ]);

  it('converts a highlight into a range CFI inside the right section', async () => {
    const readEraDoc = makeReadEraDoc({ citations: [makeNote({ note: 'my note' })] });
    const result = await convertReadEraDocToBookNotes(readEraDoc, bookDoc);

    expect(result.total).toBe(1);
    expect(result.unmatched).toBe(0);
    expect(result.notes).toHaveLength(1);
    const note = result.notes[0]!;
    expect(note.type).toBe('annotation');
    expect(note.cfi.startsWith('epubcfi(/6/4!')).toBe(true);
    expect(note.cfi.includes(',')).toBe(true);
    expect(note.text).toBe('All grown-ups used to be children once.');
    expect(note.note).toBe('my note');
    expect(note.color).toBe(mapReadEraColor(2));
    expect(note.createdAt).toBe(1662042803762);
    expect(note.updatedAt).toBe(1662042900000);
  });

  it('keeps a stable id so a second import changes nothing', async () => {
    const readEraDoc = makeReadEraDoc({ citations: [makeNote()] });
    const first = await convertReadEraDocToBookNotes(readEraDoc, bookDoc);
    const second = await convertReadEraDocToBookNotes(readEraDoc, bookDoc);
    expect(first.notes[0]!.id).toBe(second.notes[0]!.id);
  });

  it('falls back to the XPointer when the highlighted text is gone', async () => {
    const readEraDoc = makeReadEraDoc({
      citations: [
        makeNote({
          body: 'text that is not in this book',
          position: { xPath: '/body/DocFragment[2]/body/html/body/p[2]/text().0' },
        }),
      ],
    });
    const result = await convertReadEraDocToBookNotes(readEraDoc, bookDoc);
    expect(result.unmatched).toBe(0);
    expect(result.notes[0]!.cfi.startsWith('epubcfi(/6/4!')).toBe(true);
    expect(result.notes[0]!.cfi).not.toBe('epubcfi(/6/4!)');
  });

  it('anchors at the chapter start when neither the text nor the XPointer resolves', async () => {
    const readEraDoc = makeReadEraDoc({
      citations: [
        makeNote({
          body: 'text that is not in this book',
          position: { xPath: '/body/DocFragment[2]/body/html/body/p[9]/text().0' },
        }),
      ],
    });
    const result = await convertReadEraDocToBookNotes(readEraDoc, bookDoc);
    expect(result.unmatched).toBe(1);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]!.cfi).toBe('epubcfi(/6/4!)');
  });

  it('converts a bookmark through its XPointer and keeps the ReadEra label', async () => {
    const readEraDoc = makeReadEraDoc({
      bookmarks: [
        makeNote({
          uri: 'bookmark-1',
          body: 'Chapter start',
          mark: undefined,
          position: { xPath: '/body/DocFragment[2]/body/html/body/p[2]/text().0' },
        }),
      ],
    });
    const result = await convertReadEraDocToBookNotes(readEraDoc, bookDoc);
    expect(result.notes).toHaveLength(1);
    const bookmark = result.notes[0]!;
    expect(bookmark.type).toBe('bookmark');
    expect(bookmark.text).toBe('Chapter start');
    expect(bookmark.cfi.startsWith('epubcfi(/6/4!')).toBe(true);
    expect(bookmark.color).toBeUndefined();
  });

  it('prefers the XPointer when the highlighted text appears more than once', async () => {
    const ambiguous = makeEpubDoc([
      '<p>Once upon a time.</p>',
      '<p>She saw Alice first.</p><p>Then Alice waited.</p>',
    ]);
    const readEraDoc = makeReadEraDoc({
      citations: [
        makeNote({
          body: 'Alice',
          position: { xPath: '/body/DocFragment[2]/body/html/body/p[2]/text().5' },
        }),
      ],
    });
    const result = await convertReadEraDocToBookNotes(readEraDoc, ambiguous);
    expect(result.unmatched).toBe(0);
    const range = await rangeInSection(ambiguous, 1, result.notes[0]!.cfi);
    expect(range.startContainer.textContent).toBe('Then Alice waited.');
  });

  it('locates a PDF highlight on its page', async () => {
    const pdfDoc = makePdfDoc([
      '<span>Cover page</span>',
      '<span>Chapter 13 </span><span>The Respiratory System</span>',
    ]);
    const readEraDoc = makeReadEraDoc({
      format: 'PDF',
      citations: [
        makeNote({
          body: 'Chapter 13 The Respiratory System',
          page: 1,
          position: { page: 1, xPath: '/page[1]/block[10]/line[0]/char[1]@0.0980:0.3422' },
        }),
      ],
    });
    const result = await convertReadEraDocToBookNotes(readEraDoc, pdfDoc);
    expect(result.unmatched).toBe(0);
    // PDF sections have no spine CFI, so the locator uses the synthetic one.
    expect(result.notes[0]!.cfi.startsWith('epubcfi(/6/4!')).toBe(true);
  });

  it('places a PDF bookmark that only knows which page it is on', async () => {
    const pdfDoc = makePdfDoc(['<span>Cover page</span>', '<span>Chapter 13</span>']);
    const readEraDoc = makeReadEraDoc({
      format: 'PDF',
      bookmarks: [
        makeNote({
          uri: 'bookmark-page',
          body: 'Bookmark 1',
          mark: undefined,
          // Paged formats drop the locator entirely for a bookmark and keep
          // only the page it sits on.
          position: { page: 1, pagesCount: 2, ratio: 0.5 },
        }),
      ],
    });
    const result = await convertReadEraDocToBookNotes(readEraDoc, pdfDoc);
    expect(result.notes).toHaveLength(1);
    // The page start is exactly what the bookmark pointed at, not a fallback.
    expect(result.unmatched).toBe(0);
    expect(result.notes[0]!.cfi).toBe('epubcfi(/6/4!)');
  });

  it('carries a page-only reading position over on a paged book', async () => {
    const pdfDoc = makePdfDoc(['<span>Cover page</span>', '<span>Chapter 13</span>']);
    const readEraDoc = makeReadEraDoc({
      format: 'PDF',
      position: { page: 1, pagesCount: 2, ratio: 0.5 },
    });
    const result = await convertReadEraDocToBookNotes(readEraDoc, pdfDoc);
    expect(result.location).toBe('epubcfi(/6/4!)');
  });

  it('carries a PDF reading position whose locator names a block over to its page', async () => {
    const pdfDoc = makePdfDoc(['<span>Cover page</span>', '<span>Chapter 13</span>']);
    const readEraDoc = makeReadEraDoc({
      format: 'PDF',
      position: {
        page: 1,
        pagesCount: 2,
        ratio: 0.5,
        xPath: '/page[1]/block[2]/line[0]/char[3]@0.0980:0.3422',
      },
    });
    const result = await convertReadEraDocToBookNotes(readEraDoc, pdfDoc);
    expect(result.location).toBe('epubcfi(/6/4!)');
  });

  it('never guesses a location from a reflowable page number', async () => {
    // ReadEra paginates reflowable books itself, so its page number says
    // nothing about the spine. Guessing one would be the #5980 mistake.
    const readEraDoc = makeReadEraDoc({ position: { page: 1, pagesCount: 300, ratio: 0.5 } });
    const result = await convertReadEraDocToBookNotes(readEraDoc, bookDoc);
    expect(result.location).toBeUndefined();
  });

  it('carries the reading position over as a CFI', async () => {
    const readEraDoc = makeReadEraDoc({
      position: { xPath: '/body/DocFragment[2]/body/html/body/p[2]/text().0', ratio: 0.5 },
    });
    const result = await convertReadEraDocToBookNotes(readEraDoc, bookDoc);
    expect(result.location?.startsWith('epubcfi(/6/4!')).toBe(true);
  });

  it('skips notes whose section is not in the book', async () => {
    const readEraDoc = makeReadEraDoc({
      citations: [makeNote({ position: { xPath: '/body/DocFragment[99]/body/p[1]/text().0' } })],
    });
    const result = await convertReadEraDocToBookNotes(readEraDoc, bookDoc);
    expect(result.notes).toHaveLength(0);
    expect(result.unmatched).toBe(1);
    expect(result.total).toBe(1);
  });
});
