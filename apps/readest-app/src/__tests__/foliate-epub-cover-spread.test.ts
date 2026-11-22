// A reflowable book's cover page gets `pageSpread: 'center'`, so a two-page
// spread shows it alone and centred (#6676), unless its spine item places it.
// The cover page is the first linear section when the landmarks or guide name
// it as the cover, or its file is named for one.
import { describe, expect, it } from 'vitest';

import { EPUB } from 'foliate-js/epub.js';

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

type Item = { id: string; href: string; properties?: string };

const opf = (
  items: Item[],
  { guide = '', layout = '' } = {},
) => `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookID" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Cover Spread</dc:title>
    <dc:language>en</dc:language>
    <dc:identifier id="BookID">urn:uuid:6676</dc:identifier>
    ${layout ? `<meta property="rendition:layout">${layout}</meta>` : ''}
  </metadata>
  <manifest>
    ${items.map(({ id, href }) => `<item id="${id}" href="${href}" media-type="application/xhtml+xml"/>`).join('\n    ')}
  </manifest>
  <spine>
    ${items.map(({ id, properties }) => `<itemref idref="${id}"${properties ? ` properties="${properties}"` : ''}/>`).join('\n    ')}
  </spine>
  ${guide ? `<guide>${guide}</guide>` : ''}
</package>`;

const page = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>x</p></body></html>`;

const spreads = async (items: Item[], options?: { guide?: string; layout?: string }) => {
  const files: Record<string, string> = {
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': opf(items, options),
  };
  for (const { href } of items) files[`OEBPS/${href}`] = page;
  const epub = new EPUB({
    entries: Object.keys(files).map((filename) => ({ filename })),
    loadText: async (name: string) => files[name] ?? null,
    loadBlob: async (name: string) =>
      files[name] == null ? null : new Blob([files[name]!], { type: 'application/xhtml+xml' }),
    getSize: (name: string) => files[name]?.length ?? 0,
    sha1: undefined,
  });
  await epub.init();
  return (epub.sections as { pageSpread?: string }[]).map((s) => s.pageSpread);
};

const chapter = { id: 'c1', href: 'chapter1.xhtml' };

describe('cover page spread (#6676)', () => {
  it('centres the cover page the guide names', async () => {
    const titlepage = { id: 'tp', href: 'titlepage.xhtml' };
    const guide = '<reference type="cover" title="Cover" href="titlepage.xhtml"/>';
    expect(await spreads([titlepage, chapter], { guide })).toEqual(['center', undefined]);
  });

  it('centres a first page whose file is named for the cover', async () => {
    expect(await spreads([{ id: 'cv', href: 'Text/Cover.xhtml' }, chapter])).toEqual([
      'center',
      undefined,
    ]);
  });

  it('leaves a first page that is no cover alone', async () => {
    expect(await spreads([{ id: 'tp', href: 'titlepage.xhtml' }, chapter])).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("keeps the cover's own spine spread property", async () => {
    const cover = { id: 'cv', href: 'cover.xhtml', properties: 'page-spread-right' };
    expect(await spreads([cover, chapter])).toEqual(['right', undefined]);
  });

  it('leaves a fixed-layout cover to the fixed-layout renderer', async () => {
    const cover = { id: 'cv', href: 'cover.xhtml' };
    expect(await spreads([cover, chapter], { layout: 'pre-paginated' })).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('reads page-spread-center with and without the rendition prefix', async () => {
    expect(
      await spreads([
        { id: 'a', href: 'a.xhtml', properties: 'page-spread-center' },
        { id: 'b', href: 'b.xhtml', properties: 'rendition:page-spread-center' },
      ]),
    ).toEqual(['center', 'center']);
  });
});
