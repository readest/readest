import { describe, expect, it } from 'vitest';
import { parseChapterList, parseWorkMetadata } from '@/services/novel/chapterList';

const cnChapter = (n: number) => `<dd><a href="/book/1/${n}.html">第${n}章 陨落的天才</a></dd>`;

/** Biquge-style CN novel TOC: og:novel meta, a newest-first "latest chapters"
 *  sidebar, and the full ascending chapter list in a #list container. */
const cnPage = `<!DOCTYPE html><html><head>
<title>斗破苍穹最新章节_天蚕土豆_笔趣阁</title>
<meta property="og:novel:book_name" content="斗破苍穹"/>
<meta property="og:novel:author" content="天蚕土豆"/>
<meta property="og:image" content="/covers/dpcq.jpg"/>
</head><body>
<div class="nav"><a href="/">首页</a><a href="/rank">排行</a><a href="/sort/1">玄幻</a></div>
<div class="sidebar"><h2>最新章节</h2><ul>
${[30, 29, 28, 27, 26, 25].map(cnChapter).join('\n')}
</ul></div>
<div id="list"><dl>
${Array.from({ length: 30 }, (_, i) => cnChapter(i + 1)).join('\n')}
</dl></div>
</body></html>`;

const enChapter = (n: number) =>
  `<li><a href="chapter-${n}">Chapter ${n}: Part ${n} of the story</a></li>`;

const enPage = `<!DOCTYPE html><html><head>
<title>Lord of the Mysteries - Read Online</title>
<meta property="og:title" content="Lord of the Mysteries"/>
<meta name="author" content="Cuttlefish"/>
</head><body>
<ul class="chapters">
${Array.from({ length: 12 }, (_, i) => enChapter(i + 1)).join('\n')}
</ul>
</body></html>`;

const descendingPage = `<!DOCTYPE html><html><head><title>Novel</title></head><body>
<ul>
${Array.from({ length: 12 }, (_, i) => enChapter(12 - i)).join('\n')}
</ul>
</body></html>`;

/** Chapter titles with no numbers at all — detection must fall back to the
 *  shared href template (digit runs collapsed). */
const noNumberTitles = [
  'Prologue',
  'The Beginning',
  'A New Dawn',
  'Shadows',
  'The End',
  'Epilogue',
];
const templatePage = `<!DOCTYPE html><html><head><title>Novel</title></head><body>
<div class="toc">
${noNumberTitles.map((t, i) => `<a href="/read/99/${i + 1}">${t}</a>`).join('\n')}
</div>
</body></html>`;

const articlePage = `<!DOCTYPE html><html><head><title>Some Blog Post</title></head><body>
<nav><a href="/">Home</a><a href="/about">About</a><a href="/tags">Tags</a></nav>
<article>${'<p>Just a normal article paragraph.</p>'.repeat(20)}</article>
</body></html>`;

