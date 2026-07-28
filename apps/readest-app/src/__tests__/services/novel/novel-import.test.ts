import { describe, expect, it, vi } from 'vitest';
import { configureZip } from '@/utils/zip';
import { downloadNovel, fetchNovelToc, isNovelImportCancelled } from '@/services/novel/novelImport';
import { ConversionError } from '@/services/send/conversion/types';
import type { NovelToc } from '@/services/novel/chapterList';

async function unzipEpub(blob: Blob): Promise<Map<string, string>> {
  await configureZip();
  const { BlobReader, ZipReader, TextWriter } = await import('@zip.js/zip.js');
  const reader = new ZipReader(new BlobReader(blob));
  const entries = await reader.getEntries();
  const out = new Map<string, string>();
  for (const entry of entries) {
    if (entry.directory) continue;
    out.set(entry.filename, await entry.getData!(new TextWriter()));
  }
  await reader.close();
  return out;
}

const chapterPage = (n: number) => `<!DOCTYPE html><html><head><title>Chapter ${n}</title></head>
<body>
<div class="nav"><a href="/">Home</a><a href="/toc">TOC</a></div>
<div id="content">
${Array.from({ length: 10 }, (_, i) => `<p>Chapter ${n} paragraph ${i} with plenty of narrative text to satisfy extraction quality floors.</p>`).join('\n')}
</div>
</body></html>`;

const tocPage = `<!DOCTYPE html><html><head>
<title>My Novel</title>
<meta property="og:title" content="My Novel"/>
<meta name="author" content="Author X"/>
</head><body>
<ul>
${Array.from({ length: 6 }, (_, i) => `<li><a href="/novel/7/${i + 1}">Chapter ${i + 1}: Part ${i + 1}</a></li>`).join('\n')}
</ul>
</body></html>`;

const BASE = 'https://novels.example.org';
const TOC_URL = `${BASE}/novel/7/`;

const makeFetchPage =
  (overrides: Record<string, string | Error> = {}) =>
  async (url: string) => {
    const override = overrides[url];
    if (override instanceof Error) throw override;
    if (typeof override === 'string') return { html: override, finalUrl: url };
    if (url === TOC_URL) return { html: tocPage, finalUrl: url };
    const match = url.match(/\/novel\/7\/([0-9]+)$/);
    if (match) return { html: chapterPage(parseInt(match[1]!, 10)), finalUrl: url };
    throw new Error(`unexpected fetch: ${url}`);
  };

const toc = (over: Partial<NovelToc> = {}): NovelToc => ({
  title: 'My Novel',
  author: 'Author X',
  coverUrl: null,
  chapters: Array.from({ length: 6 }, (_, i) => ({
    title: `Chapter ${i + 1}: Part ${i + 1}`,
    url: `${BASE}/novel/7/${i + 1}`,
  })),
  ...over,
});

describe('fetchNovelToc', () => {
  it('fetches and parses a chapter list', async () => {
    const result = await fetchNovelToc(TOC_URL, { fetchPage: makeFetchPage() });
    expect(result.title).toBe('My Novel');
    expect(result.author).toBe('Author X');
    expect(result.chapters).toHaveLength(6);
    expect(result.chapters[0]!.url).toBe(`${BASE}/novel/7/1`);
  });

  it('throws parse_failed for a page with no chapter list', async () => {
    const page = `<html><head><title>Post</title></head><body><article>${'<p>text</p>'.repeat(30)}</article></body></html>`;
    await expect(
      fetchNovelToc(`${BASE}/post`, { fetchPage: makeFetchPage({ [`${BASE}/post`]: page }) }),
    ).rejects.toMatchObject({ name: 'ConversionError', code: 'parse_failed' });
    await expect(
      fetchNovelToc(`${BASE}/post`, { fetchPage: makeFetchPage({ [`${BASE}/post`]: page }) }),
    ).rejects.toBeInstanceOf(ConversionError);
  });
});

