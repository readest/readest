import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression for readest#5918 — AZW3 text scrambled and TOC links dead.
 *
 * KF8 has no random access to its text: `loadRaw(start, end)` walks the
 * PalmDOC records from the front (or the back) into a growing `#rawHead` /
 * `#rawTail` accumulator and slices the requested window out of it. That walk
 * `await`s a record read on every iteration while mutating shared state, so
 * two overlapping `loadRaw` calls — which the paginator produces whenever it
 * preloads an adjacent section while another load is in flight — append their
 * records to the accumulator in *completion* order rather than index order.
 *
 * On web that never bit: the book is an in-memory `File`, so `slice().
 * arrayBuffer()` settles in issue order. On desktop/Android the file is a
 * `RemoteFile` whose reads are real ranged fetches that finish out of order,
 * so records land shuffled, every later byte offset is wrong, and sections
 * render bytes from elsewhere in the book (U+FFFD at the seams, truncated
 * markup, TOC fragments that resolve to nothing).
 *
 * The fixture is a 12-chapter Chinese AZW3 (calibre-generated) whose text
 * spans ~27 PalmDOC records, so section content straddles record boundaries.
 */

const FIXTURE = resolve(__dirname, '../fixtures/data/repro-5918.azw3');

/**
 * A `File` whose slices settle after a jittered delay — the ordering behaviour
 * of a ranged fetch, which is what backs a book on desktop and Android.
 */
class JitteredFile extends File {
  #buf: Buffer;
  #seed = 42;

  constructor(buf: Buffer, name: string) {
    super([], name);
    this.#buf = buf;
  }

  override get size() {
    return this.#buf.length;
  }

  #nextDelay() {
    this.#seed = (this.#seed * 1103515245 + 12345) & 0x7fffffff;
    return Math.floor((this.#seed / 0x7fffffff) * 8);
  }

  override slice(start = 0, end = this.size): Blob {
    const bytes = this.#buf.subarray(start, end);
    const delay = this.#nextDelay();
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return {
      arrayBuffer: () => new Promise<ArrayBuffer>((r) => setTimeout(() => r(buffer), delay)),
    } as unknown as Blob;
  }
}

interface KF8Section {
  createDocument?: () => Promise<Document>;
}
interface KF8Book {
  sections: KF8Section[];
}

const openBook = async (file: File): Promise<KF8Book> => {
  const { MOBI } = (await import('foliate-js/mobi.js')) as {
    MOBI: new (opts: { unzlib: null }) => { open: (f: File) => Promise<KF8Book> };
  };
  return new MOBI({ unzlib: null }).open(file);
};

const readSection = async (section: KF8Section) =>
  section.createDocument
    ? ((await section.createDocument()).documentElement.textContent ?? '')
    : '';

describe('KF8 loadRaw with overlapping section loads', () => {
  it('reads the same section text whether loads are serial or overlapping', async () => {
    const buf = readFileSync(FIXTURE);

    const serialBook = await openBook(new File([buf], 'repro-5918.azw3'));
    const expected: string[] = [];
    for (const section of serialBook.sections) {
      expected.push(await readSection(section));
    }
    // Sanity: the fixture really is a multi-section KF8 book with text in it.
    expect(expected.filter((t) => t.length > 500).length).toBeGreaterThan(5);

    const racedBook = await openBook(new JitteredFile(buf, 'repro-5918.azw3'));
    // The paginator preloads the adjacent section while the current one is
    // still loading, so section loads overlap in pairs.
    const actual: string[] = [];
    for (let i = 0; i < racedBook.sections.length; i += 2) {
      const pair = racedBook.sections.slice(i, i + 2);
      actual.push(...(await Promise.all(pair.map(readSection))));
    }

    const mismatched = expected
      .map((text, i) => (text === actual[i] ? -1 : i))
      .filter((i) => i >= 0);
    expect(mismatched).toEqual([]);
  }, 60000);
});
