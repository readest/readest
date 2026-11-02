import { afterEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ os: 'linux' }));
vi.mock('@/utils/misc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/misc')>()),
  getOSPlatform: () => platform.os,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  platform.os = 'linux';
});

import { DocumentLoader } from '@/libs/document';

// The Rust EPUB prefetch only runs inside Tauri; with a native path set the
// loader still asks for it, so answer "not available" and let zip.js read.
vi.mock('@/utils/tauriEpubBridge', () => ({ tryNativePrefetchEpub: async () => null }));

const AUDIO = Uint8Array.from({ length: 4096 }, (_, i) => (i * 7) % 251);

const createNarratedEpub = async () => {
  const { ZipWriter, BlobWriter, TextReader, Uint8ArrayReader } = await import('@zip.js/zip.js');
  const writer = new ZipWriter(new BlobWriter('application/epub+zip'));

  await writer.add('mimetype', new TextReader('application/epub+zip'), { level: 0 });
  await writer.add(
    'META-INF/container.xml',
    new TextReader(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`),
  );
  await writer.add(
    'OPS/content.opf',
    new TextReader(`<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="bookid" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">narrated</dc:identifier>
    <dc:title>Narrated</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="stored" href="audio/book.mp3" media-type="audio/mpeg"/>
    <item id="deflated" href="audio/deflated.mp3" media-type="audio/mpeg"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
  </spine>
</package>`),
  );
  await writer.add(
    'OPS/ch1.xhtml',
    new TextReader(
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>1</title></head><body><p>One</p></body></html>',
    ),
  );
  // An extra field on the local header only, as some writers emit: the data
  // offset has to come from the local header, not the central directory.
  await writer.add('OPS/audio/book.mp3', new Uint8ArrayReader(AUDIO), {
    level: 0,
    extraField: new Map([[0xcafe, new Uint8Array(12)]]),
  });
  await writer.add('OPS/audio/deflated.mp3', new Uint8ArrayReader(AUDIO), { level: 9 });
  await writer.add('OPS/audio/Chapter 1 #é.m4a', new Uint8ArrayReader(AUDIO), { level: 9 });

  const bytes = new Uint8Array(await (await writer.close()).arrayBuffer());
  return { bytes, file: new File([bytes], 'narrated.epub', { type: 'application/epub+zip' }) };
};

describe('BookDoc.getMediaSource', () => {
  // The web reader passes a library path too; its File is still in memory.
  it('slices a stored entry out of the book file instead of copying it', async () => {
    const { file } = await createNarratedEpub();
    const { book } = await new DocumentLoader(file, {
      nativeFilePath: 'Readest/Books/abc/narrated.epub',
    }).open();
    const loadBlob = vi.spyOn(book, 'loadBlob' as never);

    const media = await book.getMediaSource!('OPS/audio/book.mp3', 'audio/mpeg');

    expect(media && 'blob' in media).toBe(true);
    const blob = (media as { blob: Blob }).blob;
    expect(blob.type).toBe('audio/mpeg');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(AUDIO);
    expect(loadBlob).not.toHaveBeenCalled();
  });

  // NativeFile and RemoteFile read a slice into memory, so the app gets the
  // entry's place on disk instead.
  it('gives the byte window of a stored entry in a native book file', async () => {
    const { bytes, file } = await createNarratedEpub();
    const nativeFile = Object.assign(file, { open: async () => file, close: async () => {} });
    const { book } = await new DocumentLoader(nativeFile, {
      nativeFilePath: '/books/narrated.epub',
    }).open();

    const media = await book.getMediaSource!('OPS/audio/book.mp3', 'audio/mpeg');

    expect(media).toMatchObject({ path: '/books/narrated.epub' });
    const { start, end } = media as { start: number; end: number };
    expect(bytes.slice(start, end)).toEqual(AUDIO);
  });

  it('hands Linux the raw compressed ZIP entry without reading its audio bytes', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    const { file } = await createNarratedEpub();
    const nativeFile = Object.assign(file, { open: async () => file, close: async () => {} });
    const { book } = await new DocumentLoader(nativeFile, {
      nativeFilePath: '/books/narrated.epub',
    }).open();
    const slice = vi.spyOn(file, 'slice');
    const loadBlob = vi.spyOn(book, 'loadBlob' as never);

    expect(await book.getMediaSource!('ops/audio/chapter 1 #é.m4a', 'audio/mp4')).toEqual({
      path: '/books/narrated.epub',
      entry: 'OPS/audio/Chapter 1 #é.m4a',
    });
    expect(slice).not.toHaveBeenCalled();
    expect(loadBlob).not.toHaveBeenCalled();
  });

  it.each([
    ['web', 'linux', '/books/narrated.epub'],
    ['tauri', 'android', '/books/narrated.epub'],
    ['tauri', 'ios', '/books/narrated.epub'],
    ['tauri', 'macos', '/books/narrated.epub'],
    ['tauri', 'linux', undefined],
    ['tauri', 'linux', 'https://server/narrated.epub'],
    ['tauri', 'linux', 'Readest/Books/narrated.epub'],
  ])('preserves compressed entry fallback on %s/%s with path %s', async (app, os, path) => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', app);
    platform.os = os!;
    const { file } = await createNarratedEpub();
    const nativeFile = Object.assign(file, { open: async () => file, close: async () => {} });
    const { book } = await new DocumentLoader(nativeFile, { nativeFilePath: path }).open();

    expect(await book.getMediaSource!('OPS/audio/deflated.mp3', 'audio/mpeg')).toBeNull();
  });

  it('has no media source for a compressed entry', async () => {
    const { file } = await createNarratedEpub();
    const { book } = await new DocumentLoader(file).open();

    expect(await book.getMediaSource!('OPS/audio/deflated.mp3', 'audio/mpeg')).toBeNull();
  });
});
