// Regression test for #5097: chapters whose filename inside the EPUB zip needs
// percent-encoding in the manifest (e.g. `&`) render as blank pages.
//
// Zip entry names are raw bytes: `OEBPS/a&b.html`. The OPF, being a URI, must
// percent-encode that as `href="a%26b.html"`. foliate-js resolved hrefs with
// `decodeURI()`, which per spec refuses to decode the reserved set
// (`; / ? : @ & = + $ , #`), so the href resolved to the *string*
// `OEBPS/a%26b.html` and never matched the zip entry. The zip loader returns
// `null` for an unknown entry, so the section silently loaded as empty rather
// than erroring -- the blank/zero-length page in the report.
import { describe, expect, it } from 'vitest';

import { EPUB } from 'foliate-js/epub.js';

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const opf = (items: { id: string; href: string }[]) => `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookID" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Ampersand Bug Minimal Test</dc:title>
    <dc:language>en</dc:language>
    <dc:identifier id="BookID">urn:uuid:12345</dc:identifier>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    ${items.map(({ id, href }) => `<item id="${id}" href="${href}" media-type="application/xhtml+xml"/>`).join('\n    ')}
  </manifest>
  <spine toc="ncx">
    ${items.map(({ id }) => `<itemref idref="${id}"/>`).join('\n    ')}
  </spine>
</package>`;

// The NCX `src` is percent-encoded exactly like the manifest href.
const ncx = (points: { label: string; src: string }[]) => `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:12345"/></head>
  <docTitle><text>Ampersand Bug Minimal Test</text></docTitle>
  <navMap>
    ${points
      .map(
        ({ label, src }, i) => `<navPoint id="navPoint-${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${label}</text></navLabel>
      <content src="${src}"/>
    </navPoint>`,
      )
      .join('\n    ')}
  </navMap>
</ncx>`;

const chapter = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>${body}</p></body></html>`;

type Section = {
  id: string;
  loadText: () => Promise<string | null>;
  resolveHref: (href: string) => string;
};

// Mirrors foliate-js's real zip loader (view.js): a name that isn't an entry
// yields `null` rather than throwing.
const openEpub = async (files: Record<string, string>) => {
  const epub = new EPUB({
    entries: Object.keys(files).map((filename) => ({ filename })),
    loadText: async (name: string) => files[name] ?? null,
    loadBlob: async (name: string) =>
      files[name] == null ? null : new Blob([files[name]!], { type: 'application/xhtml+xml' }),
    getSize: (name: string) => files[name]?.length ?? 0,
    // only used to deobfuscate fonts, which these fixtures don't have
    sha1: undefined,
  });
  await epub.init();
  const sections = (epub.sections ?? []) as Section[];
  const toc = (epub.toc ?? []) as { label: string; href: string }[];
  return { epub, sections, toc };
};

describe('EPUB hrefs that percent-encode reserved characters (#5097)', () => {
  it('loads a chapter whose zip entry name contains "&" (the reported bug)', async () => {
    const { sections } = await openEpub({
      'META-INF/container.xml': CONTAINER,
      'OEBPS/content.opf': opf([
        { id: 'chapter1', href: 'normal.html' },
        { id: 'chapter2', href: 'a%26b.html' },
      ]),
      'OEBPS/normal.html': chapter('Chapter 1: Normal'),
      'OEBPS/a&b.html': chapter('Chapter 2: A&amp;B (The Bug)'),
    });

    // The section must point at the real zip entry, not the still-encoded name.
    expect(sections[1]!.id).toBe('OEBPS/a&b.html');

    const text = await sections[1]!.loadText();
    expect(text).toContain('Chapter 2: A&amp;B (The Bug)');
  });

  it('navigates to that chapter from the table of contents', async () => {
    const { epub, toc } = await openEpub({
      'META-INF/container.xml': CONTAINER,
      'OEBPS/content.opf': opf([
        { id: 'chapter1', href: 'normal.html' },
        { id: 'chapter2', href: 'a%26b.html' },
      ]),
      'OEBPS/toc.ncx': ncx([
        { label: 'Chapter 1: Normal', src: 'normal.html' },
        { label: 'Chapter 2: A&amp;B (The Bug)', src: 'a%26b.html' },
      ]),
      'OEBPS/normal.html': chapter('Chapter 1: Normal'),
      'OEBPS/a&b.html': chapter('Chapter 2: A&amp;B (The Bug)'),
    });

    // Tapping the TOC row hands its href to `resolveHref`; it must land on the
    // chapter's spine index instead of resolving to nothing.
    expect(epub.resolveHref(toc[1]!.href)?.index).toBe(1);
  });

  // Issue #346, "Pictures in book (ePub) can not be displayed": a book with a
  // raw, unencoded ":" in a chapter path. That path becomes the base its own
  // images resolve against, and the base was tested for a URL scheme with
  // `relativeTo.includes(':')`, so `new URL()` threw and no image resolved. It
  // was patched by exempting bases that start with "OEBPS", which left books
  // under any other root still broken. A real scheme test fixes both roots.
  it.each([
    'OEBPS',
    'Text',
  ])('resolves images inside a ":" chapter under %s/ (#346)', async (root) => {
    const { sections } = await openEpub({
      'META-INF/container.xml': CONTAINER.replace('OEBPS/content.opf', `${root}/content.opf`),
      [`${root}/content.opf`]: opf([{ id: 'chapter1', href: 'Text/ch:1.html' }]),
      [`${root}/toc.ncx`]: ncx([{ label: 'Chapter 1', src: 'Text/ch:1.html' }]),
      [`${root}/Text/ch:1.html`]: chapter('Chapter 1'),
    });

    expect(sections[0]!.id).toBe(`${root}/Text/ch:1.html`);
    // the image hrefs that went missing in #346
    expect(sections[0]!.resolveHref('../Images/pic.jpg')).toBe(`${root}/Images/pic.jpg`);
    expect(sections[0]!.resolveHref('pic.jpg')).toBe(`${root}/Text/pic.jpg`);
  });

  it('loads chapters for the other reserved characters decodeURI leaves encoded', async () => {
    // `,` and `:` were previously hand-patched one at a time; the rest of the
    // set failed the same way.
    const names = {
      amp: 'a&b.html',
      comma: 'a,b.html',
      colon: 'a:b.html',
      plus: 'a+b.html',
      equals: 'a=b.html',
      at: 'a@b.html',
      dollar: 'a$b.html',
      semi: 'a;b.html',
      question: 'a?b.html',
    };
    const files: Record<string, string> = {
      'META-INF/container.xml': CONTAINER,
      'OEBPS/content.opf': opf(
        Object.entries(names).map(([id, name]) => ({
          id,
          href: encodeURIComponent(name),
        })),
      ),
    };
    for (const name of Object.values(names)) {
      files[`OEBPS/${name}`] = chapter(`body of ${name}`);
    }
    const { sections } = await openEpub(files);

    const loaded = await Promise.all(sections.map((section) => section.loadText()));
    for (const [i, name] of Object.values(names).entries()) {
      expect(loaded[i], `section for ${name}`).toContain(`body of ${name}`);
    }
  });
});
