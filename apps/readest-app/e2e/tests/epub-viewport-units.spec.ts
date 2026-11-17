import { writeFile } from 'node:fs/promises';
import { strToU8, zipSync } from 'fflate';
import { expect, test } from '../fixtures/base';

test('EPUB viewport units follow a resize in the same section (#7456)', async ({
  openBook,
  page,
}, testInfo) => {
  const file = testInfo.outputPath('viewport.epub');
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
            <dc:identifier id="id">viewport-resize</dc:identifier>
            <dc:title>Viewport resize</dc:title><dc:language>en</dc:language>
          </metadata>
          <manifest>
            <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
            <item id="style" href="book.css" media-type="text/css"/>
          </manifest>
          <spine><itemref idref="chapter"/></spine>
        </package>`),
      'chapter.xhtml': strToU8(`
        <html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title>
          <link rel="stylesheet" href="book.css"/><style>#probe { height: 20vh; }</style>
        </head><body><div id="probe">Viewport units</div></body></html>`),
      'book.css': strToU8('#probe { width: 20vw; }'),
    }),
  );

  await page.setViewportSize({ width: 720, height: 900 });
  const reader = await openBook(file);
  const probe = reader.foliateView.frameLocator('iframe').locator('#probe');
  await expect(probe).toBeVisible();
  const size = () => probe.evaluate((element) => [element.clientWidth, element.clientHeight]);
  const [portraitWidth, portraitHeight] = await size();

  await page.setViewportSize({ width: 1000, height: 680 });
  await expect.poll(async () => (await size())[0]).toBeGreaterThan(portraitWidth! + 30);
  await expect.poll(async () => (await size())[1]).toBeLessThan(portraitHeight! - 25);

  await page.setViewportSize({ width: 720, height: 900 });
  await expect.poll(size).toEqual([portraitWidth, portraitHeight]);
});
