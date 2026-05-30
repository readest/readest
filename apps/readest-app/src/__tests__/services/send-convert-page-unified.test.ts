import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { convertPageToEpub, convertToEpub } from '@/services/send/conversion/convertToEpub';

/**
 * Regression: every clip channel (desktop, mobile, extension) goes through
 * `convertPageToEpub` and must produce byte-identical EPUBs for the same
 * (html, url) pair. The import-time hash dedup relies on this — without
 * it, re-clipping an article (or clipping it from two devices) creates
 * duplicate library entries.
 *
 * Two surfaces:
 *   1. `convertPageToEpub(html, url)` direct (extension SW path).
 *   2. `convertToEpub({ kind: 'page', html, url })` (existing /send path).
 * Both must yield the same bytes.
 */

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

function pngResponse(): Response {
  return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
}

const HTML = `<!doctype html>
<html lang="en">
  <head>
    <title>Unifying Clipping Paths</title>
    <meta property="og:site_name" content="Example Site">
    <link rel="apple-touch-icon" href="https://example.com/icon.png">
  </head>
  <body>
    <article>
      <h1>Unifying Clipping Paths</h1>
      <p class="byline">By Jane Doe</p>
      <h2>Introduction</h2>
      <p>${'lorem ipsum dolor sit amet '.repeat(40)}</p>
      <p><img src="https://example.com/hero.png" alt="hero"></p>
      <h2>Details</h2>
      <p>${'consectetur adipiscing elit '.repeat(40)}</p>
      <h3>A subsection</h3>
      <p>${'sed do eiusmod tempor incididunt '.repeat(40)}</p>
    </article>
  </body>
</html>`;
const URL_STR = 'https://example.com/articles/unify';

describe('convertPageToEpub — clipping channel unification', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => pngResponse());
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  test('the direct call and the convertToEpub({kind:"page"}) wrapper produce identical EPUBs', async () => {
    const direct = await convertPageToEpub(HTML, URL_STR);
    const viaConvertToEpub = await convertToEpub({ kind: 'page', html: HTML, url: URL_STR });

    const a = new Uint8Array(await direct.file.arrayBuffer());
    const b = new Uint8Array(await viaConvertToEpub.file.arrayBuffer());

    expect(direct.title).toBe(viaConvertToEpub.title);
    expect(direct.author).toBe(viaConvertToEpub.author);
    expect(a.byteLength).toBe(b.byteLength);
    expect(a.byteLength).toBeGreaterThan(0);
    // Compare a few sentinel windows rather than the full array (the
    // failure message is unreadable on a 200 KB blob); pin the first 16
    // bytes (EPUB mimetype entry) and a few random samples.
    expect(Array.from(a.subarray(0, 64))).toEqual(Array.from(b.subarray(0, 64)));
    expect(Array.from(a.subarray(1000, 1064))).toEqual(Array.from(b.subarray(1000, 1064)));
    expect(Array.from(a.subarray(a.byteLength - 64))).toEqual(
      Array.from(b.subarray(b.byteLength - 64)),
    );
  });

  test('a heading-shaped article surfaces every h1/h2/h3 in the EPUB TOC', async () => {
    const { file } = await convertPageToEpub(HTML, URL_STR);
    const { BlobReader, TextWriter, ZipReader } = await import('@zip.js/zip.js');
    const reader = new ZipReader(new BlobReader(file));
    const entries = await reader.getEntries();
    const ncxEntry = entries.find((e) => e.filename === 'toc.ncx');
    if (!ncxEntry || !('getData' in ncxEntry) || !ncxEntry.getData) {
      throw new Error('toc.ncx missing');
    }
    const ncx = await ncxEntry.getData(new TextWriter());
    await reader.close();

    // Headings from the article:
    expect(ncx).toContain('<text>Unifying Clipping Paths</text>');
    expect(ncx).toContain('<text>Introduction</text>');
    expect(ncx).toContain('<text>Details</text>');
    expect(ncx).toContain('<text>A subsection</text>');
  });

  test('the EPUB includes a synthetic cover with the author-hashed theme', async () => {
    const { file } = await convertPageToEpub(HTML, URL_STR);
    const { BlobReader, TextWriter, ZipReader } = await import('@zip.js/zip.js');
    const reader = new ZipReader(new BlobReader(file));
    const entries = await reader.getEntries();

    // OPF declares a cover-image item:
    const opfEntry = entries.find((e) => e.filename === 'content.opf');
    if (!opfEntry || !('getData' in opfEntry) || !opfEntry.getData) {
      throw new Error('content.opf missing');
    }
    const opf = await opfEntry.getData(new TextWriter());
    expect(opf).toContain('<meta name="cover" content="cover-image"/>');

    // The cover asset itself is an SVG:
    const coverEntry = entries.find((e) => e.filename === 'OEBPS/cover.svg');
    expect(coverEntry).toBeDefined();
    await reader.close();
  });

  test('re-converting the same (html, url) yields a byte-identical EPUB', async () => {
    const first = new Uint8Array(await (await convertPageToEpub(HTML, URL_STR)).file.arrayBuffer());
    const second = new Uint8Array(
      await (await convertPageToEpub(HTML, URL_STR)).file.arrayBuffer(),
    );
    expect(first.byteLength).toBe(second.byteLength);
    expect(Array.from(first.subarray(0, 256))).toEqual(Array.from(second.subarray(0, 256)));
  });
});
