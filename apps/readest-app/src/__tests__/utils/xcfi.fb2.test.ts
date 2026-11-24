// FB2 positions for KOReader (#6896). crengine reads FB2 natively: its
// XPointers start at /FictionBook and keep the FB2 tag names, while foliate
// splits the first <body> into one section per child and renames the tags.
// The full word-by-word check against crengine is in xcfi.crengine-oracle.test.ts.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as CFI from 'foliate-js/epubcfi.js';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import { getCFIFromXPointer, getXPointerFromCFI } from '@/utils/xcfi';

// sample-kosync.fb2 has a notes body; sample-kosync-onebody.fb2 has only the
// main body. Both open with a body-level image and a title.
const openBook = async (name = 'sample-kosync.fb2'): Promise<BookDoc> => {
  const path = resolve(__dirname, '../fixtures/data', name);
  const file = new File([readFileSync(path)], name, { type: 'application/x-fictionbook+xml' });
  return (await new DocumentLoader(file).open()).book;
};

/** A range CFI over the whole element `selector`. */
const elementCFI = async (book: BookDoc, index: number, selector: string) => {
  const doc = await book.sections![index]!.createDocument();
  const range = doc.createRange();
  range.selectNode(doc.querySelector(selector)!);
  return CFI.joinIndir(CFI.fake.fromIndex(index), CFI.fromRange(range));
};

/** A range CFI over `[start, end)` of the first text node of `selector`. */
const rangeCFI = async (
  book: BookDoc,
  index: number,
  selector: string,
  start: number,
  end: number,
) => {
  const doc = await book.sections![index]!.createDocument();
  const range = doc.createRange();
  const text = doc.querySelector(selector)!.firstChild!;
  range.setStart(text, start);
  range.setEnd(text, end);
  return CFI.joinIndir(CFI.fake.fromIndex(index), CFI.fromRange(range));
};

const textAt = async (book: BookDoc, cfi: string) => {
  const parts = CFI.parse(cfi);
  const index = CFI.fake.toIndex(parts.shift());
  const doc = await book.sections![index]!.createDocument();
  const node = CFI.toElement(doc, parts[0]) as Node;
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement! : (node as Element);
  return { index, tag: element.localName, text: element.textContent };
};

describe('FB2 XPointers', () => {
  it('names the FB2 section, not a DocFragment, when the body opens with an image, title and epigraph', async () => {
    const book = await openBook();
    // foliate section 3 is the first <section>: the image, title and epigraph
    // before it each became a section of their own.
    const cfi = await rangeCFI(book, 3, 'section.section > p', 4, 9);
    const { xpointer } = await getXPointerFromCFI(cfi, undefined, undefined, book, 'FB2');
    expect(xpointer).toBe('/FictionBook/body[1]/section[1]/p[1]/text().4');
  });

  it('opens a KOReader FB2 position in the notes body', async () => {
    const book = await openBook();
    const cfi = await getCFIFromXPointer(
      '/FictionBook/body[2]/section[2]/p/text().4',
      undefined,
      undefined,
      book,
    );
    expect(await textAt(book, cfi)).toEqual({ index: 6, tag: 'p', text: 'The second note.' });
  });

  // crengine (KOReader emulator) writes `body` without an index when the book
  // has one body, `body[1]` when it also has notes, resolves both forms either
  // way, and puts a leading image at `/FictionBook/body/image.0`.
  it('writes body without an index for a one-body book, as crengine does', async () => {
    const book = await openBook('sample-kosync-onebody.fb2');
    // sections: image, title, section, section
    const cfi = await rangeCFI(book, 3, 'section.section > p', 2, 8);
    const { xpointer } = await getXPointerFromCFI(cfi, undefined, undefined, book, 'FB2');
    expect(xpointer).toBe('/FictionBook/body/section[2]/p/text().2');
  });

  it.each([
    ['sample-kosync-onebody.fb2', '/FictionBook/body/image'],
    ['sample-kosync.fb2', '/FictionBook/body[1]/image'],
  ])('names the leading body-level image in %s', async (name, expected) => {
    const book = await openBook(name);
    const cfi = await elementCFI(book, 0, 'img');
    const { xpointer } = await getXPointerFromCFI(cfi, undefined, undefined, book, 'FB2');
    expect(xpointer).toBe(expected);
  });

  it.each([
    '/FictionBook/body/image.0',
    '/FictionBook/body[1]/image.0',
    '/FictionBook/body[1]/image[1]',
  ])('opens %s on the leading image', async (xpointer) => {
    for (const name of ['sample-kosync-onebody.fb2', 'sample-kosync.fb2']) {
      const book = await openBook(name);
      const cfi = await getCFIFromXPointer(xpointer, undefined, undefined, book);
      expect((await textAt(book, cfi)).index).toBe(0);
    }
  });

  it.each([
    '/FictionBook/body/section[2]/p/text().2',
    '/FictionBook/body[1]/section[2]/p/text().2',
  ])('opens %s in a one-body book', async (xpointer) => {
    const book = await openBook('sample-kosync-onebody.fb2');
    const cfi = await getCFIFromXPointer(xpointer, undefined, undefined, book);
    expect(await textAt(book, cfi)).toMatchObject({ index: 3, tag: 'p' });
  });
});
