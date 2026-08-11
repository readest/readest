// Regression test for #5625: a chapter declared `application/xhtml+xml` in the
// manifest whose markup is not well-formed XML (Adobe InDesign / Digital
// Editions ship an unclosed `<meta charset="utf-8">` constantly) yields a
// `parsererror` document with a NULL `document.body`.
//
// `loadItem`/`loadReplaced` — the render path — already retries such a file as
// `text/html`. `loadDocument`, which backs `Section.createDocument()`, did not,
// so every off-screen consumer got the error document instead of the chapter:
// XPointer->CFI conversion (`src/utils/xcfi.ts`) reads `document.body.children`
// and threw `TypeError: Cannot read properties of null (reading 'children')`,
// which is what broke KOReader progress sync in the report.
import { describe, expect, it } from 'vitest';

import { EPUB } from 'foliate-js/epub.js';
import type { BookDoc } from '@/libs/document';
import { getCFIFromXPointer } from '@/utils/xcfi';

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const opf = (items: { id: string; href: string }[]) => `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookID" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Malformed XHTML</dc:title>
    <dc:language>en</dc:language>
    <dc:identifier id="BookID">urn:uuid:12345</dc:identifier>
  </metadata>
  <manifest>
    ${items.map(({ id, href }) => `<item id="${id}" href="${href}" media-type="application/xhtml+xml"/>`).join('\n    ')}
  </manifest>
  <spine>
    ${items.map(({ id }) => `<itemref idref="${id}"/>`).join('\n    ')}
  </spine>
</package>`;

const wellFormed = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"/></head>
<body><p>Chapter 1</p></body></html>`;

// Verbatim shape of the reported book: no XML declaration, and a void `<meta>`
// left unclosed inside `<head>`, which makes the XML parser bail at `</head>`.
const malformed = `<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en-GB">
	<head>
	<meta charset="utf-8">
	<title>Chapter 2</title>
	</head>
	<body>
	<p>First</p>
	<p>Second</p>
	</body>
</html>`;

type Section = { createDocument: () => Promise<Document> };

const openEpub = async (files: Record<string, string>) => {
  const epub = new EPUB({
    entries: Object.keys(files).map((filename) => ({ filename })),
    loadText: async (name: string) => files[name] ?? null,
    loadBlob: async (name: string) =>
      files[name] == null ? null : new Blob([files[name]!], { type: 'application/xhtml+xml' }),
    getSize: (name: string) => files[name]?.length ?? 0,
    sha1: undefined,
  });
  await epub.init();
  return (epub.sections ?? []) as Section[];
};

const openFixture = () =>
  openEpub({
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': opf([
      { id: 'ch1', href: 'ch1.html' },
      { id: 'ch2', href: 'ch2.html' },
    ]),
    'OEBPS/ch1.html': wellFormed,
    'OEBPS/ch2.html': malformed,
  });

describe('createDocument on a section that is not well-formed XML (#5625)', () => {
  it('retries as HTML so the chapter body is reachable', async () => {
    const sections = await openFixture();
    const doc = await sections[1]!.createDocument();

    // The XML parse produces `<parsererror>` and a null body; the HTML retry
    // must give back the real chapter instead.
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.body).not.toBeNull();
    expect(Array.from(doc.body.querySelectorAll('p')).map((p) => p.textContent)).toEqual([
      'First',
      'Second',
    ]);
  });

  it('still parses a well-formed section as XHTML', async () => {
    const sections = await openFixture();
    const doc = await sections[0]!.createDocument();

    expect(doc.documentElement.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
    expect(doc.body.querySelector('p')?.textContent).toBe('Chapter 1');
  });

  // The whole chain the KOReader plugin depends on: a CREngine XPointer naming
  // a section OTHER than the rendered one, so `getCFIFromXPointer` has to build
  // its converter from `createDocument()`. This is the exact call that raised
  // "TypeError: Cannot read properties of null (reading 'children')".
  it('converts a KOReader XPointer that lands in that section', async () => {
    const sections = await openFixture();
    const bookDoc = { sections } as unknown as BookDoc;

    // DocFragment[2] is CREngine's 1-based number for spine index 1.
    const cfi = await getCFIFromXPointer(
      '/body/DocFragment[2]/body/p[2]/text().3',
      undefined,
      undefined,
      bookDoc,
    );

    expect(cfi).toMatch(/^epubcfi\(/);
  });
});
