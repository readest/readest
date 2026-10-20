// MOBI positions for KOReader (#6927). crengine reads a MOBI book as one HTML
// document, so its XPointers start at /html/body and number the top-level
// elements across the book, while foliate splits the book at each
// <mbp:pagebreak>. The word-by-word check against crengine is in
// xcfi.crengine-oracle.test.ts (sample-war-peace-mobi.json).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as CFI from 'foliate-js/epubcfi.js';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import { getXPointerFromCFI } from '@/utils/xcfi';

const openBook = async (name: string, type: string): Promise<BookDoc> => {
  const path = resolve(__dirname, '../fixtures/data', name);
  const file = new File([readFileSync(path)], name, { type });
  return (await new DocumentLoader(file).open()).book;
};

/** A range CFI over `[start, end)` of the first text node under `selector`. */
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

describe('MOBI XPointers', () => {
  it('names the element in the whole book, not a DocFragment', async () => {
    const book = await openBook('sample-war-peace.mobi', 'application/x-mobipocket-ebook');
    // Section 1 opens after the first pagebreak: its second <p> is the book's
    // third, and the book's <head><guide> makes crengine nest a second body.
    const cfi = await rangeCFI(book, 1, 'body > p:nth-of-type(2) > font', 0, 4);
    const { pos0, pos1 } = await getXPointerFromCFI(cfi, undefined, undefined, book, 'MOBI');
    expect(pos0).toBe('/html/body/body/p[3]/font[1]/text().0');
    expect(pos1).toBe('/html/body/body/p[3]/font[1]/text().4');
  }, 30000);

  it('keeps the DocFragment form for a KF8 book, which crengine does not read', async () => {
    const book = await openBook('repro-5918.azw3', 'application/vnd.amazon.mobi8-ebook');
    const cfi = await rangeCFI(book, 0, 'body p', 0, 1);
    const { pos0 } = await getXPointerFromCFI(cfi, undefined, undefined, book, 'AZW3');
    expect(pos0).toMatch(/^\/body\/DocFragment\[1\]\/body\//);
  });
});
