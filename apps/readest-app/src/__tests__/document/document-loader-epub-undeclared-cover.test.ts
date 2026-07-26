import { describe, expect, it } from 'vitest';

import { DocumentLoader } from '@/libs/document';

// Minimal JPEG SOI marker + filler. Nothing decodes these bytes on the JS
// side, we only assert that they made it out of the zip untouched.
const COVER_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03, 0x04]);

/**
 * Build an EPUB whose manifest declares nothing but the single spine
 * document -- no `properties="cover-image"` item, no
 * `<meta name="cover">` target, no image item at all -- while the zip
 * still carries `imageEntry`. Calibre produces exactly this shape when a
 * cover image is added to the container but the manifest entry is lost
 * (issue #5273).
 */
const createUndeclaredCoverEpub = async (imageEntry: string | null) => {
  const { ZipWriter, BlobWriter, TextReader, Uint8ArrayReader } = await import('@zip.js/zip.js');
  const writer = new ZipWriter(new BlobWriter('application/epub+zip'));

  await writer.add('mimetype', new TextReader('application/epub+zip'), { level: 0 });
  await writer.add(
    'META-INF/container.xml',
    new TextReader(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="metadata.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`),
  );
  await writer.add(
    'metadata.opf',
    new TextReader(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uuid_id" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="uuid_id">undeclared-cover</dc:identifier>
    <dc:title>test</dc:title>
    <dc:language>eng</dc:language>
    <meta name="cover" content="cover"/>
  </metadata>
  <manifest>
    <item href="start.xhtml" id="start" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="start"/>
  </spine>
</package>`),
  );
  await writer.add(
    'start.xhtml',
    new TextReader(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>test</title></head>
  <body><p>Hello.</p></body>
</html>`),
  );
  if (imageEntry) {
    await writer.add(imageEntry, new Uint8ArrayReader(COVER_BYTES));
  }

  const blob = await writer.close();
  const arrayBuffer = await blob.arrayBuffer();
  return new File([arrayBuffer], 'undeclared-cover.epub', { type: 'application/epub+zip' });
};

const openCover = async (imageEntry: string | null) => {
  const file = await createUndeclaredCoverEpub(imageEntry);
  const { book } = await new DocumentLoader(file).open();
  return book.getCover();
};

describe('EPUB cover fallback for undeclared zip entries', () => {
  it('falls back to a cover-named zip entry missing from the manifest', async () => {
    const cover = await openCover('cover.jpg');

    expect(cover).not.toBeNull();
    expect(cover!.type).toBe('image/jpeg');
    expect(new Uint8Array(await cover!.arrayBuffer())).toEqual(COVER_BYTES);
  });

  it('matches cover-named entries in nested directories and other formats', async () => {
    const cover = await openCover('OEBPS/images/Cover.PNG');

    expect(cover).not.toBeNull();
    expect(cover!.type).toBe('image/png');
  });

  it('matches the French "couv" spelling', async () => {
    const cover = await openCover('couv.jpeg');

    expect(cover).not.toBeNull();
    expect(cover!.type).toBe('image/jpeg');
  });

  it('does not invent a cover from unrelated images', async () => {
    expect(await openCover('images/rat.jpg')).toBeNull();
  });

  it('returns null when the container has no image at all', async () => {
    expect(await openCover(null)).toBeNull();
  });
});
