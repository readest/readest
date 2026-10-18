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

const FB2 = resolve(__dirname, '../fixtures/data/sample-kosync.fb2');

const openBook = async (): Promise<BookDoc> => {
  const file = new File([readFileSync(FB2)], 'sample-kosync.fb2', {
    type: 'application/x-fictionbook+xml',
  });
  return (await new DocumentLoader(file).open()).book;
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
  const element = CFI.toElement(doc, parts[0]) as Element;
  return { index, text: element.textContent };
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
    expect(await textAt(book, cfi)).toEqual({ index: 6, text: 'The second note.' });
  });
});
