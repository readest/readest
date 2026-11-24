// Media types are case-insensitive and may carry parameters, but the loader
// compared the manifest's `media-type` attribute verbatim. A section declared
// as `Application/XHTML+xml; charset=utf-8` skipped the XHTML path, reached the
// reader's transform hook as an unrecognized type, and was never sanitized.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EPUB } from 'foliate-js/epub.js';

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookID" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Media Type Case Test</dc:title>
    <dc:language>en</dc:language>
    <dc:identifier id="BookID">urn:uuid:media-type-case</dc:identifier>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter1" href="chapter1.xhtml" media-type="Application/XHTML+xml; charset=utf-8"/>
    <item id="script" href="app.js" media-type="Text/JavaScript"/>
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
  </spine>
</package>`;

const NAV = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body><nav epub:type="toc"><ol><li><a href="chapter1.xhtml">One</a></li></ol></nav></body>
</html>`;

const CHAPTER = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><script src="app.js"></script></head>
  <body><p>Chapter</p></body>
</html>`;

const FILES: Record<string, string> = {
  'META-INF/container.xml': CONTAINER,
  'OPS/book.opf': OPF,
  'OPS/nav.xhtml': NAV,
  'OPS/chapter1.xhtml': CHAPTER,
  'OPS/app.js': 'void 0',
};

type Section = { load: () => Promise<string> };

const openEpub = async (files: Record<string, string>) => {
  const epub = new EPUB({
    entries: Object.keys(files).map((filename) => ({ filename })),
    loadText: async (name: string) => files[name] ?? null,
    loadBlob: async (name: string) => (files[name] == null ? null : new Blob([files[name]!])),
    getSize: (name: string) => files[name]?.length ?? 0,
    sha1: undefined,
  });
  await epub.init();
  return {
    sections: (epub.sections ?? []) as Section[],
    transformTarget: epub.transformTarget as EventTarget,
  };
};

// jsdom implements neither half of the object-URL API.
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

beforeEach(() => {
  let nextId = 0;
  URL.createObjectURL = () => `blob:test/${nextId++}`;
  URL.revokeObjectURL = () => {};
});

afterEach(() => {
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});

describe('EPUB manifest media types', () => {
  it('treats a mixed-case media type with parameters as XHTML', async () => {
    const { sections, transformTarget } = await openEpub(FILES);
    const seen: { name: string; type: string; data: unknown }[] = [];
    transformTarget.addEventListener('data', (e) => {
      const { detail } = e as CustomEvent;
      seen.push({ name: detail.name, type: detail.type, data: detail.data });
    });

    await sections[0]!.load();

    const chapter = seen.find((d) => d.name === 'OPS/chapter1.xhtml')!;
    expect(chapter.type).toBe('application/xhtml+xml');
    // the XHTML path serializes the parsed document; an unrecognized type
    // would hand the raw Blob straight through
    expect(typeof (await chapter.data)).toBe('string');
  });

  it('recognizes a mixed-case script media type as a script', async () => {
    const { sections, transformTarget } = await openEpub(FILES);
    const scripts: string[] = [];
    transformTarget.addEventListener('load', (e) => {
      const { detail } = e as CustomEvent;
      if (detail.isScript) scripts.push(detail.href);
    });

    await sections[0]!.load();

    expect(scripts).toEqual(['OPS/app.js']);
  });
});
