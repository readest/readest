import { describe, test, expect } from 'vitest';
import { buildEpub } from '@/services/send/conversion/buildEpub';
import { configureZip } from '@/utils/zip';

async function readChapter(blob: Blob): Promise<string> {
  await configureZip();
  const { BlobReader, ZipReader, TextWriter } = await import('@zip.js/zip.js');
  const reader = new ZipReader(new BlobReader(blob));
  const entry = (await reader.getEntries()).find((e) => e.filename === 'OEBPS/chapter1.xhtml');
  if (!entry || entry.directory) throw new Error('chapter1.xhtml missing');
  const text = await entry.getData(new TextWriter());
  await reader.close();
  return text;
}

const meta = { title: 'T', author: 'A', language: 'en', identifier: 'xhtml-test:1' };

describe('buildEpub — chapters are well-formed XHTML', () => {
  test.each([
    ['br', '<p>First line<br>Second line</p>'],
    ['img', '<figure><img src="images/example.jpg" alt="x"></figure>'],
    ['hr', '<p>a</p><hr><p>b</p>'],
    ['named entity', '<p>a&nbsp;b &mdash; c</p>'],
  ])('%s parses as XML', async (_name, html) => {
    const xhtml = await readChapter(await buildEpub([{ title: 'C', html }], meta));
    const doc = new DOMParser().parseFromString(xhtml, 'application/xhtml+xml');
    expect(doc.getElementsByTagName('parsererror').length).toBe(0);
    expect(doc.body.textContent).toBe(
      new DOMParser().parseFromString(html, 'text/html').body.textContent,
    );
  });

  test('keeps the image and its attributes', async () => {
    const html = '<figure><img src="images/example.jpg" alt="x"></figure>';
    const xhtml = await readChapter(await buildEpub([{ title: 'C', html }], meta));
    const doc = new DOMParser().parseFromString(xhtml, 'application/xhtml+xml');
    const img = doc.querySelector('figure > img');
    expect(img?.getAttribute('src')).toBe('images/example.jpg');
    expect(img?.getAttribute('alt')).toBe('x');
  });
});