describe('parseChapterList', () => {
  it('parses a CN biquge-style TOC with og:novel metadata', () => {
    const toc = parseChapterList(cnPage, 'https://www.example.com/book/1/');
    expect(toc).not.toBeNull();
    expect(toc!.title).toBe('斗破苍穹');
    expect(toc!.author).toBe('天蚕土豆');
    expect(toc!.coverUrl).toBe('https://www.example.com/covers/dpcq.jpg');
  });

  it('picks the full chapter list over the latest-chapters sidebar and dedups', () => {
    const toc = parseChapterList(cnPage, 'https://www.example.com/book/1/')!;
    expect(toc.chapters).toHaveLength(30);
    expect(toc.chapters[0]!.title).toBe('第1章 陨落的天才');
    expect(toc.chapters[29]!.title).toBe('第30章 陨落的天才');
  });

  it('resolves relative chapter hrefs against the page URL', () => {
    const toc = parseChapterList(cnPage, 'https://www.example.com/book/1/')!;
    expect(toc.chapters[0]!.url).toBe('https://www.example.com/book/1/1.html');
    const en = parseChapterList(enPage, 'https://novels.example.org/lotm/')!;
    expect(en.chapters[0]!.url).toBe('https://novels.example.org/lotm/chapter-1');
  });

  it('parses an EN chapter list with og:title and meta author', () => {
    const toc = parseChapterList(enPage, 'https://novels.example.org/lotm/')!;
    expect(toc.title).toBe('Lord of the Mysteries');
    expect(toc.author).toBe('Cuttlefish');
    expect(toc.coverUrl).toBeNull();
    expect(toc.chapters).toHaveLength(12);
    expect(toc.chapters[0]!.title).toBe('Chapter 1: Part 1 of the story');
  });

  it('reverses a newest-first chapter list into reading order', () => {
    const toc = parseChapterList(descendingPage, 'https://novels.example.org/x/')!;
    expect(toc.chapters[0]!.title).toBe('Chapter 1: Part 1 of the story');
    expect(toc.chapters[11]!.title).toBe('Chapter 12: Part 12 of the story');
  });

  it('falls back to href-template matching when titles carry no numbers', () => {
    const toc = parseChapterList(templatePage, 'https://www.example.com/read/99/')!;
    expect(toc.chapters.map((c) => c.title)).toEqual(noNumberTitles);
    expect(toc.chapters[0]!.url).toBe('https://www.example.com/read/99/1');
  });

  it('returns null for a page that is not a chapter list', () => {
    expect(parseChapterList(articlePage, 'https://blog.example.com/post')).toBeNull();
  });

  it('reads the OpenGraph books namespace author (Royal Road style)', () => {
    const page = enPage.replace(
      '<meta name="author" content="Cuttlefish"/>',
      '<meta property="books:author" content="nobody103"/>',
    );
    const toc = parseChapterList(page, 'https://novels.example.org/lotm/')!;
    expect(toc.author).toBe('nobody103');
  });

  it('falls back to the cleaned title tag when og meta is missing', () => {
    const page = `<!DOCTYPE html><html><head><title>神墓最新章节 - 某某小说网</title></head><body>
<ul>${Array.from({ length: 8 }, (_, i) => cnChapter(i + 1)).join('\n')}</ul>
</body></html>`;
    const toc = parseChapterList(page, 'https://www.example.com/book/2/')!;
    expect(toc.title).toBe('神墓');
  });

  it('reads chapters numbered 第N頁 over a 第N章 recommendations box (czbooks shape)', () => {
    // Opaque chapter ids, so the href-template fallback can't find the list.
    const ids = Array.from({ length: 40 }, (_, i) => `sk${(i * 7919).toString(36)}x`);
    const page = `<!DOCTYPE html><html><head><title>某書 - 小說狂人</title></head><body>
<ul class="chapter-list">
${ids.map((id, i) => `<li><a href="//czbooks.net/n/skl6f083l/${id}">第${i + 1}頁</a></li>`).join('\n')}
</ul>
<div class="recommend"><ul>
${[1837, 252, 150, 99, 132, 128].map((n, i) => `<li><a href="/n/other${i}/c${i}">第${n}章</a></li>`).join('\n')}
</ul></div>
</body></html>`;
    const toc = parseChapterList(page, 'https://czbooks.net/n/skl6f083l')!;
    expect(toc.chapters).toHaveLength(40);
    expect(toc.chapters[0]!.title).toBe('第1頁');
    expect(toc.chapters[39]!.title).toBe('第40頁');
  });

  it.each(['節', '話', '页'])('reads a chapter list numbered 第N%s', (unit) => {
    const page = `<!DOCTYPE html><html><head><title>某書</title></head><body>
<ul>${Array.from({ length: 8 }, (_, i) => `<li><a href="/b/${String.fromCharCode(97 + i)}x">第${'一二三四五六七八'[i]}${unit} 標題</a></li>`).join('\n')}</ul>
</body></html>`;
    const toc = parseChapterList(page, 'https://www.example.com/b/');
    expect(toc?.chapters ?? []).toHaveLength(8);
  });

  it('reads traditional numerals 萬 and 兩 in chapter titles', () => {
    const page = `<!DOCTYPE html><html><head><title>某書</title></head><body>
<ul>${Array.from({ length: 6 }, (_, i) => `<li><a href="/b/${String.fromCharCode(97 + i)}x">第一萬零${'兩三四五六七'[i]}章</a></li>`).join('\n')}</ul>
</body></html>`;
    const toc = parseChapterList(page, 'https://www.example.com/b/');
    expect(toc?.chapters ?? []).toHaveLength(6);
  });

  // Newest-first lists numbered in Chinese numerals, with ids that carry no
  // digits, so only the title can tell the list runs backwards.
  const numerals = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '二十'];
  const newestFirstPage = (
    unit: string,
  ) => `<!DOCTYPE html><html><head><title>某書</title></head><body>
<ul>${numerals
    .map((n, i) => `<li><a href="/n/book/s${'abcdefghijkl'[i]}">第${n}${unit}</a></li>`)
    .reverse()
    .join('\n')}</ul>
</body></html>`;

  it.each(['章', '頁'])('reverses a newest-first list numbered in Chinese (第N%s)', (unit) => {
    const toc = parseChapterList(newestFirstPage(unit), 'https://www.example.com/n/book/')!;
    expect(toc.chapters.map((c) => c.title)).toEqual(numerals.map((n) => `第${n}${unit}`));
  });

  it.each([
    ['第一卷 第%s章', ['一', '二', '三', '四', '五', '六']],
    ['第1卷 第%s章', ['1', '2', '3', '4', '5', '6']],
  ])('orders by the chapter number, not the volume (%s)', (template, nums) => {
    const titles = nums.map((n) => template.replace('%s', n));
    const page = `<!DOCTYPE html><html><head><title>某書</title></head><body>
<ul>${titles
      .map((t, i) => `<li><a href="/n/book/s${'abcdef'[i]}">${t}</a></li>`)
      .reverse()
      .join('\n')}</ul>
</body></html>`;
    const toc = parseChapterList(page, 'https://www.example.com/n/book/')!;
    expect(toc.chapters.map((c) => c.title)).toEqual(titles);
  });

  it('reverses a newest-first list numbered in full-width digits (第１２頁)', () => {
    const titles = ['第１頁', '第２頁', '第３頁', '第９頁', '第１０頁', '第１２頁'];
    const page = `<!DOCTYPE html><html><head><title>某書</title></head><body>
<ul>${titles
      .map((t, i) => `<li><a href="/n/book/s${'abcdef'[i]}9">${t}</a></li>`)
      .reverse()
      .join('\n')}</ul>
</body></html>`;
    const toc = parseChapterList(page, 'https://www.example.com/n/book/')!;
    expect(toc.chapters.map((c) => c.title)).toEqual(titles);
  });

  it('reads larger Chinese numerals in order (九十九, 一百, 一百零一, 一千, 一萬)', () => {
    const titles = [
      '第九十九章',
      '第一百章',
      '第一百零一章',
      '第一千章',
      '第一萬章',
      '第一萬零一章',
    ];
    const page = `<!DOCTYPE html><html><head><title>某書</title></head><body>
<ul>${titles
      .map((t, i) => `<li><a href="/n/book/s${'abcdef'[i]}">${t}</a></li>`)
      .reverse()
      .join('\n')}</ul>
</body></html>`;
    const toc = parseChapterList(page, 'https://www.example.com/n/book/')!;
    expect(toc.chapters.map((c) => c.title)).toEqual(titles);
  });
});

