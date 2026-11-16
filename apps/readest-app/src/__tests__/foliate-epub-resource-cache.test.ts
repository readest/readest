/**
 * A section or stylesheet prepared on one open is kept and restored on the next open, instead of
 * being unzipped, parsed, rewritten and transformed again.
 *
 * On an e-ink reader, preparing the first section took ~0.45 s of every re-open. What is kept is
 * the loader's output after every `data` listener ran, with the session's object URLs of the
 * resources it links to replaced by placeholders. A restore loads those resources again, so the
 * restored document links this session's copies and releases them with the section.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EPUB } from 'foliate-js/epub.js';

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookID" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Cached</dc:title>
    <dc:identifier id="BookID">urn:uuid:1</dc:identifier>
  </metadata>
  <manifest>
    <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="pic" href="pic.png" media-type="image/png"/>
    <item id="bg" href="bg.png" media-type="image/png"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`;

const C1 = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><link rel="stylesheet" href="style.css"/></head>
  <body>
    <p style="background: url(bg.png)">One</p>
    <img src="pic.png" alt=""/>
    <a href="https://example.com/">out</a>
  </body>
</html>`;

// not well-formed XHTML: parsed again as HTML, which changes the item's media type
const C2 = `<html><body><p>Two<br></p><img src="pic.png"></body></html>`;

const FILES: Record<string, string> = {
  'META-INF/container.xml': CONTAINER,
  'OEBPS/content.opf': OPF,
  'OEBPS/c1.xhtml': C1,
  'OEBPS/c2.xhtml': C2,
  'OEBPS/style.css': 'p { background: url("bg.png") }',
  'OEBPS/pic.png': 'PIC',
  'OEBPS/bg.png': 'BG',
};

type Entry = { data: string; children: string[] } & Record<string, unknown>;
type Cache = Map<string, Entry>;
type Book = {
  sections: { load: () => Promise<string>; unload: () => void }[];
  resources: { manifest: { href: string; mediaType: string }[] };
  transformTarget: EventTarget;
  setResourceCache: (cache: unknown) => void;
};

let blobs: Map<string, Blob>;
let nextId: number;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

beforeEach(() => {
  blobs = new Map();
  nextId = 0;
  URL.createObjectURL = (blob: Blob) => {
    const url = `blob:test/${nextId++}`;
    blobs.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = (url: string) => void blobs.delete(url);
});

afterEach(() => {
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});

// A document with every object URL replaced by what it points to, so two opens compare equal
// whatever URLs their sessions handed out.
const expand = async (url: string): Promise<string> => {
  const text = await blobs.get(url)!.text();
  let out = text;
  for (const inner of new Set(text.match(/blob:test\/\d+/g) ?? [])) {
    out = out.replaceAll(inner, `{${await expand(inner)}}`);
  }
  return out;
};

const open = async (cache: Cache | null, transform = (data: string) => `${data}<!--t-->`) => {
  const reads: string[] = [];
  const transformed: string[] = [];
  const book = (await new EPUB({
    entries: Object.keys(FILES).map((filename) => ({ filename })),
    loadText: async (name: string) => {
      reads.push(name);
      return FILES[name] ?? null;
    },
    loadBlob: async (name: string) => (FILES[name] == null ? null : new Blob([FILES[name]!])),
    getSize: (name: string) => FILES[name]?.length ?? 0,
    sha1: undefined,
  }).init()) as unknown as Book;
  book.transformTarget.addEventListener('data', (event) => {
    const { detail } = event as CustomEvent;
    if (detail.type === 'image/png') return;
    transformed.push(detail.name);
    detail.data = Promise.resolve(detail.data).then(transform);
  });
  if (cache) {
    book.setResourceCache({
      get: async (href: string) => cache.get(href) ?? null,
      put: vi.fn((href: string, entry: Entry) => void cache.set(href, entry)),
    });
  }
  reads.length = 0;
  return { book, reads, transformed };
};

describe('a resource cache on the EPUB loader', () => {
  it('restores a prepared section and its stylesheet without reading or transforming them', async () => {
    const cache: Cache = new Map();
    const first = await open(cache);
    const firstUrl = await first.book.sections[0]!.load();
    const firstDoc = await expand(firstUrl);
    expect(first.transformed).toEqual(
      expect.arrayContaining(['OEBPS/c1.xhtml', 'OEBPS/style.css']),
    );
    // what is kept names no object URL of the session that made it
    expect([...cache.keys()].sort()).toEqual(['OEBPS/c1.xhtml', 'OEBPS/style.css']);
    for (const entry of cache.values()) expect(entry.data).not.toMatch(/blob:/);
    first.book.sections[0]!.unload();

    const again = await open(cache);
    const url = await again.book.sections[0]!.load();
    expect(again.reads).toEqual([]);
    expect(again.transformed).toEqual([]);
    expect(await expand(url)).toBe(firstDoc);
    expect(firstDoc).toContain('{BG}');
    expect(firstDoc).toContain('{PIC}');
    expect(firstDoc).toContain('<!--t-->');

    // the restored section holds this session's copies of what it links to, and lets them go
    again.book.sections[0]!.unload();
    expect(blobs.size).toBe(0);
  });

  it('keeps the media type a section was parsed as', async () => {
    const cache: Cache = new Map();
    const first = await open(cache);
    const firstDoc = await expand(await first.book.sections[1]!.load());
    const type = (book: Book) =>
      book.resources.manifest.find((item) => item.href === 'OEBPS/c2.xhtml')!.mediaType;
    expect(type(first.book)).toBe('text/html');

    const again = await open(cache);
    expect(await expand(await again.book.sections[1]!.load())).toBe(firstDoc);
    expect(type(again.book)).toBe('text/html');
    expect(again.reads).toEqual([]);
  });

  it('keeps nothing a transform failed on', async () => {
    const cache: Cache = new Map();
    const { book } = await open(cache, () => '');
    await book.sections[0]!.load();
    expect(cache.size).toBe(0);
  });

  it('prepares the resource as before when the cache has no entry for it', async () => {
    const plain = await open(null);
    const plainDoc = await expand(await plain.book.sections[0]!.load());
    const cached = await open(new Map());
    expect(await expand(await cached.book.sections[0]!.load())).toBe(plainDoc);
    expect(cached.reads).toContain('OEBPS/c1.xhtml');
  });
});
