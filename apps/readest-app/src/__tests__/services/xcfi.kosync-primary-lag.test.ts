import { describe, it, expect } from 'vitest';
import { XCFI, getXPointerFromCFI } from '@/utils/xcfi';
import type { BookDoc } from '@/libs/document';

const createDocument = (htmlString: string): Document => {
  const parser = new DOMParser();
  return parser.parseFromString(htmlString, 'text/html');
};

// BookDoc stub that respects sparse spine indices so sections[13] can be
// populated without filling 0..12.
const makeBookDoc = (docsByIndex: Record<number, Document>): BookDoc => {
  const sections: Array<{ createDocument: () => Promise<Document> }> = [];
  for (const [index, doc] of Object.entries(docsByIndex)) {
    sections[Number(index)] = { createDocument: async () => doc };
  }
  return { sections } as unknown as BookDoc;
};

// Regression for the KOSync progress-push crash:
// "CFI spine index 13 does not match converter spine index 11".
//
// The paginator's #primaryIndex can lag behind the viewport during scrolling,
// so progress.location can be a CFI in a different spine section than the
// currently-rendered primary view. generateKOProgress used to build its XCFI
// converter from the primary view's document/index and convert the CFI
// directly, which throws whenever the two diverge.
describe('XCFI KOSync primary-index lag', () => {
  // Spine step 28 -> 0-based index 13 -> DocFragment[14].
  // Path after '!': /4 = body, /2 = first element child (p), :5 = text offset.
  const cfi = 'epubcfi(/6/28!/4/2:5)';
  const primaryDoc = createDocument('<html><body><p>Stale primary section.</p></body></html>');
  const cfiDoc = createDocument('<html><body><p>First paragraph here.</p></body></html>');

  it('reproduces the bug: converting against the lagging primary document throws', () => {
    const converter = new XCFI(primaryDoc, 11);
    expect(() => converter.cfiToXPointer(cfi)).toThrow(/spine index 13 does not match/);
  });

  it('resolves the CFI via its own spine section instead of the primary view', async () => {
    const bookDoc = makeBookDoc({ 13: cfiDoc });

    // Mirrors the fixed call: pass the lagging primary doc/index, but the
    // helper loads the CFI's actual section (13) from the book.
    const xpointer = await getXPointerFromCFI(cfi, primaryDoc, 11, bookDoc);
    expect(xpointer.xpointer).toBe('/body/DocFragment[14]/body/p/text().5');
  });
});
