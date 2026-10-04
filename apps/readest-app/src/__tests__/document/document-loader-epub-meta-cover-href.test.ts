import { describe, expect, it } from 'vitest';

import { DocumentLoader } from '@/libs/document';

const imageBytes = (tag: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, tag]);

/**
 * Some EPUB2 producers (FB2 converters among them) write the cover image's
 * href into `<meta name="cover" content>` instead of its manifest id, and
 * point the guide's `cover` reference at the XHTML cover page.
 */
const createMetaCoverHrefEpub = async () => {
  const { ZipWriter, BlobWriter, TextReader, Uint8ArrayReader } = await import('@zip.js/zip.js');
  const writer = new ZipWriter(new BlobWriter('application/epub+zip'));

  await writer.add('mimetype', new TextReader('application/epub+zip'), { level: 0 });
  await writer.add(
    'META-INF/container.xml',
    new TextReader(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/Content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`),
  );
  await writer.add(
    'OEBPS/Content.opf',
    new TextReader(`<?xml version="1.0" encoding="UTF-8"?>
<package version="2.0" unique-identifier="BookID" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookID">meta-cover-href</dc:identifier>
    <dc:title>test</dc:title>
    <dc:language>en</dc:language>
    <meta name="cover" content="images/pic_1.jpg" />
  </metadata>
  <manifest>
    <item id="pic_1.jpg" href="images/pic_1.jpg" media-type="image/jpeg" />
    <item id="pic_2.jpg" href="images/pic_2.jpg" media-type="image/jpeg" />
    <item id="pic_3.jpg" href="images/pic_3.jpg" media-type="image/jpeg" />
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml" />
  </manifest>
  <spine>
    <itemref idref="cover" />
  </spine>
  <guide>
    <reference type="cover" title="cover" href="cover.xhtml" />
  </guide>
</package>`),
  );
  await writer.add(
    'OEBPS/cover.xhtml',
    new TextReader(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Cover</title></head>
  <body><img alt="Cover" src="images/pic_1.jpg" /></body>
</html>`),
  );
  for (const n of [1, 2, 3]) {
    await writer.add(`OEBPS/images/pic_${n}.jpg`, new Uint8ArrayReader(imageBytes(n)));
  }

  const blob = await writer.close();
  return new File([await blob.arrayBuffer()], 'meta-cover-href.epub', {
    type: 'application/epub+zip',
  });
};

describe('EPUB2 <meta name="cover"> holding an href', () => {
  it('resolves the cover image by href when no manifest id matches', async () => {
    const { book } = await new DocumentLoader(await createMetaCoverHrefEpub()).open();
    const cover = await book.getCover();

    expect(cover).not.toBeNull();
    expect(cover!.type).toBe('image/jpeg');
    expect(new Uint8Array(await cover!.arrayBuffer())).toEqual(imageBytes(1));
  });
});
