import { describe, expect, it } from 'vitest';
import { parseChapterList } from '@/services/novel/chapterList';

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
});
