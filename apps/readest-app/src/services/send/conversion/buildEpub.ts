import { configureZip } from '@/utils/zip';
import type { EpubChapter, EpubBuildMetadata } from './types';

// Zero the zip timestamps so converting the same source twice yields
// byte-identical EPUBs — that keeps the import-time hash stable and dedups
// a book a user sends more than once.
const zipWriteOptions = {
  lastAccessDate: new Date(0),
  lastModDate: new Date(0),
};

const escapeXml = (str: string): string => {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};

const CSS = `
body { line-height: 1.6; font-size: 1em; text-align: justify; }
h1, h2, h3 { line-height: 1.3; }
p { margin: 0.6em 0; }
img { max-width: 100%; height: auto; }
`;

/**
 * Build a minimal, valid EPUB 2.0 from sanitized HTML chapters. Shares the
 * `@zip.js/zip.js` assembly pattern with `TxtToEpubConverter` — mimetype first
 * and uncompressed, `container.xml`, `content.opf`, `toc.ncx`, zeroed
 * timestamps.
 */
export async function buildEpub(
  chapters: EpubChapter[],
  metadata: EpubBuildMetadata,
): Promise<Blob> {
  if (chapters.length === 0) {
    throw new Error('buildEpub: no chapters');
  }
  await configureZip();
  const { BlobWriter, TextReader, ZipWriter } = await import('@zip.js/zip.js');
  const { title, author, language, identifier } = metadata;

  const zipWriter = new ZipWriter(new BlobWriter('application/epub+zip'), {
    extendedTimestamp: false,
  });
  await zipWriter.add('mimetype', new TextReader('application/epub+zip'), zipWriteOptions);

  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
  await zipWriter.add('META-INF/container.xml', new TextReader(containerXml), zipWriteOptions);

  const navPoints = chapters
    .map((chapter, i) => {
      const id = `chapter${i + 1}`;
      return (
        `<navPoint id="navPoint-${id}" playOrder="${i + 1}">` +
        `<navLabel><text>${escapeXml(chapter.title)}</text></navLabel>` +
        `<content src="./OEBPS/${id}.xhtml"/></navPoint>`
      );
    })
    .join('\n');

  const tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeXml(identifier)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <docAuthor><text>${escapeXml(author)}</text></docAuthor>
  <navMap>${navPoints}</navMap>
</ncx>`;
  await zipWriter.add('toc.ncx', new TextReader(tocNcx), zipWriteOptions);

  await zipWriter.add('style.css', new TextReader(CSS), zipWriteOptions);

  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i]!;
    const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="${escapeXml(language)}" xml:lang="${escapeXml(language)}">
  <head>
    <title>${escapeXml(chapter.title)}</title>
    <link rel="stylesheet" type="text/css" href="../style.css"/>
  </head>
  <body>${chapter.html}</body>
</html>`;
    await zipWriter.add(`OEBPS/chapter${i + 1}.xhtml`, new TextReader(xhtml), zipWriteOptions);
  }

  const manifest = chapters
    .map(
      (_, i) =>
        `<item id="chap${i + 1}" href="OEBPS/chapter${i + 1}.xhtml" media-type="application/xhtml+xml"/>`,
    )
    .join('\n    ');
  const spine = chapters.map((_, i) => `<itemref idref="chap${i + 1}"/>`).join('\n    ');

  const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>${escapeXml(language)}</dc:language>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:identifier id="book-id">${escapeXml(identifier)}</dc:identifier>
  </metadata>
  <manifest>
    ${manifest}
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine toc="ncx">
    ${spine}
  </spine>
</package>`;
  await zipWriter.add('content.opf', new TextReader(contentOpf), zipWriteOptions);

  return (await zipWriter.close()) as Blob;
}
