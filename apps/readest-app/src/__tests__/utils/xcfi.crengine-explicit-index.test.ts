// Newer crengine (137cba4, in KOReader nightlies) writes [1] on every step that has
// no same-name sibling, where it used to leave it out (#7166). Both forms name the
// same position, so each explicit pointer here must give the CFI of its old form.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import { getCFIFromXPointer, getCFIFromXPointerRange } from '@/utils/xcfi';

const createDocument = (html: string): Document =>
  new DOMParser().parseFromString(html, 'text/html');

// One div per section, its paragraphs say which section and paragraph they are.
const makeBook = (sections: number): BookDoc =>
  ({
    sections: Array.from({ length: sections }, (_, s) => ({
      linear: 'yes',
      createDocument: async () =>
        createDocument(
          `<html><body><div><p>s${s} p1</p><p>s${s} p2</p><p>s${s} <b>bold</b> p3</p><p>s${s} p4</p></div></body></html>`,
        ),
    })),
  }) as unknown as BookDoc;

const openBook = async (name: string, type: string): Promise<BookDoc> => {
  const path = resolve(__dirname, '../fixtures/data', name);
  const file = new File([readFileSync(path)], name, { type });
  return (await new DocumentLoader(file).open()).book;
};

describe('XPointers with an explicit [1] on every first step', () => {
  it('reads the position from #7166', async () => {
    const book = makeBook(23);
    const explicit = '/body[1]/DocFragment[23]/body[1]/div[1]/p[4]/text()[1].0';
    const old = '/body/DocFragment[23]/body/div/p[4]/text().0';
    const cfi = await getCFIFromXPointer(explicit, undefined, undefined, book);
    expect(cfi).toBe(await getCFIFromXPointer(old, undefined, undefined, book));
  });

  it('reads the section from the index, also when it starts with a 1', async () => {
    const book = makeBook(12);
    const first = await getCFIFromXPointer(
      '/body[1]/DocFragment[1]/body[1]/div[1]/p[1]/text()[1].0',
      undefined,
      undefined,
      book,
    );
    expect(first).toBe(
      await getCFIFromXPointer('/body/DocFragment/body/div/p/text().0', undefined, undefined, book),
    );
    const eleventh = await getCFIFromXPointer(
      '/body[1]/DocFragment[11]/body[1]/div[1]/p[1]/text()[1].0',
      undefined,
      undefined,
      book,
    );
    expect(eleventh).toBe(
      await getCFIFromXPointer(
        '/body/DocFragment[11]/body/div/p/text().0',
        undefined,
        undefined,
        book,
      ),
    );
    expect(eleventh).not.toBe(first);
  });

  it('keeps the text node a text()[K] step picks', async () => {
    const book = makeBook(1);
    const second = await getCFIFromXPointer(
      '/body[1]/DocFragment[1]/body[1]/div[1]/p[3]/text()[2].1',
      undefined,
      undefined,
      book,
    );
    const first = await getCFIFromXPointer(
      '/body[1]/DocFragment[1]/body[1]/div[1]/p[3]/text()[1].1',
      undefined,
      undefined,
      book,
    );
    expect(second).not.toBe(first);
    expect(second).toBe(
      await getCFIFromXPointer(
        '/body/DocFragment/body/div/p[3]/text()[2].1',
        undefined,
        undefined,
        book,
      ),
    );
  });

  it('reads both ends of a range', async () => {
    const book = makeBook(5);
    const cfi = await getCFIFromXPointerRange(
      '/body[1]/DocFragment[5]/body[1]/div[1]/p[2]/text()[1].0',
      '/body[1]/DocFragment[5]/body[1]/div[1]/p[2]/text()[1].2',
      book,
    );
    expect(cfi).toBe(
      await getCFIFromXPointerRange(
        '/body/DocFragment[5]/body/div/p[2]/text().0',
        '/body/DocFragment[5]/body/div/p[2]/text().2',
        book,
      ),
    );
  });

  it('reads an FB2 position', async () => {
    const book = await openBook('sample-kosync.fb2', 'application/x-fictionbook+xml');
    const cfi = await getCFIFromXPointer(
      '/FictionBook[1]/body[2]/section[1]/p[1]/text()[1].0',
      undefined,
      undefined,
      book,
    );
    expect(cfi).toBe(
      await getCFIFromXPointer(
        '/FictionBook/body[2]/section/p/text().0',
        undefined,
        undefined,
        book,
      ),
    );
  });

  it('reads a MOBI position', async () => {
    const book = await openBook('sample-war-peace.mobi', 'application/x-mobipocket-ebook');
    const cfi = await getCFIFromXPointer(
      '/html[1]/body[1]/body[1]/p[3]/font[1]/text()[1].0',
      undefined,
      undefined,
      book,
    );
    expect(cfi).toBe(
      await getCFIFromXPointer('/html/body/body/p[3]/font/text().0', undefined, undefined, book),
    );
  }, 30000);
});
