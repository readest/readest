import { configureZip } from '@/utils/zip';
import { buildNavMap } from './toc';
import type { EpubChapter, EpubBuildMetadata, EpubImage } from './types';

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

// System font stack only — the bundled EPUB stays self-contained and never
// reaches out to the network when opened offline.
const CSS = `
body { line-height: 1.6; font-size: 1em; text-align: justify;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif; }
h1, h2, h3 { line-height: 1.3; }
p { margin: 0.6em 0; }
img { max-width: 100%; height: auto; }
figure { margin: 1em 0; }
figcaption { font-size: 0.9em; color: #666; text-align: center; }
blockquote { margin: 1em 1.5em; color: #444; border-left: 3px solid #ccc; padding-left: 1em; }
pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
pre { white-space: pre-wrap; background: #f5f5f5; padding: 0.6em 0.8em; border-radius: 4px; }
`;

/**
 * Build a minimal, valid EPUB 2.0 from sanitized HTML chapters. Shares the
 * `@zip.js/zip.js` assembly pattern with `TxtToEpubConverter` — mimetype first
 * and uncompressed, `container.xml`, `content.opf`, `toc.ncx`, zeroed
 * timestamps.
 *
 * When `coverImage` is supplied the OPF gets a `<meta name="cover"
 * content="cover-image"/>` plus a `<item id="cover-image" ...>` in the
 * manifest. foliate-js detects covers via that meta tag (see
 * `packages/foliate-js/epub.js`), so EPUB 2.0 style is enough.
 */
export async function buildEpub(
  chapters: EpubChapter[],
  metadata: EpubBuildMetadata,
  images: EpubImage[] = [],
  coverImage?: EpubImage,
): Promise<Blob> {
  if (chapters.length === 0) {
    throw new Error('buildEpub: no chapters');
  }
  await configureZip();
  const { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter } = await import('@zip.js/zip.js');
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

  // Prefer a heading-based nested navMap when the caller supplied one —
  // the EPUB reader's TOC sidebar then mirrors the article's section
  // structure rather than showing a single "Article Title" entry. Falls
  // back to one navPoint per chapter when no headings were extracted
  // (a Substack-style image-and-paragraph post with no h2s, etc).
  const navPoints =
    metadata.toc && metadata.toc.length > 0
      ? buildNavMap(metadata.toc, 'OEBPS/chapter1.xhtml', escapeXml)
      : chapters
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

  // Inline images: keep relative to OEBPS/ so `<img src="images/abc.png">`
  // inside a chapter resolves correctly.
  for (const image of images) {
    await zipWriter.add(
      `OEBPS/${image.path}`,
      new Uint8ArrayReader(new Uint8Array(image.bytes)),
      zipWriteOptions,
    );
  }

  if (coverImage) {
    await zipWriter.add(
      `OEBPS/${coverImage.path}`,
      new Uint8ArrayReader(new Uint8Array(coverImage.bytes)),
      zipWriteOptions,
    );
  }

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
  const imageManifest = images
    .map(
      (image, i) =>
        `<item id="img${i + 1}" href="OEBPS/${escapeXml(image.path)}" media-type="${escapeXml(image.mime)}"/>`,
    )
    .join('\n    ');
  const coverManifest = coverImage
    ? `<item id="cover-image" href="OEBPS/${escapeXml(coverImage.path)}" media-type="${escapeXml(coverImage.mime)}"/>`
    : '';
  const coverMeta = coverImage ? `<meta name="cover" content="cover-image"/>` : '';
  const spine = chapters.map((_, i) => `<itemref idref="chap${i + 1}"/>`).join('\n    ');

  // Only include manifest lines that have content — empty lines would leave
  // stray blank entries in the OPF and trip strict parsers.
  const manifestLines = [manifest, imageManifest, coverManifest]
    .filter((line) => line.length > 0)
    .join('\n    ');

  const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>${escapeXml(language)}</dc:language>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:identifier id="book-id">${escapeXml(identifier)}</dc:identifier>
    ${coverMeta}
  </metadata>
  <manifest>
    ${manifestLines}
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