describe('downloadNovel', () => {
  it('builds a multi-chapter EPUB in reading order', async () => {
    const book = await downloadNovel(toc(), TOC_URL, { fetchPage: makeFetchPage() });
    expect(book.title).toBe('My Novel');
    expect(book.author).toBe('Author X');
    expect(book.failures).toBe(0);
    expect(book.chapterCount).toBe(6);
    expect(book.file.name).toBe('My Novel.epub');

    const files = await unzipEpub(book.file);
    const opf = files.get('content.opf')!;
    expect(opf).toContain('<dc:title>My Novel</dc:title>');
    expect(opf).toContain('<dc:creator>Author X</dc:creator>');
    for (let n = 1; n <= 6; n++) {
      const xhtml = files.get(`OEBPS/chapter${n}.xhtml`)!;
      expect(xhtml).toContain(`<h1>Chapter ${n}: Part ${n}</h1>`);
      expect(xhtml).toContain(`Chapter ${n} paragraph 3`);
    }
    // toc.ncx lists every chapter
    const ncx = files.get('toc.ncx')!;
    expect(ncx).toContain('Chapter 6: Part 6');
  });

  it('strips images from chapter content', async () => {
    const page = chapterPage(1).replace(
      '<div id="content">',
      '<div id="content"><img src="https://cdn.example.org/x.jpg"/><figure><img src="/y.png"/></figure>',
    );
    const book = await downloadNovel(toc({ chapters: toc().chapters.slice(0, 5) }), TOC_URL, {
      fetchPage: makeFetchPage({ [`${BASE}/novel/7/1`]: page }),
    });
    const files = await unzipEpub(book.file);
    expect(files.get('OEBPS/chapter1.xhtml')).not.toContain('<img');
  });

  it('keeps going when a chapter fails and inserts a placeholder', async () => {
    const book = await downloadNovel(toc(), TOC_URL, {
      fetchPage: makeFetchPage({ [`${BASE}/novel/7/3`]: new Error('boom') }),
    });
    expect(book.failures).toBe(1);
    expect(book.chapterCount).toBe(6);
    const files = await unzipEpub(book.file);
    const failed = files.get('OEBPS/chapter3.xhtml')!;
    expect(failed).toContain('Chapter 3: Part 3');
    expect(failed).toContain(`${BASE}/novel/7/3`);
    expect(files.get('OEBPS/chapter4.xhtml')).toContain('Chapter 4 paragraph 3');
  });

  it('reports monotonic progress up to the chapter count', async () => {
    const seen: number[] = [];
    await downloadNovel(toc(), TOC_URL, {
      fetchPage: makeFetchPage(),
      onProgress: (done, total) => {
        expect(total).toBe(6);
        seen.push(done);
      },
    });
    expect(seen).toHaveLength(6);
    expect(seen[seen.length - 1]).toBe(6);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  it('cancels via AbortSignal', async () => {
    const controller = new AbortController();
    const promise = downloadNovel(toc(), TOC_URL, {
      fetchPage: makeFetchPage(),
      signal: controller.signal,
      onProgress: () => controller.abort(),
    });
    await expect(promise).rejects.toSatisfy(isNovelImportCancelled);
  });

  it('embeds a fetched cover image', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer as ArrayBuffer;
    const fetchCover = vi.fn(async () => ({ bytes, mime: 'image/jpeg' }));
    const book = await downloadNovel(
      toc({ coverUrl: 'https://cdn.example.org/cover.jpg' }),
      TOC_URL,
      { fetchPage: makeFetchPage(), fetchCover },
    );
    expect(fetchCover).toHaveBeenCalledWith('https://cdn.example.org/cover.jpg', TOC_URL);
    const files = await unzipEpub(book.file);
    expect(files.has('OEBPS/cover.jpg')).toBe(true);
    expect(files.get('content.opf')).toContain('<meta name="cover" content="cover-image"');
  });

  it('falls back to a generated SVG cover', async () => {
    const book = await downloadNovel(toc(), TOC_URL, {
      fetchPage: makeFetchPage(),
      fetchCover: async () => null,
    });
    const files = await unzipEpub(book.file);
    expect(files.has('OEBPS/cover.svg')).toBe(true);
  });
});
