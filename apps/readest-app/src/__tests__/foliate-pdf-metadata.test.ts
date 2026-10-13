import { describe, expect, it, vi } from 'vitest';
import { decodePDFString, parsePDFMetadata } from 'foliate-js/pdf.js';

const { loadPdfJsRuntime } = vi.hoisted(() => ({ loadPdfJsRuntime: vi.fn() }));

vi.mock('@pdfjs/pdf.min.mjs', () => {
  loadPdfJsRuntime();
  (globalThis as Record<string, unknown>)['pdfjsLib'] = { GlobalWorkerOptions: {} };
  return {};
});

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

const XMP = `<?xpacket begin=""?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">XMP Title</rdf:li></rdf:Alt></dc:title>
      <dc:creator><rdf:Seq><rdf:li>Alice</rdf:li><rdf:li>Bob</rdf:li></rdf:Seq></dc:creator>
      <dc:contributor><rdf:Bag><rdf:li>Editor One</rdf:li><rdf:li>Editor Two</rdf:li></rdf:Bag></dc:contributor>
      <dc:description><rdf:Alt><rdf:li xml:lang="x-default">Description</rdf:li></rdf:Alt></dc:description>
      <dc:language><rdf:Bag><rdf:li>en</rdf:li><rdf:li>fr</rdf:li></rdf:Bag></dc:language>
      <dc:publisher><rdf:Bag><rdf:li>Readest</rdf:li></rdf:Bag></dc:publisher>
      <dc:subject><rdf:Bag><rdf:li>Fiction</rdf:li><rdf:li>Adventure</rdf:li></rdf:Bag></dc:subject>
      <dc:identifier>urn:isbn:123</dc:identifier>
      <dc:source>Original edition</dc:source>
      <dc:rights>Public domain</dc:rights>
    </rdf:Description>
    <rdf:Description
      xmlns:calibre="http://calibre-ebook.com/xmp-namespace"
      xmlns:calibreSI="http://calibre-ebook.com/xmp-namespace-series-index">
      <calibre:series rdf:parseType="Resource">
        <rdf:value>Metadata Series</rdf:value>
        <calibreSI:series_index>2.00</calibreSI:series_index>
      </calibre:series>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>`;

describe('PDF metadata normalization', () => {
  it('does not load the PDF.js runtime for metadata-only imports', () => {
    expect(loadPdfJsRuntime).not.toHaveBeenCalled();
  });

  it('decodes every PDF string encoding handled by pdf.js', () => {
    expect(decodePDFString(bytes('Plain ASCII'))).toBe('Plain ASCII');
    expect(decodePDFString(Uint8Array.from([0xef, 0xbb, 0xbf, 0xe4, 0xbd, 0xa0]))).toBe('你');
    expect(decodePDFString(Uint8Array.from([0xfe, 0xff, 0x4f, 0x60, 0x59, 0x7d]))).toBe('你好');
    expect(decodePDFString(Uint8Array.from([0xff, 0xfe, 0x60, 0x4f, 0x7d, 0x59]))).toBe('你好');
    expect(decodePDFString(Uint8Array.from([0x80]))).toBe('•');
  });

  it('maps raw XMP with the same value shapes as the full PDF reader', () => {
    expect(
      parsePDFMetadata({
        info: {
          title: bytes('Info Title'),
          author: bytes('Info Author'),
          subject: bytes('Info Subject'),
        },
        xmp: bytes(XMP),
      }),
    ).toEqual({
      title: 'XMP Title',
      author: ['Alice', 'Bob'],
      contributor: 'Editor OneEditor Two',
      description: 'Description',
      language: 'enfr',
      publisher: 'Readest',
      subject: ['Fiction', 'Adventure'],
      identifier: 'urn:isbn:123',
      source: 'Original edition',
      rights: 'Public domain',
      belongsTo: { series: { name: 'Metadata Series', position: '2.00' } },
    });
  });

  it('falls back to raw Info bytes when XMP is missing or malformed', () => {
    const info = {
      title: Uint8Array.from([0xfe, 0xff, 0x4f, 0x60, 0x59, 0x7d]),
      author: bytes('Info Author'),
      subject: bytes('Info Subject'),
    };

    expect(parsePDFMetadata({ info })).toMatchObject({
      title: '你好',
      author: 'Info Author',
      description: 'Info Subject',
    });
    expect(parsePDFMetadata({ info, xmp: bytes('<not-valid') })).toMatchObject({
      title: '你好',
      author: 'Info Author',
      description: 'Info Subject',
    });
  });
});
