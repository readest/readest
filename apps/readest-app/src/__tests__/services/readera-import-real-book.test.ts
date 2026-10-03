import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join as joinPath, resolve as resolvePath } from 'path';

import * as CFI from 'foliate-js/epubcfi.js';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import { convertReadEraDocToBookNotes } from '@/services/annotation/providers/readera';
import {
  extractReadEraLibrary,
  findReadEraDocForBook,
  parseReadEraBackup,
  type ReadEraDoc,
} from '@/utils/readera';

/**
 * End-to-end import of a ReadEra backup into the book it belongs to.
 *
 * The backup is built here rather than committed as a fixture because a real
 * one carries the whole library, but every field, and every XPointer shape,
 * is copied from the sample backup attached to issue #5982 — including the
 * `body/body` level ReadEra keeps inside each `DocFragment`, the legacy
 * `body/html/body` form, and the synthetic `autoBoxing` steps. Those shapes
 * only resolve against a real XHTML section document, which is what makes
 * this test worth the EPUB parse.
 */

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

const noteData = (xPath: string, xPathEnd?: string) =>
  JSON.stringify({ xPath, ...(xPathEnd ? { xPathEnd } : {}) });

const ALICE_OPENING =
  'Alice was beginning to get very tired of sitting by her sister on the bank, ' +
  'and of having nothing to do';

const buildLibraryJson = () =>
  JSON.stringify({
    version: 1,
    docs: [
      {
        uri: 'file:///storage/emulated/0/Books/other.epub',
        data: { doc_format: 'EPUB', doc_title: 'Through the Looking-Glass' },
        citations: [],
        bookmarks: [],
      },
      {
        uri: 'file:///storage/emulated/0/Books/sample-alice.epub',
        data: {
          doc_format: 'EPUB',
          doc_title: "Alice's Adventures in Wonderland",
          doc_authors: 'Lewis Carroll',
          doc_file_name_title: 'sample-alice',
          doc_file_size: 1234567,
          doc_position: JSON.stringify({
            ratio: 0.1234,
            page: 12,
            pagesCount: 140,
            xPath: '/body/DocFragment[5]/body/body/div/div/div/p[1]/text().0',
          }),
        },
        citations: [
          {
            note_uri: 'citation-opening',
            note_type: 3,
            note_body: ALICE_OPENING,
            note_extra: 'the first sentence',
            note_mark: 2,
            note_page: 12,
            note_insert_time: 1662042803762,
            note_modified_time: 1662042900000,
            note_data: noteData(
              '/body/DocFragment[4]/body/body/div/div/div/p[1]/text().0',
              `/body/DocFragment[4]/body/body/div/div/div/p[1]/text().${ALICE_OPENING.length}`,
            ),
          },
          {
            note_uri: 'citation-reflowed',
            note_type: 3,
            note_body: 'a sentence from a different edition of this book',
            note_extra: '',
            note_mark: 3,
            note_insert_time: 1662042803763,
            note_modified_time: 1662042803763,
            note_data: noteData(
              '/body/DocFragment[4]/body/body/div/div/div/p[2]/autoBoxing/text().0',
            ),
          },
          {
            note_uri: 'citation-legacy-dom',
            note_type: 3,
            note_body: 'another sentence that is not in this edition',
            note_extra: '',
            note_mark: 0,
            note_insert_time: 1662042803764,
            note_modified_time: 1662042803764,
            note_data: noteData('/body/DocFragment[5]/body/html/body/div/div/div/p[1]/text().0'),
          },
          {
            note_uri: 'citation-missing-chapter',
            note_type: 3,
            note_body: 'a highlight from a chapter this edition does not have',
            note_extra: '',
            note_mark: 1,
            note_insert_time: 1662042803765,
            note_modified_time: 1662042803765,
            note_data: noteData('/body/DocFragment[99]/body/body/p[1]/text().0'),
          },
        ],
        bookmarks: [
          {
            note_uri: 'bookmark-pool-of-tears',
            note_type: 2,
            note_body: 'The Pool of Tears',
            note_extra: '',
            note_insert_time: 1662042803766,
            note_modified_time: 1662042803766,
            note_data: noteData('/body/DocFragment[5]/body/body/div/div/div/p[2]/text().0'),
          },
        ],
      },
      {
        uri: 'file:///storage/emulated/0/Books/deleted.epub',
        data: {
          doc_format: 'EPUB',
          doc_title: "Alice's Adventures in Wonderland",
          doc_delete_time: 1662042803700,
        },
        citations: [],
        bookmarks: [],
      },
    ],
  });

