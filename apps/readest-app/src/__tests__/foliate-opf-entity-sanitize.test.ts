// Regression test for an import failure on EPUBs whose OPF contains a raw,
// unescaped ampersand.
//
// "Shadow Slave - Vol. 6 - All The Devils Are Here.epub" ships an OPF with a
// hand-built manifest id that was never XML-escaped:
//
//   <item id="Chapter_1213_Search_&_Rescue_153" .../>
//
// The bare `&` makes the OPF non-well-formed XML. A strict parser (DOMParser in
// Chrome/jsdom, and the same parser foliate-js uses on every platform) reads the
// `&`, then the name `_Rescue_153`, then hits `"` where it expected `;` and
// reports `EntityRef: expecting ';'`. Import then dies with
// "Failed to open the book file: XML parsing error: ...".
//
// foliate-js already mapped a handful of named HTML entities (`&nbsp;` …) to
// numeric refs, but it never escaped stray ampersands that aren't part of any
// entity reference. This test pins the fix: such an OPF must still parse and
// yield its metadata.
import { describe, expect, it } from 'vitest';

import { parseEpubMetadataFromXML } from 'foliate-js/epub.js';

const NBSP = String.fromCharCode(160);

const opf = (title: string, manifest: string) => `<?xml version='1.0' encoding='utf-8'?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" unique-identifier="BookId" version="3.0">
  <metadata>
    <dc:title>${title}</dc:title>
    <dc:creator>Guiltythree</dc:creator>
    <dc:identifier id="BookId">1</dc:identifier>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    ${manifest}
  </manifest>
  <spine>
    <itemref idref="cover"/>
  </spine>
</package>`;

const COVER = `<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`;

describe('OPF XML entity sanitization', () => {
  it('imports an OPF with a raw & in a manifest item id (the reported bug)', () => {
    const title = 'Shadow Slave - Vol. 6 - All The Devils Are Here';
    const xml = opf(
      title,
      `${COVER}
       <item id="Chapter_1213_Search_&_Rescue_153" href="content/c1.xhtml" media-type="application/xhtml+xml"/>`,
    );
    const { metadata } = parseEpubMetadataFromXML(xml);
    expect(metadata.title).toBe(title);
  });

  it('escapes a bare & in element text content', () => {
    const xml = opf('Search & Rescue & More', COVER);
    const { metadata } = parseEpubMetadataFromXML(xml);
    expect(metadata.title).toBe('Search & Rescue & More');
  });

  it('preserves valid entities and numeric/named references (no double-escaping)', () => {
    // &amp; -> "&", &#160; -> U+00A0, &nbsp; -> U+00A0 (mapped from HTML).
    const xml = opf('R&amp;D&#160;Press&nbsp;Ltd', COVER);
    const { metadata } = parseEpubMetadataFromXML(xml);
    expect(metadata.title).toBe(`R&D${NBSP}Press${NBSP}Ltd`);
  });
});
