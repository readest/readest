// Regression test for the footnote-popup vs. illustration bug: in a novel whose
// notes and pictures share a chapter file, opening a footnote popup a few times
// made the chapter's illustrations impossible to open until the book was closed
// and reopened.
//
// `FootnoteHandler#showFragment` opens a SECOND `foliate-view` on the same book
// object, so the popup runs `section.load()` for a section the reading view is
// already holding, and dismissing it runs `section.unload()` (`view.close()` ->
// `Paginator.destroy()` -> `#destroyAllViews()` -> `sections[i].unload()`).
//
// `Loader.ref()` keyed its "already counted this child" list by `parent`, but
// top-level section loads pass `parent === undefined`, so every top-level load
// in the book shared one bucket. Once an href landed in that bucket every later
// `ref()` was a no-op while `unref()` still decremented, so the refcount
// underflowed to zero on the second popup and revoked the live section's blob
// URL together with all of its children -- the illustrations. An `<img>` that
// has already decoded stays painted after its blob URL is revoked, so the page
// looked fine and only the tap-to-zoom broke.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EPUB } from 'foliate-js/epub.js';

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookID" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Novel With Notes And Pictures</dc:title>
    <dc:language>zh</dc:language>
    <dc:identifier id="BookID">urn:uuid:12345</dc:identifier>
  </metadata>
  <manifest>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="pic" href="pic.png" media-type="image/png"/>
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
  </spine>
</package>`;

// The reported layout: the note's target and the illustration live in the same
// chapter file, so the popup loads the very section being read.
const CHAPTER = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <p>text with a note<a epub:type="noteref" href="#fn1">[1]</a></p>
    <img src="pic.png" alt="illustration"/>
    <aside id="fn1" epub:type="footnote"><p>the note body</p></aside>
  </body>
</html>`;

const FILES: Record<string, string> = {
  'META-INF/container.xml': CONTAINER,
  'OEBPS/content.opf': OPF,
  'OEBPS/chapter1.xhtml': CHAPTER,
  'OEBPS/pic.png': 'PNG-BYTES',
};

type Section = {
  load: () => Promise<string>;
  loadContent: () => Promise<string | undefined>;
  unload: () => void;
};

const openEpub = async (files: Record<string, string>) => {
  const epub = new EPUB({
    entries: Object.keys(files).map((filename) => ({ filename })),
    loadText: async (name: string) => files[name] ?? null,
    loadBlob: async (name: string) => (files[name] == null ? null : new Blob([files[name]!])),
    getSize: (name: string) => files[name]?.length ?? 0,
    // only used to deobfuscate fonts, which this fixture doesn't have
    sha1: undefined,
  });
  await epub.init();
  return { sections: (epub.sections ?? []) as Section[] };
};

// jsdom implements neither half of the object-URL API.
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
let live: Set<string>;
let revoked: string[];

beforeEach(() => {
  let nextId = 0;
  live = new Set();
  revoked = [];
  URL.createObjectURL = () => {
    const url = `blob:test/${nextId++}`;
    live.add(url);
    return url;
  };
  URL.revokeObjectURL = (url: string) => {
    live.delete(url);
    revoked.push(url);
  };
});

afterEach(() => {
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});

describe('EPUB resource refcounting across a second view on the same book', () => {
  it('keeps the reading view resources alive when a footnote popup opens and closes repeatedly', async () => {
    const { sections } = await openEpub(FILES);
    const section = sections[0]!;

    // The reading view holds the chapter; loading it also creates a blob URL
    // for the illustration it references.
    const readingViewUrl = await section.load();
    expect(live.size).toBe(2);

    // Tap the note, read it, dismiss it -- the reported repro says three or
    // more times, and the underflow used to land on the second.
    for (let tap = 1; tap <= 3; tap++) {
      const popupUrl = await section.load();
      // The popup shares the reading view's already-loaded resources.
      expect(popupUrl, `popup ${tap} resource`).toBe(readingViewUrl);

      section.unload();

      // The reading view still has the chapter open, so nothing may be
      // revoked: the illustration must stay fetchable or tapping it can no
      // longer open the image viewer.
      expect(revoked, `after dismissing popup ${tap}`).toEqual([]);
      expect(live.size, `after dismissing popup ${tap}`).toBe(2);
    }

    // ...and the resources are still released once the reader itself lets go,
    // so holding them alive is refcounting, not a leak.
    section.unload();
    expect(revoked).toHaveLength(2);
    expect(live.size).toBe(0);
  });

  // The renderer reads a section's source right after loading it
  // (`section.load()` then `section.loadContent()` in Paginator), and only the
  // load is matched by an `unload`. Counting that read as a second reference
  // would keep every section the reader ever opened alive for the life of the
  // book -- the leak that a naive "always count a top-level ref" fix causes.
  it('frees a section once its views close, despite the renderer also reading its content', async () => {
    const { sections } = await openEpub(FILES);
    const section = sections[0]!;

    const openView = async () => {
      await section.load();
      await section.loadContent();
    };

    await openView(); // the reading view
    await openView(); // the footnote popup, on the same section

    section.unload(); // popup dismissed -- the reading view still holds it
    expect(revoked).toEqual([]);
    expect(live.size).toBe(2);

    section.unload(); // the reader closes the section
    expect(live.size).toBe(0);
  });
});