/** Resolve an imported CFI back to the text it covers in the real book. */
const anchorText = async (book: BookDoc, cfi: string): Promise<string> => {
  const resolved = book.resolveCFI!(cfi);
  expect(resolved).not.toBeNull();
  const section = book.sections![resolved!.index]!;
  const doc = await section.createDocument();
  const anchored = resolved!.anchor!(doc);
  if (typeof anchored === 'number') return '';
  return collapse(anchored.toString() || (anchored.startContainer.textContent ?? ''));
};

const buildBackup = async (libraryJson: string): Promise<ArrayBuffer> => {
  const { configureZip } = await import('@/utils/zip');
  await configureZip();
  const { BlobWriter, TextReader, ZipWriter } = await import('@zip.js/zip.js');
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  await writer.add('library.json', new TextReader(libraryJson));
  await writer.add('meta.json', new TextReader('{"app_version":"25.8.1"}'));
  return (await writer.close()).arrayBuffer();
};

describe('importing a real ReadEra backup into the book it belongs to', () => {
  let bookDoc: BookDoc;
  let readEraDoc: ReadEraDoc;

  beforeAll(async () => {
    const buffer = readFileSync(resolvePath(__dirname, '../fixtures/data/sample-alice.epub'));
    const file = new File([buffer], 'sample-alice.epub', { type: 'application/epub+zip' });
    ({ book: bookDoc } = await new DocumentLoader(file).open());

    const library = await extractReadEraLibrary(await buildBackup(buildLibraryJson()));
    const docs = parseReadEraBackup(library!)!;
    // The deleted duplicate must not be a candidate for the same book.
    expect(docs).toHaveLength(2);
    readEraDoc = findReadEraDocForBook(docs, {
      title: "Alice's Adventures in Wonderland",
      author: 'Lewis Carroll',
      format: 'EPUB',
    })!;
  }, 60000);

  it('picks the right document out of the backup', () => {
    expect(readEraDoc).toBeDefined();
    expect(readEraDoc.citations).toHaveLength(4);
    expect(readEraDoc.bookmarks).toHaveLength(1);
  });

  it('anchors a highlight on the words it covers in the real book', async () => {
    const result = await convertReadEraDocToBookNotes(readEraDoc, bookDoc);
    const note = result.notes.find((n) => n.id === 'readera-citation-opening')!;
    expect(note.type).toBe('annotation');
    expect(note.style).toBe('highlight');
    expect(note.note).toBe('the first sentence');
    expect(await anchorText(bookDoc, note.cfi)).toBe(collapse(ALICE_OPENING));
  });

  it('falls back to the XPointer, autoBoxing and all, when the text has changed', async () => {
    const result = await convertReadEraDocToBookNotes(readEraDoc, bookDoc);
    const note = result.notes.find((n) => n.id === 'readera-citation-reflowed')!;
    expect(await anchorText(bookDoc, note.cfi)).toContain('So she was considering');
  });

  it('resolves the legacy html/body XPointer of an older ReadEra DOM', async () => {
    const result = await convertReadEraDocToBookNotes(readEraDoc, bookDoc);
    const note = result.notes.find((n) => n.id === 'readera-citation-legacy-dom')!;
    expect(await anchorText(bookDoc, note.cfi)).toContain('Curiouser and curiouser');
  });

  it('places a bookmark on its own paragraph and keeps its label', async () => {
    const result = await convertReadEraDocToBookNotes(readEraDoc, bookDoc);
    const bookmark = result.notes.find((n) => n.id === 'readera-bookmark-pool-of-tears')!;
    expect(bookmark.type).toBe('bookmark');
    expect(bookmark.text).toBe('The Pool of Tears');
    expect(bookmark.color).toBeUndefined();
    expect(await anchorText(bookDoc, bookmark.cfi)).toContain(
      'And she went on planning to herself',
    );
  });

  it('carries the reading position over to a location in the right chapter', async () => {
    const result = await convertReadEraDocToBookNotes(readEraDoc, bookDoc);
    expect(await anchorText(bookDoc, result.location!)).toContain('Curiouser and curiouser');
  });

  it('skips the highlight whose chapter this edition does not have', async () => {
    const result = await convertReadEraDocToBookNotes(readEraDoc, bookDoc);
    expect(result.total).toBe(5);
    expect(result.notes).toHaveLength(4);
    expect(result.unmatched).toBe(1);
    expect(result.notes.some((n) => n.id === 'readera-citation-missing-chapter')).toBe(false);
  });

  it('is idempotent: importing the same backup twice yields identical anchors', async () => {
    const first = await convertReadEraDocToBookNotes(readEraDoc, bookDoc);
    const second = await convertReadEraDocToBookNotes(readEraDoc, bookDoc);
    expect(second.notes).toEqual(first.notes);
    expect(second.location).toBe(first.location);
  });
});

