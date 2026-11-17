import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { expect, test } from '../fixtures/base';

const maxInlineSize = (page: Page) =>
  page.evaluate(() => {
    const view = document.querySelector('foliate-view') as
      | (HTMLElement & { renderer?: HTMLElement })
      | null;
    return view?.renderer?.getAttribute('max-inline-size') ?? null;
  });

// A fresh library in a landscape window defaults Maximum Column Width to 720.
test('a maximized desktop window keeps the configured column width (#7510)', async ({
  openBook,
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await openBook();
  await expect.poll(() => maxInlineSize(page)).toBe('720px');

  await page.setViewportSize({ width: 1600, height: 900 });
  await expect.poll(() => maxInlineSize(page)).toBe('720px');
});

// Vertical writing sizes the column to the longer screen axis, so the value
// the renderer holds must follow the window as it grows.
test('a vertical book follows a window resize (#7510)', async ({ openBook, page }, testInfo) => {
  const file = testInfo.outputPath('vertical.epub');
  await writeFile(
    file,
    zipSync({
      mimetype: [strToU8('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': strToU8(`
        <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
          <rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles>
        </container>`),
      'book.opf': strToU8(`
        <package xmlns="http://www.idpf.org/2007/opf" unique-identifier="id" version="3.0">
          <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
            <dc:identifier id="id">vertical-resize</dc:identifier>
            <dc:title>Vertical resize</dc:title><dc:language>ja</dc:language>
          </metadata>
          <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
          <spine page-progression-direction="rtl"><itemref idref="chapter"/></spine>
        </package>`),
      'chapter.xhtml': strToU8(`
        <html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ja"><head><title>Chapter</title>
          <style>html { writing-mode: vertical-rl; }</style>
        </head><body><p>縦書きの本文。</p></body></html>`),
    }),
  );

  await page.setViewportSize({ width: 1000, height: 900 });
  await openBook(file);
  await expect.poll(() => maxInlineSize(page)).toBe('1000px');

  await page.setViewportSize({ width: 1400, height: 900 });
  await expect.poll(() => maxInlineSize(page)).toBe('1400px');
});
