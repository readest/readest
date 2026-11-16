/**
 * A book opened before restores its parsed container, package and navigation documents from a
 * snapshot instead of reading and parsing them again.
 *
 * On an e-ink reader the XML parses and their processing took ~0.4 s of every re-open. A snapshot
 * taken by the first open must give the same book: metadata, sections, table of contents, and the
 * same answers when a saved position (CFI) or a link is resolved.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { BlobReader, BlobWriter, TextWriter, ZipReader, type FileEntry } from '@zip.js/zip.js';

import { EPUB } from 'foliate-js/epub.js';
import { DocumentLoader } from '@/libs/document';

type Section = {
  id: string;
  cfi: string;
  linear?: string;
  size: number;
  pageSpread?: string;
  spineProperties?: string[];
  mediaOverlay?: unknown;
  loadText: () => Promise<string | null>;
};
type Book = {
  sections: Section[];
  toc?: { href: string; subitems?: unknown[] }[];
  pageList?: unknown;
  landmarks?: unknown;
  metadata: unknown;
  rendition: unknown;
  media: unknown;
  dir?: string;
  snapshot?: string;
  resolveCFI: (cfi: string) => { index: number };
  resolveHref: (href: string) => { index: number } | null;
  getCover: () => Promise<Blob | null>;
};

const fixture = (name: string) => resolve(__dirname, 'fixtures/data', name);

// A zip loader like DocumentLoader's, recording which entries were read as text.
const openZip = async (name: string) => {
  const entries = await new ZipReader(
    new BlobReader(new Blob([readFileSync(fixture(name))])),
  ).getEntries();
  const byName = new Map(entries.map((entry) => [entry.filename, entry]));
  const reads: string[] = [];
  const data = (name: string) => byName.get(name) as FileEntry | undefined;
  return {
    reads,
    loader: {
      entries,
      loadText: (name: string) => {
        reads.push(name);
        return data(name)?.getData(new TextWriter()) ?? null;
      },
      loadBlob: (name: string, type?: string) => data(name)?.getData(new BlobWriter(type)) ?? null,
      getSize: (name: string) => byName.get(name)?.uncompressedSize ?? 0,
      sha1: undefined,
    },
  };
};

const open = async (name: string, options?: { snapshot?: string; takeSnapshot?: boolean }) => {
  const { loader, reads } = await openZip(name);
  const book = (await new EPUB(loader).init(options)) as unknown as Book;
  return { book, reads };
};

const sectionFields = (book: Book) =>
  book.sections.map(({ id, cfi, linear, size, pageSpread, spineProperties, mediaOverlay }) => ({
    id,
    cfi,
    linear,
    size,
    pageSpread,
    spineProperties,
    mediaOverlay,
  }));

const tocHrefs = (items: Book['toc']): string[] =>
  (items ?? []).flatMap((item) => [item.href, ...tocHrefs(item.subitems as Book['toc'])]);

describe.each([
  'sample-alice.epub',
  'repro-3683.epub',
  'sample-vertical-rl.epub',
])('a snapshot of %s', (name) => {
  it('restores the same book without reading the container, package or navigation', async () => {
    const { book: parsed, reads: parseReads } = await open(name, { takeSnapshot: true });
    expect(typeof parsed.snapshot).toBe('string');
    const { book: restored, reads } = await open(name, { snapshot: parsed.snapshot });

    // what the parse read, the restore didn't: META-INF/container.xml, the OPF, the nav/NCX
    expect(parseReads.length).toBeGreaterThan(1);
    expect(reads).toEqual([]);

    expect(restored.metadata).toEqual(parsed.metadata);
    expect(restored.rendition).toEqual(parsed.rendition);
    expect(restored.media).toEqual(parsed.media);
    expect(restored.dir).toEqual(parsed.dir);
    expect(restored.toc).toEqual(parsed.toc);
    expect(restored.pageList).toEqual(parsed.pageList);
    expect(restored.landmarks).toEqual(parsed.landmarks);
    expect(sectionFields(restored)).toEqual(sectionFields(parsed));

    // a saved position and a link land on the same section
    for (const [i, section] of parsed.sections.entries()) {
      const cfi = section.cfi.replace(/\)$/, '!/4/2/1:0)');
      expect(restored.resolveCFI(cfi).index).toBe(i);
      expect(parsed.resolveCFI(cfi).index).toBe(i);
    }
    for (const href of tocHrefs(parsed.toc)) {
      expect(restored.resolveHref(href)?.index).toBe(parsed.resolveHref(href)?.index);
    }

    // and the sections and the cover still load
    const last = parsed.sections.length - 1;
    expect(await restored.sections[last]!.loadText()).toBe(await parsed.sections[last]!.loadText());
    expect((await restored.getCover())?.size).toBe((await parsed.getCover())?.size);
  });
});

describe('an unusable snapshot', () => {
  it('is parsed again', async () => {
    const { book: parsed } = await open('sample-alice.epub');
    for (const snapshot of ['{"version":0}', 'not json']) {
      const { book, reads } = await open('sample-alice.epub', { snapshot });
      expect(reads).toContain('META-INF/container.xml');
      expect(book.metadata).toEqual(parsed.metadata);
    }
  });

  it('is not taken unless asked for', async () => {
    const { book } = await open('sample-alice.epub');
    expect(book.snapshot).toBeUndefined();
  });
});

describe('DocumentLoader', () => {
  const file = () => new File([readFileSync(fixture('sample-alice.epub'))], 'sample-alice.epub');

  it('hands back a snapshot of a parsed EPUB, and restores from one', async () => {
    const first = await new DocumentLoader(file()).open();
    expect(typeof first.epubSnapshot).toBe('string');

    const again = await new DocumentLoader(file(), { epubSnapshot: first.epubSnapshot }).open();
    expect(again.epubSnapshot).toBeUndefined();
    expect(again.book.metadata).toEqual(first.book.metadata);
    expect(again.book.toc).toEqual(first.book.toc);
    expect(again.book.sections.map((s) => s.id)).toEqual(first.book.sections.map((s) => s.id));
  });
});
