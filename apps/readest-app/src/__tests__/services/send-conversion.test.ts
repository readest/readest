import { describe, test, expect } from 'vitest';
import { sanitizeHtml } from '@/utils/sanitize';
import { convertToEpub, isConvertible, mimeToKind } from '@/services/send/conversion/convertToEpub';
import { ConversionError } from '@/services/send/conversion/types';

const encode = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;

describe('isConvertible / mimeToKind', () => {
  test('recognizes convertible MIME types', () => {
    expect(isConvertible('text/html')).toBe(true);
    expect(isConvertible('application/rtf')).toBe(true);
    expect(
      isConvertible('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBe(true);
    expect(isConvertible('application/epub+zip')).toBe(false);
    expect(isConvertible('application/pdf')).toBe(false);
  });

  test('maps MIME types to conversion kinds', () => {
    expect(mimeToKind('text/html')).toBe('html');
    expect(mimeToKind('text/uri-list')).toBe('article');
    expect(mimeToKind('text/plain')).toBe('txt');
  });
});

describe('sanitizeHtml', () => {
  test('strips scripts and event handlers, keeps structural tags', () => {
    const dirty = '<p onclick="evil()">Hi</p><script>steal()</script><h2>Title</h2>';
    const clean = sanitizeHtml(dirty);
    expect(clean).toContain('<p>Hi</p>');
    expect(clean).toContain('<h2>Title</h2>');
    expect(clean).not.toContain('script');
    expect(clean).not.toContain('onclick');
  });
});

describe('convertToEpub — html', () => {
  test('produces an EPUB file with the document title', async () => {
    const html = `<html><head><title>My Article</title></head>
      <body><h1>My Article</h1><p>Some body text here.</p></body></html>`;
    const book = await convertToEpub({ kind: 'html', bytes: encode(html) });
    expect(book.title).toBe('My Article');
    expect(book.file.name).toBe('My Article.epub');
    expect(book.file.type).toBe('application/epub+zip');
    expect(book.file.size).toBeGreaterThan(0);
  });

  test('is deterministic — same input yields byte-identical EPUBs', async () => {
    const html = '<html><head><title>Doc</title></head><body><p>Stable content.</p></body></html>';
    const a = await convertToEpub({ kind: 'html', bytes: encode(html) });
    const b = await convertToEpub({ kind: 'html', bytes: encode(html) });
    const [bufA, bufB] = [await a.file.arrayBuffer(), await b.file.arrayBuffer()];
    expect(new Uint8Array(bufA)).toEqual(new Uint8Array(bufB));
  });

  test('throws ConversionError on content-free HTML', async () => {
    await expect(
      convertToEpub({ kind: 'html', bytes: encode('<html><body></body></html>') }),
    ).rejects.toBeInstanceOf(ConversionError);
  });
});

describe('convertToEpub — rtf', () => {
  test('extracts text from a minimal RTF document', async () => {
    const rtf = '{\\rtf1\\ansi {\\b Hello} world from RTF.\\par More text.}';
    const book = await convertToEpub({ kind: 'rtf', bytes: encode(rtf), fileName: 'note.rtf' });
    expect(book.title).toBe('note');
    expect(book.file.size).toBeGreaterThan(0);
  });
});

describe('convertToEpub — article', () => {
  test('extracts the main article content with Readability', async () => {
    const paragraph = 'This is a substantial paragraph of article body text. '.repeat(8);
    const html = `<html><head><title>News Story</title></head><body>
      <nav>menu junk</nav>
      <article><h1>News Story</h1>
        <p>${paragraph}</p><p>${paragraph}</p><p>${paragraph}</p>
      </article>
      <footer>footer junk</footer></body></html>`;
    const book = await convertToEpub({
      kind: 'article',
      html,
      url: 'https://example.com/news',
    });
    expect(book.title).toContain('News Story');
    expect(book.file.size).toBeGreaterThan(0);
  });
});

describe('convertToEpub — page (quality floor)', () => {
  test('rejects bot-detection / verification-page output (extracted text too short)', async () => {
    // Bot-detection / verification screen: just enough markup for
    // Readability to find a sliver of content, but well under the 400-
    // char quality floor.
    const html = `<html><head><title></title></head><body>
      <h1>Verify you are human</h1>
      <p>Please complete the check to continue.</p>
      <button>Verify</button>
    </body></html>`;
    await expect(
      convertToEpub({ kind: 'page', html, url: 'https://example.com/article' }),
    ).rejects.toThrow(ConversionError);
    await expect(
      convertToEpub({ kind: 'page', html, url: 'https://example.com/article' }),
    ).rejects.toThrow(/verification screen|login wall/i);
  });
});
