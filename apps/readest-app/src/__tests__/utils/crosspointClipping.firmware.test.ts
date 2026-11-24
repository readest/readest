import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as CFI from 'foliate-js/epubcfi.js';
import { DocumentLoader, type BookDoc } from '@/libs/document';
import { getCFIFromCrossPointAnchor, getCrossPointAnchorFromCFI } from '@/utils/crosspointClipping';

// Pinned against CrossPoint 2.0.0 (firmware tag 2.0.0, desktop simulator) on
// this same file: a clipping saved on the reader uploaded spine 3, offsets
// 250-266 with this text, and a clipping served with spine 3, offsets 162-182
// and no layout hints was drawn over "peeped into the book".
const SAVED = { spine: 3, start_offset: 250, end_offset: 266, text: 'it, “and what is' };
const SERVED = { spine: 3, start_offset: 162, end_offset: 182, text: 'peeped into the book' };

let book: BookDoc;

beforeAll(async () => {
  const path = resolve(__dirname, '../fixtures/data/sample-alice.epub');
  const file = new File([readFileSync(path)], 'sample-alice.epub', {
    type: 'application/epub+zip',
  });
  book = (await new DocumentLoader(file).open()).book;
});

const textAt = async (cfi: string) => {
  const parts = CFI.parse(cfi);
  const spine = CFI.fake.toIndex(parts.parent.shift());
  const doc = await book.sections![spine]!.createDocument();
  return CFI.toRange(doc, parts).toString();
};

describe('CrossPoint clippings in sample-alice.epub', () => {
  it('places a clipping the reader saved on its text', async () => {
    const { text, ...anchor } = SAVED;
    const cfi = await getCFIFromCrossPointAnchor(anchor, text, book);
    expect(cfi).toBeTruthy();
    expect(await textAt(cfi!)).toBe(text);
  });

  it('anchors a Readest highlight where the reader draws it', async () => {
    const { text, ...anchor } = SERVED;
    const cfi = await getCFIFromCrossPointAnchor(anchor, text, book);
    expect(await textAt(cfi!)).toBe(text);
    expect(await getCrossPointAnchorFromCFI(cfi!, book)).toEqual(anchor);
  });
});
