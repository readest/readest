import { describe, expect, it, vi } from 'vitest';
import { configureZip } from '@/utils/zip';
import {
  decodeHtmlBody,
  downloadNovel,
  fetchNovelToc,
  isNovelImportCancelled,
} from '@/services/novel/novelImport';
import { stableIdentifier } from '@/services/send/conversion/convertToEpub';
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
  weak: { title: false, author: false },
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
    expect(opf).toContain(
      `<dc:identifier id="book-id">${stableIdentifier(TOC_URL)}</dc:identifier>`,
    );
    for (let n = 1; n <= 6; n++) {
      const xhtml = files.get(`OEBPS/chapter${n}.xhtml`)!;
      expect(xhtml).toContain(`<h1>Chapter ${n}: Part ${n}</h1>`);
      expect(xhtml).toContain(`Chapter ${n} paragraph 3`);
    }
    // toc.ncx lists every chapter
    const ncx = files.get('toc.ncx')!;
    expect(ncx).toContain('Chapter 6: Part 6');
  });

  it('uses a selection identity to distinguish volumes from the same chapter list', async () => {
    const firstChapters = toc().chapters.slice(0, 2);
    const secondChapters = toc().chapters.slice(2, 4);
    const firstIdentity = [TOC_URL, ...firstChapters.map((chapter) => chapter.url)].join('\n');
    const secondIdentity = [TOC_URL, ...secondChapters.map((chapter) => chapter.url)].join('\n');

    const [firstVolume, secondVolume] = await Promise.all([
      downloadNovel(toc({ chapters: firstChapters }), TOC_URL, {
        fetchPage: makeFetchPage(),
        identityKey: firstIdentity,
      }),
      downloadNovel(toc({ chapters: secondChapters }), TOC_URL, {
        fetchPage: makeFetchPage(),
        identityKey: secondIdentity,
      }),
    ]);
    const [firstFiles, secondFiles] = await Promise.all([
      unzipEpub(firstVolume.file),
      unzipEpub(secondVolume.file),
    ]);

    expect(firstFiles.get('content.opf')).toContain(
      `<dc:identifier id="book-id">${stableIdentifier(firstIdentity)}</dc:identifier>`,
    );
    expect(secondFiles.get('content.opf')).toContain(
      `<dc:identifier id="book-id">${stableIdentifier(secondIdentity)}</dc:identifier>`,
    );
    expect(stableIdentifier(firstIdentity)).not.toBe(stableIdentifier(secondIdentity));
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

describe('chapter-page metadata fallback', () => {
  // A chapter index that names the page, not the work, and credits the site
  // operator instead of the writer.
  const bareTocPage = `<!DOCTYPE html><html><head>
<title>Navigate Work | Example Archive</title>
<meta name="author" content="Example Archive Foundation"/>
</head><body><ol>
${Array.from({ length: 6 }, (_, i) => `<li><a href="/novel/7/${i + 1}">${i + 1}. part ${i + 1}</a></li>`).join('\n')}
</ol></body></html>`;

  const richChapterPage = (n: number) => `<!DOCTYPE html><html><head>
<title>A Work - Chapter ${n} - Ann Author - Fandom [Example Archive]</title>
<meta name="author" content="Example Archive Foundation"/>
</head><body>
<h2 class="title heading">A Work</h2>
<h3 class="byline heading">Ann Author</h3>
<div id="content">
${Array.from({ length: 10 }, (_, i) => `<p>Chapter ${n} paragraph ${i} with plenty of narrative text to satisfy extraction quality floors.</p>`).join('\n')}
</div>
</body></html>`;

  const fetchPage = async (url: string) => {
    if (url === TOC_URL) return { html: bareTocPage, finalUrl: url };
    const m = url.match(/\/novel\/7\/([0-9]+)$/);
    if (m) return { html: richChapterPage(parseInt(m[1]!, 10)), finalUrl: url };
    throw new Error(`unexpected fetch: ${url}`);
  };

  it('fills weak title and author from the first chapter page', async () => {
    const toc = await fetchNovelToc(TOC_URL, { fetchPage });
    expect(toc.title).toBe('A Work');
    expect(toc.author).toBe('Ann Author');
    expect(toc.chapters).toHaveLength(6);
  });

  it('keeps the chapter-index metadata when the page already knows the work', async () => {
    const strong = bareTocPage.replace(
      '<title>Navigate Work | Example Archive</title>',
      '<title>Navigate Work | Example Archive</title><meta property="og:novel:book_name" content="Indexed Title"/><meta property="og:novel:author" content="Indexed Author"/>',
    );
    const toc = await fetchNovelToc(TOC_URL, {
      fetchPage: async (url: string) =>
        url === TOC_URL ? { html: strong, finalUrl: url } : fetchPage(url),
    });
    expect(toc.title).toBe('Indexed Title');
    expect(toc.author).toBe('Indexed Author');
  });

  it('does not fetch a chapter when the index metadata is strong', async () => {
    const strong = bareTocPage.replace(
      '<meta name="author" content="Example Archive Foundation"/>',
      '<meta property="og:novel:book_name" content="Indexed Title"/><meta property="og:novel:author" content="Indexed Author"/>',
    );
    const seen: string[] = [];
    await fetchNovelToc(TOC_URL, {
      fetchPage: async (url: string) => {
        seen.push(url);
        return url === TOC_URL ? { html: strong, finalUrl: url } : fetchPage(url);
      },
    });
    expect(seen).toEqual([TOC_URL]);
  });

  it('keeps the weak metadata when the chapter page cannot be fetched', async () => {
    const toc = await fetchNovelToc(TOC_URL, {
      fetchPage: async (url: string) => {
        if (url === TOC_URL) return { html: bareTocPage, finalUrl: url };
        throw new ConversionError('nope', 'fetch_failed');
      },
    });
    expect(toc.title).toBe('Navigate Work');
    expect(toc.chapters).toHaveLength(6);
  });
});

describe('transient upstream failures', () => {
  // What a Cloudflare-fronted origin (AO3 and friends) returns while it is
  // briefly unreachable — the URL is fine, the site just isn't answering yet.
  const transient = () =>
    new ConversionError('The site is temporarily unavailable (HTTP 525).', 'fetch_transient');

  // Counts attempts at the flapping URL only: an unrelated backfill fetch of
  // the first chapter must not be mistaken for a retry.
  const flaky = (failures: number, failUrl: string = TOC_URL) => {
    const calls = { count: 0 };
    const inner = makeFetchPage();
    const fetchPage = async (url: string) => {
      if (url === failUrl) {
        calls.count += 1;
        if (calls.count <= failures) throw transient();
      }
      return inner(url);
    };
    return { fetchPage, calls };
  };

  it('retries the chapter-list fetch until the origin answers', async () => {
    vi.useFakeTimers();
    try {
      const { fetchPage, calls } = flaky(2);
      const pending = fetchNovelToc(TOC_URL, { fetchPage });
      await vi.advanceTimersByTimeAsync(30_000);
      await expect(pending).resolves.toMatchObject({ title: 'My Novel' });
      expect(calls.count).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('surfaces the transient error once the retry budget is spent', async () => {
    vi.useFakeTimers();
    try {
      const { fetchPage, calls } = flaky(99);
      const pending = fetchNovelToc(TOC_URL, { fetchPage });
      const assertion = expect(pending).rejects.toThrow(/temporarily unavailable/);
      await vi.advanceTimersByTimeAsync(30_000);
      await assertion;
      expect(calls.count).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats a hung origin as transient and retries it', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const inner = makeFetchPage();
      // A struggling origin usually hangs rather than answering 52x, so the
      // per-request deadline has to be retryable too.
      const fetchPage = async (url: string) => {
        if (url !== TOC_URL) return inner(url);
        calls += 1;
        if (calls <= 2) return new Promise<never>(() => {});
        return inner(url);
      };
      const pending = fetchNovelToc(TOC_URL, { fetchPage });
      await vi.advanceTimersByTimeAsync(120_000);
      await expect(pending).resolves.toMatchObject({ title: 'My Novel' });
      expect(calls).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a hung origin as a timeout, not as a cancellation', async () => {
    vi.useFakeTimers();
    try {
      const pending = fetchNovelToc(TOC_URL, { fetchPage: () => new Promise<never>(() => {}) });
      const assertion = expect(pending).rejects.toThrow(/took too long/);
      await vi.advanceTimersByTimeAsync(120_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries a flapping chapter instead of writing a placeholder', async () => {
    vi.useFakeTimers();
    try {
      const { fetchPage } = flaky(2, `${BASE}/novel/7/3`);
      const pending = downloadNovel(toc(), TOC_URL, { fetchPage });
      await vi.advanceTimersByTimeAsync(30_000);
      const book = await pending;
      expect(book.failures).toBe(0);
      const files = await unzipEpub(book.file);
      expect(files.get('OEBPS/chapter3.xhtml')).not.toContain('could not be downloaded');
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * GB2312 bytes for 福尔摩斯 — the opening of the title on the page from the
 * report (https://www.trxs.cc/tongren/11542.html), which serves gb2312 with
 * no charset on the HTTP response.
 */
const GB2312_HOLMES = Uint8Array.from([0xb8, 0xa3, 0xb6, 0xfb, 0xc4, 0xa6, 0xcb, 0xb9]);
const BIG5_HOLMES = Uint8Array.from([0xba, 0xd6, 0xba, 0xb8, 0xbc, 0xaf, 0xb4, 0xb5]);
/** GB2312 bytes for 第 and 章, so a fixture chapter row reads "第 N 章". */
const GB2312_DI = Uint8Array.from([0xb5, 0xda]);
const GB2312_ZHANG = Uint8Array.from([0xd5, 0xc2]);

const bytesOf = (...parts: (string | Uint8Array)[]): Uint8Array<ArrayBuffer> => {
  const chunks = parts.map((part) =>
    typeof part === 'string' ? new TextEncoder().encode(part) : part,
  );
  const out = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

describe('decodeHtmlBody', () => {
  it('honors a meta http-equiv charset when the response header has none', () => {
    const body = bytesOf(
      '<html><head><meta http-equiv="Content-Type" content="text/html; charset=gb2312" />',
      '<title>',
      GB2312_HOLMES,
      '</title></head><body></body></html>',
    );
    expect(decodeHtmlBody(body, 'text/html')).toContain('<title>福尔摩斯</title>');
  });

  it('honors a short meta charset tag', () => {
    const body = bytesOf('<html><head><meta charset="gbk"><title>', GB2312_HOLMES, '</title>');
    expect(decodeHtmlBody(body, null)).toContain('福尔摩斯');
  });

  it('prefers the response header charset over the meta tag', () => {
    const body = bytesOf('<html><head><meta charset="utf-8"><title>', BIG5_HOLMES, '</title>');
    expect(decodeHtmlBody(body, 'text/html; charset=big5')).toContain('福爾摩斯');
  });

  it('leaves a UTF-8 page untouched', () => {
    const body = bytesOf('<html><head><title>福尔摩斯</title></head></html>');
    expect(decodeHtmlBody(body, 'text/html; charset=utf-8')).toContain('福尔摩斯');
  });

  it('strips a UTF-8 BOM and ignores a contradicting declaration', () => {
    const body = bytesOf(
      new Uint8Array([0xef, 0xbb, 0xbf]),
      '<html><head><meta charset="gbk"><title>福尔摩斯</title>',
    );
    const html = decodeHtmlBody(body, 'text/html; charset=gbk');
    expect(html).toContain('福尔摩斯');
    expect(html.startsWith('<html>')).toBe(true);
  });

  it('falls back to gb18030 for undeclared bytes that are not valid UTF-8', () => {
    const body = bytesOf('<html><head><title>', GB2312_HOLMES, '</title></head></html>');
    expect(decodeHtmlBody(body, 'text/html')).toContain('福尔摩斯');
  });

  it('falls back to UTF-8 for an unknown charset label', () => {
    const body = bytesOf('<html><head><meta charset="x-nonsense"><title>福尔摩斯</title>');
    expect(decodeHtmlBody(body, 'text/html; charset=x-nonsense')).toContain('福尔摩斯');
  });

  it('accepts a single-quoted charset attribute', () => {
    const body = bytesOf("<html><head><meta charset='big5'><title>", BIG5_HOLMES, '</title>');
    expect(decodeHtmlBody(body, 'text/html')).toContain('福爾摩斯');
  });

  it('ignores a charset declaration inside a comment', () => {
    const body = bytesOf(
      '<html><head><!-- <meta charset="gbk"> --><title>福尔摩斯</title></head></html>',
    );
    expect(decodeHtmlBody(body, 'text/html')).toContain('<title>福尔摩斯</title>');
  });

  it('ignores a charset declared past the sniffing window', () => {
    const body = bytesOf(
      `<html><head><!--${'p'.repeat(1100)}--><meta charset="gbk"><title>`,
      GB2312_HOLMES,
      '</title>',
    );
    // Undeclared within the window, so the invalid-UTF-8 fallback still saves it.
    expect(decodeHtmlBody(body, 'text/html')).toContain('福尔摩斯');
  });
});

describe('defaultFetchPage charset handling', () => {
  it('decodes a gb2312 chapter list served without a header charset', async () => {
    const listing = Array.from({ length: 6 }, (_, i) => [
      `<li><a href="/tongren/11542/${i + 1}.html">`,
      GB2312_DI,
      ` ${i + 1} `,
      GB2312_ZHANG,
      '</a></li>',
    ]).flat();
    const page = bytesOf(
      '<html><head><meta http-equiv="Content-Type" content="text/html; charset=gb2312" /><title>',
      GB2312_HOLMES,
      '</title></head><body><ul>',
      ...listing,
      '</ul></body></html>',
    );
    const tauriFetch = vi.fn(
      async () => new Response(page, { status: 200, headers: { 'content-type': 'text/html' } }),
    );
    vi.doMock('@tauri-apps/plugin-http', () => ({ fetch: tauriFetch }));
    try {
      const parsed = await fetchNovelToc('https://www.trxs.cc/tongren/11542.html');
      expect(parsed.title).toBe('福尔摩斯');
      expect(parsed.chapters[0]!.title).toBe('第 1 章');
    } finally {
      vi.doUnmock('@tauri-apps/plugin-http');
    }
  });
});
