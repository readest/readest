import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { convertPageToEpub } from '@/services/send/conversion/convertToEpub';

/**
 * Clipping a page the user opened from disk (`file:///…/saved.html`) with
 * the browser extension. Same converter as a remote clip, but nothing on
 * the page is fetchable: Chrome forbids extension contexts from reading
 * `file://` URLs, so images, favicons and author avatars must be skipped
 * rather than attempted, and the cover has no hostname to fall back on.
 */

const BODY = 'The regional water board met on Tuesday to review the drought plan. '.repeat(12);

/** A 1x1 transparent PNG, so a bundled image has real bytes to hash. */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

function savedHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <title>Drought Plan Review</title>
    <link rel="icon" href="favicon.ico">
  </head>
  <body>
    <nav>Home About Contact Subscribe Log in</nav>
    <header>THE DAILY BANNER</header>
    <article>
      <h1>Drought Plan Review</h1>
      <p>${BODY}</p>
      <p><img src="Drought%20Plan%20Review_files/chart.png" alt="rainfall chart"></p>
      <p>${BODY}</p>
    </article>
    <footer>Copyright 2026 The Daily. All rights reserved.</footer>
  </body>
</html>`;
}

/** What Chrome's `outerHTML` yields for a document parsed as XHTML: XML
 *  serialization, so void elements are self-closed and the root carries
 *  the XHTML namespace. */
function savedXhtml(): string {
  return `<html xmlns="http://www.w3.org/1999/xhtml" lang="en"><head>
    <title>Drought Plan Review</title>
    <meta charset="utf-8" />
  </head>
  <body>
    <nav>Home About Contact</nav>
    <article>
      <h1>Drought Plan Review</h1>
      <p>${BODY}</p>
      <hr />
      <p>${BODY}</p>
    </article>
  </body></html>`;
}

async function chapterOf(file: File): Promise<string> {
  const { BlobReader, TextWriter, ZipReader } = await import('@zip.js/zip.js');
  const reader = new ZipReader(new BlobReader(file));
  const entries = await reader.getEntries();
  const entry = entries.find((e) => e.filename === 'OEBPS/chapter1.xhtml');
  if (!entry || !('getData' in entry) || !entry.getData) throw new Error('chapter1.xhtml missing');
  const html = await entry.getData(new TextWriter());
  await reader.close();
  return html;
}

async function entryNames(file: File): Promise<string> {
  const { BlobReader, ZipReader } = await import('@zip.js/zip.js');
  const reader = new ZipReader(new BlobReader(file));
  const names = (await reader.getEntries()).map((e) => e.filename).join('\n');
  await reader.close();
  return names;
}

async function coverOf(file: File): Promise<string> {
  const { BlobReader, TextWriter, ZipReader } = await import('@zip.js/zip.js');
  const reader = new ZipReader(new BlobReader(file));
  const entries = await reader.getEntries();
  const entry = entries.find((e) => e.filename === 'OEBPS/cover.svg');
  if (!entry || !('getData' in entry) || !entry.getData) throw new Error('cover.svg missing');
  const svg = await entry.getData(new TextWriter());
  await reader.close();
  return svg;
}

describe('convertPageToEpub — locally opened file:// page', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('network disabled in tests'));
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  test('extracts the article body from a saved .html page and drops page chrome', async () => {
    const book = await convertPageToEpub(
      savedHtml(),
      'file:///Users/me/Documents/Drought%20Plan%20Review.html',
    );
    expect(book.title).toBe('Drought Plan Review');

    const chapter = await chapterOf(book.file);
    expect(chapter).toContain('regional water board');
    expect(chapter).not.toContain('THE DAILY BANNER');
    expect(chapter).not.toContain('All rights reserved');
  });

  test('converts a saved .xhtml page (XML-serialized markup)', async () => {
    const book = await convertPageToEpub(
      savedXhtml(),
      'file:///Users/me/Documents/Drought%20Plan%20Review.xhtml',
    );
    expect(book.title).toBe('Drought Plan Review');
    expect(book.file.size).toBeGreaterThan(0);
    const chapter = await chapterOf(book.file);
    expect(chapter).toContain('regional water board');
  });

  test('embeds the sibling images of a saved page', async () => {
    // "Save Page As, Complete" writes assets to `<name>_files/`. An
    // extension page holding file access can read those back, so they
    // belong in the EPUB rather than degrading to alt text.
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('chart.png')) {
        return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const book = await convertPageToEpub(
      savedHtml(),
      'file:///Users/me/Documents/Drought%20Plan%20Review.html',
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      'file:///Users/me/Documents/Drought%20Plan%20Review_files/chart.png',
      expect.objectContaining({ redirect: 'follow' }),
    );
    const chapter = await chapterOf(book.file);
    expect(chapter).toContain('src="images/');
    expect(await entryNames(book.file)).toContain('OEBPS/images/');
  });

  test('makes no remote request while clipping a local page', async () => {
    // The `<link rel=icon>` and the well-known favicon paths resolve to a
    // "null" origin here; nothing about a local page should touch the net.
    fetchSpy.mockResolvedValue(
      new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } }),
    );
    await convertPageToEpub(savedHtml(), 'file:///Users/me/Documents/Drought%20Plan%20Review.html');
    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0])).toMatch(/^file:/);
    }
  });

  test('titles an untitled local page after its file, not its path', async () => {
    // The path would otherwise land in the library as the book title and,
    // via `X-Readest-Title`, on the server.
    const untitled = `<!doctype html><html><body><article>
      <p>${BODY}</p><p>${BODY}</p>
    </article></body></html>`;
    const book = await convertPageToEpub(
      untitled,
      'file:///Users/me/Documents/Drought%20Plan%20Review.html',
    );
    expect(book.title).toBe('Drought Plan Review');
    expect(book.title).not.toContain('/Users/me');
  });

  test('falls back to the file name for the cover label (no hostname to use)', async () => {
    const book = await convertPageToEpub(
      savedHtml(),
      'file:///Users/me/Documents/Drought%20Plan%20Review.html',
    );
    const svg = await coverOf(book.file);
    // Without a site name the cover renders a "·" placeholder avatar and no
    // bottom line — the decoded file name is the only meaningful label a
    // local page has.
    expect(svg).toContain('Drought Plan Review');
    expect(svg).not.toContain('>·<');
  });
});
