import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import type { BookNote } from '@/types/book';
import { getAnnotationContexts } from '@/services/annotation/context';

const makeNote = (id: string, cfi: string, text: string): BookNote => ({
  id,
  type: 'annotation',
  cfi,
  text,
  note: '',
  style: 'highlight',
  color: 'yellow',
  createdAt: 1,
  updatedAt: 1,
});

// A one-section book whose CFIs are the offsets of the highlight in the only
// text node, e.g. "12-18".
const makeBookDoc = (html: string) => {
  const createDocument = vi.fn(async () => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = html;
    return doc;
  });
  const bookDoc = {
    sections: [{ id: 'chapter.xhtml', createDocument }],
    resolveCFI: (cfi: string) => ({
      index: 0,
      anchor: (doc: Document) => {
        const [start, end] = cfi.split('-').map(Number);
        const text = doc.querySelector('p')!.firstChild!;
        const range = doc.createRange();
        range.setStart(text, start!);
        range.setEnd(text, end!);
        return range;
      },
    }),
  } as unknown as BookDoc;
  return { bookDoc, createDocument };
};

describe('getAnnotationContexts', () => {
  it('returns the sentence containing each highlight, keyed by note id', async () => {
    const { bookDoc, createDocument } = makeBookDoc(
      '<p>It was late. The battery could no longer hold a\n  charge overnight. We left.</p>',
    );

    const contexts = await getAnnotationContexts(bookDoc, [
      makeNote('a', '50-56', 'charge'),
      makeNote('b', '17-24', 'battery'),
    ]);

    expect(contexts).toEqual({
      a: 'The battery could no longer hold a charge overnight.',
      b: 'The battery could no longer hold a charge overnight.',
    });
    // Both highlights live in the same section, which is parsed once.
    expect(createDocument).toHaveBeenCalledTimes(1);
  });

  it('omits the context when the highlight already is the whole sentence', async () => {
    const { bookDoc } = makeBookDoc('<p>First one. Second one.</p>');

    const contexts = await getAnnotationContexts(bookDoc, [makeNote('a', '11-22', 'Second one.')]);

    expect(contexts).toEqual({});
  });

  it('skips notes whose CFI does not resolve', async () => {
    const { bookDoc } = makeBookDoc('<p>Only sentence.</p>');
    bookDoc.resolveCFI = () => null;

    const contexts = await getAnnotationContexts(bookDoc, [makeNote('a', '0-4', 'Only')]);

    expect(contexts).toEqual({});
  });

  it('reads context from the sections of a real EPUB', async () => {
    const buffer = readFileSync(resolve(__dirname, '../fixtures/data/sample-alice.epub'));
    const file = new File([buffer], 'sample-alice.epub', { type: 'application/epub+zip' });
    const { book } = await new DocumentLoader(file).open();
    const annotations: BookNote[] = JSON.parse(
      readFileSync(resolve(__dirname, '../fixtures/data/alice-annotations.json'), 'utf-8'),
    ).annotations;
    const mushroom = annotations.find((note) => note.text?.startsWith('Alice remained looking'))!;

    const contexts = await getAnnotationContexts(book, [mushroom]);

    expect(contexts[mushroom.id]).toBe(
      'Alice remained looking thoughtfully at the mushroom for a minute, trying to make out ' +
        'which were the two sides of it; and, as it was perfectly round, she found this a very ' +
        'difficult question.',
    );
  }, 60000);
});