/**
 * The same import against a real PDF. ReadEra locates PDF notes with MuPDF page
 * paths whose page index is 0-based, and drops the locator entirely for most
 * bookmarks and reading positions, leaving only the page number.
 */
const PDF_PAGE_TEXT = 'beautifully printed on it in large letters.';

const buildPdfLibraryJson = () =>
  JSON.stringify({
    version: 1,
    docs: [
      {
        uri: 'sha-1:0f8ac0d0eb8f0be4c2a2ab7ee97b7cc6cdd4d0c4',
        data: {
          doc_format: 'PDF',
          // PDFs carry no title of their own, so ReadEra and Readest both fall
          // back to the file name.
          doc_file_name_title: 'sample-alice',
          doc_position: JSON.stringify({ ratio: 0.0434, page: 3, pagesCount: 69 }),
        },
        citations: [
          {
            note_uri: 'pdf-citation',
            note_type: 3,
            note_body: PDF_PAGE_TEXT,
            note_extra: '',
            note_mark: 1,
            note_page: 4,
            note_insert_time: 1662042803762,
            note_modified_time: 1662042803762,
            note_data: JSON.stringify({
              page: 4,
              xPath: '/page[4]/block[3]/line[1]/char[0]@0.0980:0.3422',
            }),
          },
        ],
        bookmarks: [
          {
            note_uri: 'pdf-bookmark',
            note_type: 2,
            note_body: 'Bookmark 1',
            note_extra: '',
            note_insert_time: 1662042803766,
            note_modified_time: 1662042803766,
            note_data: JSON.stringify({ ratio: 0.0434, page: 3, pagesCount: 69 }),
          },
        ],
      },
    ],
  });

/** PDF sections carry no spine CFI, so the import anchors onto a synthetic one. */
const sectionIndexOf = (cfi: string): number => {
  const parsed = CFI.parse(cfi);
  return CFI.fake.toIndex((Array.isArray(parsed) ? parsed : parsed.parent)[0]);
};

describe('importing a ReadEra backup into a real PDF', () => {
  let bookDoc: BookDoc;
  let readEraDoc: ReadEraDoc;

  beforeAll(async () => {
    await import('@pdfjs/pdf.min.mjs');
    const pdfjsLib = (globalThis as Record<string, unknown>)['pdfjsLib'] as {
      GlobalWorkerOptions: { workerSrc: string };
    };
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      `file://${joinPath(process.cwd(), 'public/vendor/pdfjs/pdf.worker.min.mjs')}`,
    ).href;

    const buffer = readFileSync(resolvePath(__dirname, '../fixtures/data/sample-alice.pdf'));
    const file = new File([buffer], 'sample-alice.pdf', { type: 'application/pdf' });
    ({ book: bookDoc } = await new DocumentLoader(file).open());

    const library = await extractReadEraLibrary(await buildBackup(buildPdfLibraryJson()));
    const docs = parseReadEraBackup(library!)!;
    readEraDoc = findReadEraDocForBook(docs, {
      title: 'sample-alice',
      sourceTitle: 'sample-alice',
      format: 'PDF',
    })!;
  }, 60000);

  it('anchors a PDF highlight on the page ReadEra put it on', async () => {
    const result = await convertReadEraDocToBookNotes(readEraDoc, bookDoc);
    const note = result.notes.find((n) => n.id === 'readera-pdf-citation')!;
    const parsed = CFI.parse(note.cfi);
    const parts = Array.isArray(parsed) ? parsed : parsed.parent;
    const doc = await bookDoc.sections![CFI.fake.toIndex(parts.shift())]!.createDocument();
    expect(collapse(CFI.toRange(doc, parsed)?.toString() ?? '')).toContain('beautifully printed');
  });

  it('places a page-only bookmark and reading position on that very page', async () => {
    const result = await convertReadEraDocToBookNotes(readEraDoc, bookDoc);
    const bookmark = result.notes.find((n) => n.id === 'readera-pdf-bookmark')!;
    // The page is the whole locator, so nothing was lost placing it there.
    expect(result.unmatched).toBe(0);
    expect(sectionIndexOf(bookmark.cfi)).toBe(3);
    expect(sectionIndexOf(result.location!)).toBe(3);
  });
});