/** A bare chapter-index page: no per-work metadata at all, and a site-wide
 *  `meta[name=author]` naming the site operator rather than the writer. */
const indexOnlyPage = `<!DOCTYPE html><html><head>
<title>Navigate Work | Example Archive</title>
<meta name="author" content="Example Archive Foundation"/>
</head><body>
<h2 class="heading">Chapter Index for <a href="/works/42">A Work</a></h2>
<ol class="chapter index group">
${Array.from({ length: 6 }, (_, i) => `<li><a href="/works/42/chapters/${100 + i}">${i + 1}. part ${i + 1}</a></li>`).join('\n')}
</ol>
</body></html>`;

/** The same work's chapter page, which does carry the real metadata. */
const workChapterPage = `<!DOCTYPE html><html><head>
<title>A Work - Chapter 2 - Ann Author - Fandom [Example Archive]</title>
<meta name="author" content="Example Archive Foundation"/>
</head><body>
<h2 class="title heading">A Work</h2>
<h3 class="byline heading">Ann Author</h3>
<div id="chapters"><h3 class="title">Chapter 2: part 2</h3></div>
</body></html>`;

describe('metadata confidence', () => {
  it('marks title and author weak when only page-level guesses are available', () => {
    const toc = parseChapterList(indexOnlyPage, 'https://archive.example.org/works/42/navigate')!;
    expect(toc.weak).toEqual({ title: true, author: true });
    expect(toc.title).toBe('Navigate Work');
  });

  it('does not mark fields weak when real work metadata is present', () => {
    const toc = parseChapterList(cnPage, 'https://www.example.com/book/1/')!;
    expect(toc.weak).toEqual({ title: false, author: false });
  });
});

/** Chapter rows for a byline fixture — enough to clear MIN_CHAPTER_LINKS. */
const bylineRows = Array.from(
  { length: 6 },
  (_, i) => `<li><a href="/tongren/11542/${i + 1}.html">\u7b2c${i + 1}\u8282</a></li>`,
).join('\n');

