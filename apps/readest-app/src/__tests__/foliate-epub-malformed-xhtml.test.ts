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
import * as CFI from 'foliate-js/epubcfi.js';
import { getCFIFromXPointer, getXPointerFromCFI, XCFI } from '@/utils/xcfi';

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

type Section = { createDocument: () => Promise<Document>; load: () => Promise<string> };

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

// #5271: the HTML retry is not a faithful parse of such a file. The HTML
// parser ignores `/>` on non-void elements and re-opens formatting elements
// across blocks, so an InDesign page anchor `<a id="page_25"/>` at the top of
// a paragraph swallows every following <p> until the next anchor. Positions
// then disagree with the book's real structure and with KOReader's crengine,
// which honours `/>`. When the only fault is unclosed void tags, closing them
// and re-parsing as XML gives the intended DOM; HTML stays the last resort.
const inDesign = `<html xmlns="http://www.w3.org/1999/xhtml">
<head>
    <meta charset="utf-8">
<title>Chapter 3</title>
</head>
<body>
<p class="cn" id="ch3"><a id="page_25"/><span class="hide">        </span>3</p>
<p class="ct1">IT’S NOT YOU, IT’S US</p>
<p class="bodytext1">When someone you love has just died, why does it matter?</p>
<p class="bodytext">Your personal experience is <a id="page_26"/>affected by the wider culture.</p>
<p class="bodytextb">You aren’t crazy. The culture is crazy.<br>It’s not you.</p>
</body>
</html>`;

// Still not XML after closing void tags: a bare ampersand.
const beyondRepair = `<html xmlns="http://www.w3.org/1999/xhtml">
<head><meta charset="utf-8"><title>Notes</title></head>
<body><p>Rock & roll</p></body>
</html>`;

const openInDesignFixture = () =>
  openEpub({
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': opf([
      { id: 'ch1', href: 'ch1.html' },
      { id: 'ch3', href: 'ch3.html' },
      { id: 'notes', href: 'notes.html' },
    ]),
    'OEBPS/ch1.html': wellFormed,
    'OEBPS/ch3.html': inDesign,
    'OEBPS/notes.html': beyondRepair,
  });

const XHTML_NS = 'http://www.w3.org/1999/xhtml';

/** Text covered by a range CFI, resolved in `doc` like the reader does. */
const rangeText = (doc: Document, cfi: string) => {
  const parts = CFI.parse(cfi);
  (parts.parent ?? parts).shift(); // drop the spine step
  return CFI.toRange(doc, parts).toString();
};

const bodyTags = (doc: Document) =>
  Array.from(doc.body.children).map((el) => el.tagName.toLowerCase());

describe('a file whose only fault is unclosed void tags is repaired as XML (#5271)', () => {
  it('createDocument keeps the paragraphs under <body> and the anchors empty', async () => {
    const sections = await openInDesignFixture();
    const doc = await sections[1]!.createDocument();

    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.documentElement.namespaceURI).toBe(XHTML_NS);
    expect(bodyTags(doc)).toEqual(['p', 'p', 'p', 'p', 'p']);
    expect(doc.getElementById('page_25')!.childNodes.length).toBe(0);
    expect(doc.getElementById('page_26')!.childNodes.length).toBe(0);
    expect(doc.querySelector('br')!.namespaceURI).toBe(XHTML_NS);
  });

  it('converts positions the way crengine numbers this chapter', async () => {
    const sections = await openInDesignFixture();
    const bookDoc = { sections } as unknown as BookDoc;
    const doc = await sections[1]!.createDocument();

    // Readest -> KOReader: a highlight on the third paragraph.
    const node = doc.body.children[2]!.firstChild as Text;
    const range = doc.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 12);
    const cfi = CFI.joinIndir(CFI.fake.fromIndex(1), CFI.fromRange(range));
    const xp = await getXPointerFromCFI(cfi, undefined, undefined, bookDoc);
    expect(xp.pos0).toBe('/body/DocFragment[2]/body/p[3]/text().0');
    expect(xp.pos1).toBe('/body/DocFragment[2]/body/p[3]/text().12');

    // KOReader -> Readest: the text after the mid-paragraph anchor is the
    // paragraph's second text child in crengine's DOM.
    const back = new XCFI(doc, 1).xPointerToCFI(
      '/body/DocFragment[2]/body/p[4]/text()[2].0',
      '/body/DocFragment[2]/body/p[4]/text()[2].8',
    );
    expect(rangeText(doc, back)).toBe('affected');
  });

  it('renders the repaired XML, not the HTML re-parse', async () => {
    const originalCreate = URL.createObjectURL;
    const blobs: Blob[] = [];
    URL.createObjectURL = (blob: Blob) => {
      blobs.push(blob);
      return `blob:test/${blobs.length}`;
    };
    try {
      const sections = await openInDesignFixture();
      await sections[1]!.load();
    } finally {
      URL.createObjectURL = originalCreate;
    }
    expect(blobs).toHaveLength(1);
    const rendered = new DOMParser().parseFromString(
      await blobs[0]!.text(),
      'application/xhtml+xml',
    );
    expect(rendered.querySelector('parsererror')).toBeNull();
    expect(bodyTags(rendered)).toEqual(['p', 'p', 'p', 'p', 'p']);
  });

  it('still falls back to HTML when the file is broken beyond that repair', async () => {
    const sections = await openInDesignFixture();
    const doc = await sections[2]!.createDocument();

    expect(doc.body).not.toBeNull();
    expect(doc.body.querySelector('p')?.textContent).toBe('Rock & roll');
  });
});
