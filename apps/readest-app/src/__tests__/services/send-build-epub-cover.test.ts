import { describe, test, expect } from 'vitest';
import { buildEpub } from '@/services/send/conversion/buildEpub';
import { configureZip } from '@/utils/zip';

async function unzipEpub(blob: Blob): Promise<Map<string, string>> {
  await configureZip();
  const { BlobReader, ZipReader, TextWriter } = await import('@zip.js/zip.js');
  const reader = new ZipReader(new BlobReader(blob));
  const entries = await reader.getEntries();
  const out = new Map<string, string>();
  for (const entry of entries) {
    if (entry.directory) continue;
    const text = await entry.getData!(new TextWriter());
    out.set(entry.filename, text);
  }
  await reader.close();
  return out;
}

const chapter = { title: 'Body', html: '<p>Body text long enough to be a chapter.</p>' };
const meta = {
  title: 'Cover Test',
  author: 'Tester',
  language: 'en',
  identifier: 'cover-test:1',
};

describe('buildEpub — cover image', () => {
  test('without coverImage, OPF has no <meta name="cover">', async () => {
    const blob = await buildEpub([chapter], meta);
    const files = await unzipEpub(blob);
    const opf = files.get('content.opf');
    expect(opf).toBeDefined();
    expect(opf).not.toContain('name="cover"');
  });

  test('with coverImage, OPF references the cover via name="cover" meta + manifest item', async () => {
    const svgBytes = new TextEncoder().encode(
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900"></svg>',
    ).buffer as ArrayBuffer;
    const blob = await buildEpub([chapter], meta, [], {
      path: 'cover.svg',
      bytes: svgBytes,
      mime: 'image/svg+xml',
    });
    const files = await unzipEpub(blob);

    // Cover file is in OEBPS/
    expect(files.has('OEBPS/cover.svg')).toBe(true);

    // OPF references the cover
    const opf = files.get('content.opf');
    expect(opf).toBeDefined();
    expect(opf).toContain('<meta name="cover" content="cover-image"');
    expect(opf).toContain('id="cover-image"');
    expect(opf).toContain('href="OEBPS/cover.svg"');
    expect(opf).toContain('media-type="image/svg+xml"');
  });

  test('cover-only EPUBs (no other images) still produce a valid manifest', async () => {
    const svgBytes = new TextEncoder().encode(
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900"></svg>',
    ).buffer as ArrayBuffer;
    const blob = await buildEpub([chapter], meta, [], {
      path: 'cover.svg',
      bytes: svgBytes,
      mime: 'image/svg+xml',
    });
    const files = await unzipEpub(blob);
    const opf = files.get('content.opf')!;
    // Exactly one <item> for the cover image (no extra <item>s for empty images array)
    const imgItems = opf.match(/<item[^>]*media-type="image\//g) ?? [];
    expect(imgItems.length).toBe(1);
  });
});