const bylinePage = (byline: string) => `<!DOCTYPE html><html><head>
<title>\u5c0f\u8bf4\u540d_\u540c\u4eba\u5c0f\u8bf4\u7f51</title>
</head><body>
<div class="infos">${byline}</div>
<ul>${bylineRows}</ul>
</body></html>`;

const authorOf = (byline: string) =>
  parseChapterList(bylinePage(byline), 'https://www.trxs.cc/tongren/11542.html')!.author;

describe('byline author fallback', () => {
  it('does not swallow a following labelled field (trxs.cc shape)', () => {
    // <span>作者：<a>五月不行</a></span>日期：2026-08-24
    expect(
      authorOf(
        '<div class="date"> <span>\u4f5c\u8005\uff1a' +
          '<a href="/author/9275/x.html">\u4e94\u6708\u4e0d\u884c</a></span>' +
          '\u65e5\u671f\uff1a2026-08-24</div>',
      ),
    ).toBe('\u4e94\u6708\u4e0d\u884c');
  });

  it('stops at a following label inside one text node', () => {
    expect(
      authorOf('<p>\u4f5c\u8005\uff1a\u4e94\u6708\u4e0d\u884c\u65e5\u671f\uff1a2026-08-24</p>'),
    ).toBe('\u4e94\u6708\u4e0d\u884c');
  });

  it('reads a plain inline byline', () => {
    expect(authorOf('<p>\u4f5c\u8005\uff1a\u5929\u8695\u571f\u8c46</p>')).toBe(
      '\u5929\u8695\u571f\u8c46',
    );
  });

  it('accepts an ASCII colon and the 著者 label', () => {
    expect(authorOf('<p>\u8457\u8005: \u5929\u8695\u571f\u8c46</p>')).toBe(
      '\u5929\u8695\u571f\u8c46',
    );
  });

  it('stops at whitespace, so trailing text on the line is not part of the name', () => {
    expect(authorOf('<p>作者：五月不行 (完结) 469章</p>')).toBe('五月不行');
  });

  it('still prefers real work metadata over the byline', () => {
    const page = bylinePage('<p>\u4f5c\u8005\uff1a\u5929\u8695\u571f\u8c46</p>').replace(
      '</head>',
      '<meta property="og:novel:author" content="Someone Else"/></head>',
    );
    const toc = parseChapterList(page, 'https://www.trxs.cc/tongren/11542.html')!;
    expect(toc.author).toBe('Someone Else');
    expect(toc.weak.author).toBe(false);
  });

  it('does not adopt a later field or a chapter title when the byline is empty', () => {
    expect(authorOf('<span>作者：</span><span>日期：2026-08-24</span>')).toBe('');
  });

  it('reports no author when the page has no byline', () => {
    expect(authorOf('<p>\u6700\u65b0\u66f4\u65b0</p>')).toBe('');
  });
});

describe('parseWorkMetadata', () => {
  it('reads the work title and byline from a chapter page', () => {
    const meta = parseWorkMetadata(
      workChapterPage,
      'https://archive.example.org/works/42/chapters/101',
    );
    expect(meta).toEqual({ title: 'A Work', author: 'Ann Author' });
  });

  it('prefers og metadata over headings', () => {
    const page = workChapterPage.replace(
      '<h2 class="title heading">A Work</h2>',
      '<meta property="og:novel:book_name" content="Canonical Title"/><h2 class="title heading">A Work</h2>',
    );
    expect(parseWorkMetadata(page, 'https://archive.example.org/x').title).toBe('Canonical Title');
  });

  it('ignores a heading that is just the chapter title', () => {
    const page = `<!DOCTYPE html><html><head><title>Chapter 7 - My Novel</title></head><body>
<h1 class="title">Chapter 7</h1>
</body></html>`;
    expect(parseWorkMetadata(page, 'https://novels.example.org/x').title).toBeNull();
  });

  it('strips a leading "by" from the byline', () => {
    const page = workChapterPage.replace(
      '<h3 class="byline heading">Ann Author</h3>',
      '<h3 class="byline heading">by Ann Author</h3>',
    );
    expect(parseWorkMetadata(page, 'https://archive.example.org/x').author).toBe('Ann Author');
  });

  it('never reports the site-wide author meta as the work author', () => {
    const page = workChapterPage.replace('<h3 class="byline heading">Ann Author</h3>', '');
    expect(parseWorkMetadata(page, 'https://archive.example.org/x').author).toBeNull();
  });
});
