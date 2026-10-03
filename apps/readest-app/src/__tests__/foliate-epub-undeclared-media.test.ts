// Regression test for #6227: an embedded <video> renders its controls but never
// loads (black box, 0:00), while Neat Reader and Koodo play the same book.
//
// The reporter's EPUB (epubBuilder 3.1.08.28, cnepub) ships `OPS/111.m4v` in the
// zip and references it as `<video src="111.m4v" controls="controls"/>`, but the
// OPF manifest never declares it -- the same builder also leaves every
// illustration out of the manifest, which is why `tryImageEntryItem` exists.
// `Loader.loadHref` looked the path up in the manifest, fell back only to the
// image and font entry probes, and for `.m4v` returned the raw relative href.
// A relative href cannot resolve against the section's `blob:` document URL, so
// the media element ended up with no source at all.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EPUB } from 'foliate-js/epub.js';

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/fb.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

// Mirrors the reporter's manifest: chapters and the cover only. The media files
// sitting next to them in the zip are never declared.
const OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookID" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Undeclared Media Minimal Test</dc:title>
    <dc:language>zh-CN</dc:language>
    <dc:identifier id="BookID">urn:uuid:6227</dc:identifier>
  </metadata>
  <manifest>
    <item id="ncx" href="fb.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="chapter1" href="chapter1.html" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="chapter1"/>
  </spine>
</package>`;

const NCX = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:6227"/></head>
  <docTitle><text>Undeclared Media Minimal Test</text></docTitle>
  <navMap>
    <navPoint id="navPoint-1" playOrder="1">
      <navLabel><text>转载信息</text></navLabel>
      <content src="chapter1.html"/>
    </navPoint>
  </navMap>
</ncx>`;

const CHAPTER = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body>
    <p><video src="111.m4v" controls="controls"></video></p>
    <p><audio src="pv.mp3" controls="controls"></audio></p>
    <p><video controls="controls"><source src="pv.webm" type="video/webm"/></video></p>
    <p><video src="missing.mp4" controls="controls"></video></p>
  </body>
</html>`;

const FILES: Record<string, string> = {
  'META-INF/container.xml': CONTAINER,
  'OPS/fb.opf': OPF,
  'OPS/fb.ncx': NCX,
  'OPS/chapter1.html': CHAPTER,
  'OPS/111.m4v': 'M4V-BYTES',
  'OPS/pv.mp3': 'MP3-BYTES',
  'OPS/pv.webm': 'WEBM-BYTES',
};

type Section = {
  load: () => Promise<string>;
  loadContent: () => Promise<string | undefined>;
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
let blobTypes: Map<string, string>;

beforeEach(() => {
  let nextId = 0;
  blobTypes = new Map();
  URL.createObjectURL = (blob: Blob) => {
    const url = `blob:test/${nextId++}`;
    blobTypes.set(url, blob.type);
    return url;
  };
  URL.revokeObjectURL = () => {};
});

afterEach(() => {
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});

describe('EPUB media files that the OPF manifest never declares', () => {
  it('resolves an undeclared <video src> in the zip to a blob URL typed for playback', async () => {
    const { sections } = await openEpub(FILES);
    await sections[0]!.load();
    const html = (await sections[0]!.loadContent())!;

    const doc = new DOMParser().parseFromString(html, 'application/xhtml+xml');
    const [video] = doc.querySelectorAll('video');
    const src = video!.getAttribute('src')!;

    expect(src).toMatch(/^blob:/);
    expect(blobTypes.get(src)).toBe('video/mp4');
  });

  it('resolves an undeclared <audio src> the same way', async () => {
    const { sections } = await openEpub(FILES);
    await sections[0]!.load();
    const html = (await sections[0]!.loadContent())!;

    const doc = new DOMParser().parseFromString(html, 'application/xhtml+xml');
    const src = doc.querySelector('audio')!.getAttribute('src')!;

    expect(src).toMatch(/^blob:/);
    expect(blobTypes.get(src)).toBe('audio/mpeg');
  });

  it('resolves an undeclared <source src> inside a <video>', async () => {
    const { sections } = await openEpub(FILES);
    await sections[0]!.load();
    const html = (await sections[0]!.loadContent())!;

    const doc = new DOMParser().parseFromString(html, 'application/xhtml+xml');
    const src = doc.querySelector('source')!.getAttribute('src')!;

    expect(src).toMatch(/^blob:/);
    expect(blobTypes.get(src)).toBe('video/webm');
  });

  it('leaves a media href alone when the zip has no such entry', async () => {
    const { sections } = await openEpub(FILES);
    await sections[0]!.load();
    const html = (await sections[0]!.loadContent())!;

    const doc = new DOMParser().parseFromString(html, 'application/xhtml+xml');
    const missing = [...doc.querySelectorAll('video')].at(-1)!;

    expect(missing.getAttribute('src')).toBe('missing.mp4');
  });
});
