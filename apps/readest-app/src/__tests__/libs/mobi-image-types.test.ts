import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// readest/readest issue #6562: images in some MOBI and AZW books were saved as
// .txt by "Save Image As". Their blob URLs carried no MIME type: KF8 passed the
// type under the wrong option key (`{ newType }`), and MOBI6 records, which
// have no type of their own, were never typed at all.

const fixture = (name: string) =>
  new File([readFileSync(resolve(__dirname, '../fixtures/data', name))], name);

type Book = {
  mobi: { loadResource: (index: number) => Promise<Uint8Array> };
  loadResource: (ref: number | string) => Promise<string>;
};

const openBook = async (file: File): Promise<Book> => {
  const { MOBI } = (await import('foliate-js/mobi.js')) as {
    MOBI: new (opts: { unzlib: null }) => { open: (f: File) => Promise<Book> };
  };
  return new MOBI({ unzlib: null }).open(file);
};

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);

let blobs: Blob[];

beforeEach(() => {
  blobs = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    blobs.push(blob as Blob);
    return `blob:${blobs.length}`;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MOBI image blob types (#6562)', () => {
  it('types KF8 (AZW3) resources with their MIME type', async () => {
    const book = await openBook(fixture('repro-5918.azw3'));
    vi.spyOn(book.mobi, 'loadResource').mockResolvedValue(JPEG);
    await book.loadResource('kindle:embed:0001?mime=image/jpeg');
    expect(blobs.at(-1)!.type).toBe('image/jpeg');
  });

  it('types MOBI6 images by their content', async () => {
    const book = await openBook(fixture('sample-war-peace.mobi'));
    const records = [JPEG, PNG, GIF];
    vi.spyOn(book.mobi, 'loadResource').mockImplementation(async (i) => records[i]!);
    for (const index of [0, 1, 2]) await book.loadResource(index);
    expect(blobs.map((blob) => blob.type)).toEqual(['image/jpeg', 'image/png', 'image/gif']);
  });
});
