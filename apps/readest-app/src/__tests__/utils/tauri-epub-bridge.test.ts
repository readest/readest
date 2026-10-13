import { describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());
const bytes = (value: string): number[] => Array.from(new TextEncoder().encode(value));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));

import { tryNativeParseEpub } from '@/utils/tauriEpubBridge';
import { getBookDocPageCount } from '@/utils/book';

const opf = (layout = '') => `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Spine Sizes</dc:title>
    ${layout}
  </metadata>
  <manifest>
    <item id="c1" href="Text/chapter%201.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="../c2.xhtml" media-type="application/xhtml+xml"/>
    <item id="notes" href="Text/notes.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
    <itemref idref="notes" linear="no"/>
    <itemref idref="missing"/>
  </spine>
</package>`;

const parse = async (opfXml: string) => {
  invokeMock.mockResolvedValueOnce({
    partialMd5: 'native-hash',
    opfPath: 'OEBPS/content.opf',
    opfBytes: bytes(opfXml),
    sizes: {
      'OEBPS/Text/chapter 1.xhtml': 2000,
      'c2.xhtml': 1100,
      'OEBPS/Text/notes.xhtml': 9000,
      'OEBPS/images/cover.jpg': 500000,
    },
  });
  return (await tryNativeParseEpub('/books/sample.epub'))!.bookDoc;
};

describe('tryNativeParseEpub page count (#6662)', () => {
  it('counts the linear spine entries the reader will lay out', async () => {
    const bookDoc = await parse(opf());

    expect(bookDoc.sections.map((s) => s.size)).toEqual([2000, 1100, 9000]);
    expect(getBookDocPageCount(bookDoc, 'EPUB')).toBe(3);
  });

  it('reads the spine of an OPF that declares no namespace, as foliate does', async () => {
    const bookDoc = await parse(opf().replace(' xmlns="http://www.idpf.org/2007/opf"', ''));

    expect(getBookDocPageCount(bookDoc, 'EPUB')).toBe(3);
  });

  it('counts one page per spine entry for a fixed-layout EPUB', async () => {
    const bookDoc = await parse(opf('<meta property="rendition:layout">pre-paginated</meta>'));

    expect(getBookDocPageCount(bookDoc, 'EPUB')).toBe(3);
  });
});
